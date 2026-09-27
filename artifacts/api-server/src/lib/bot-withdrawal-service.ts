import { and, eq, isNull, ne } from "drizzle-orm";
import * as kron from "@kronsdk/kron-sdk";
import { loadKaspa } from "@kronsdk/kron-sdk/wasm";
import {
  db,
  kasWithdrawalsTable,
  managedLotsTable,
  tradingBotsTable,
  walletUsersTable,
} from "@workspace/db";
import { decryptPrivateKey } from "./user-app-service";
import { reconcileStaleInFlight } from "./interrupted-trade-service";

const NODE_URL = "wss://node.kron.technology";
const NETWORK_ID = "mainnet";
const SOMPI_PER_KAS = 100_000_000n;
const MINIMUM_OUTPUT_SOMPI = 20_000_000n;

function parseKasAmount(value: string) {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value)) {
    throw new Error("Enter a valid KAS amount with no more than 8 decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const sompi = BigInt(whole) * SOMPI_PER_KAS + BigInt(fraction.padEnd(8, "0"));
  if (sompi < MINIMUM_OUTPUT_SOMPI) {
    throw new Error("The minimum withdrawal is 0.2 KAS.");
  }
  return sompi;
}

function formatKas(sompi: bigint) {
  const whole = sompi / SOMPI_PER_KAS;
  const fraction = (sompi % SOMPI_PER_KAS).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

type PreparedWithdrawal = {
  action: "withdraw";
  startedAt: string;
  preparedTransaction: string;
  connectedInputIndexes: number[];
  amountSompi: string;
  feeSompi: string;
  remainingSompi: string;
  destinationAddress: string;
};

type SubmittingWithdrawal = Omit<PreparedWithdrawal, "action"> & {
  action: "withdraw-submitting";
};

// Some PSKT signers wrap an already-encoded 65-byte Schnorr signature script
// in a second push (42 41 <signature>). Remove only that redundant push;
// the signature bytes and the user's approved transaction stay unchanged.
function canonicalFeeSignatureScript(script: string) {
  return /^4241[0-9a-f]{128}01$/i.test(script) ? script.slice(2) : script;
}

function maxWithdrawalApprovalMessage(prepared: PreparedWithdrawal) {
  return [
    "Kron Bot KAS Max withdrawal",
    `Send ${formatKas(BigInt(prepared.amountSompi))} KAS to ${prepared.destinationAddress}`,
    `Network fee: ${formatKas(BigInt(prepared.feeSompi))} KAS`,
    `Operation: ${prepared.startedAt}`,
    "Approve this withdrawal only.",
  ].join("\n");
}

export async function prepareUserBotKasWithdrawal(
  userId: string,
  input: { mode: "amount" | "max"; amountKas?: string },
) {
  const [[user], initialBot] = await Promise.all([
    db.select().from(walletUsersTable).where(eq(walletUsersTable.id, userId)).limit(1),
    db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1),
  ]);
  let [bot] = initialBot;
  if (!user || !bot) throw new Error("Bot wallet was not found.");
  if (bot.status === "running") throw new Error("Stop trading before withdrawing KAS.");
  if (bot.inFlight) {
    const legacy = bot.inFlight as { action?: string; preparedTransaction?: string };
    if (
      legacy.action === "withdraw" &&
      bot.stopReason !== "Withdrawal submission is awaiting reconciliation. Do not retry."
    ) {
      const [cleared] = await db.update(tradingBotsTable).set({
        inFlight: null,
        stopReason: null,
        updatedAt: new Date(),
      }).where(and(
        eq(tradingBotsTable.id, bot.id),
        eq(tradingBotsTable.inFlight, bot.inFlight),
      )).returning({ id: tradingBotsTable.id });
      if (!cleared) throw new Error("The bot operation changed. Refresh and try again.");
    } else if (legacy.action === "withdraw-preparing") {
      const startedAt = typeof (bot.inFlight as any).startedAt === "string"
        ? Date.parse((bot.inFlight as any).startedAt)
        : Number.NaN;
      if (!Number.isFinite(startedAt) || Date.now() - startedAt < 10 * 60_000) {
        throw new Error("A withdrawal is still being prepared. Wait a moment and try again.");
      }
      const [cleared] = await db.update(tradingBotsTable).set({
        inFlight: null,
        stopReason: null,
        updatedAt: new Date(),
      }).where(and(
        eq(tradingBotsTable.id, bot.id),
        eq(tradingBotsTable.inFlight, bot.inFlight),
      )).returning({ id: tradingBotsTable.id });
      if (!cleared) throw new Error("The bot operation changed. Refresh and try again.");
    } else {
      await reconcileStaleInFlight(bot);
      [bot] = await db.select().from(tradingBotsTable)
        .where(eq(tradingBotsTable.id, bot.id))
        .limit(1);
      if (!bot || bot.inFlight) {
        throw new Error("The interrupted trade requires reconciliation before withdrawing.");
      }
    }
  }

  const [openLot] = await db.select({ id: managedLotsTable.id })
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, bot.id), isNull(managedLotsTable.soldAt)))
    .limit(1);
  if (openLot) throw new Error("Sell all managed token positions before withdrawing KAS.");

  const startedAt = new Date();
  const preparing = { action: "withdraw-preparing", startedAt: startedAt.toISOString() };
  const [claim] = await db.update(tradingBotsTable).set({
    inFlight: preparing,
    stopReason: null,
    updatedAt: startedAt,
  }).where(and(
    eq(tradingBotsTable.id, bot.id),
    ne(tradingBotsTable.status, "running"),
    isNull(tradingBotsTable.inFlight),
  )).returning({ id: tradingBotsTable.id });
  if (!claim) throw new Error("The bot state changed. Refresh and try the withdrawal again.");

  const k = await loadKaspa();
  const key = new k.PrivateKey(decryptPrivateKey(bot.encryptedPrivateKey));
  const rpc = new k.RpcClient({ url: NODE_URL, networkId: NETWORK_ID, encoding: k.Encoding.Borsh });

  try {
    await rpc.connect();
    const [{ entries: botEntries }, { entries: connectedEntries }] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [bot.botAddress] }),
      input.mode === "max"
        ? Promise.resolve({ entries: [] as Awaited<ReturnType<typeof rpc.getUtxosByAddresses>>["entries"] })
        : rpc.getUtxosByAddresses({ addresses: [user.walletAddress] }),
    ]);
    if (!botEntries.length) throw new Error("Bot wallet has no spendable KAS.");
    if (input.mode !== "max" && !connectedEntries.length) {
      throw new Error("Connected wallet needs spendable KAS to pay the withdrawal network fee.");
    }

    const sortedBotEntries = [...botEntries].sort(
      (a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1),
    );
    const sortedConnectedEntries = [...connectedEntries].sort(
      (a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1),
    );
    const botBalance = sortedBotEntries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
    let requestedAmount = input.mode === "max" ? botBalance : parseKasAmount(input.amountKas ?? "");
    if (requestedAmount > botBalance) throw new Error("Withdrawal exceeds the bot wallet balance.");
    let botRemaining = botBalance - requestedAmount;
    if (input.mode === "amount" && botRemaining < MINIMUM_OUTPUT_SOMPI) {
      throw new Error("Use Max to withdraw the full balance, or leave at least 0.2 KAS in the bot wallet.");
    }

    let transaction: InstanceType<typeof k.Transaction>;
    let networkFee: bigint;
    let connectedInputIndexes: number[];
    if (input.mode === "max") {
      // Estimate with an extra change output so the final one-output sweep
      // overpays slightly rather than risking an underfunded network fee.
      if (botBalance <= 2n * MINIMUM_OUTPUT_SOMPI + 10_000n) {
        throw new Error("Bot wallet balance is too small to cover a safe Max withdrawal.");
      }
      const provisional = kron.spend.assembleNativeTx(k, {
        spend: {
          kind: "transfer",
          inputs: [],
          outputs: [{
            value: botBalance - MINIMUM_OUTPUT_SOMPI - 10_000n,
            scriptPublicKey: k.payToAddressScript(user.walletAddress),
            role: "withdrawal",
          }],
          economics: {},
        },
        fundingEntries: sortedBotEntries,
        changeAddress: bot.botAddress,
        networkFee: 10_000n,
      });
      networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, provisional, 100);
      requestedAmount = botBalance - networkFee;
      if (requestedAmount < MINIMUM_OUTPUT_SOMPI) {
        throw new Error("Bot wallet balance is too small after the network fee.");
      }
      botRemaining = 0n;
      connectedInputIndexes = [];
      transaction = new k.Transaction({
        version: kron.spend.TX_VERSION,
        inputs: sortedBotEntries.map((entry) => new k.TransactionInput({
          previousOutpoint: entry.outpoint,
          signatureScript: "",
          sequence: 0n,
          sigOpCount: 0,
          computeBudget: kron.spend.FUNDING_COMPUTE,
          utxo: entry,
        })),
        outputs: [new k.TransactionOutput(requestedAmount, k.payToAddressScript(user.walletAddress))],
        lockTime: 0n,
        gas: 0n,
        payload: "",
        subnetworkId: "0000000000000000000000000000000000000000",
      });
    } else {
      const outputs: kron.spend.CovOutput[] = [{
        value: requestedAmount,
        scriptPublicKey: k.payToAddressScript(user.walletAddress),
        role: "withdrawal",
      }];
      if (botRemaining > 0n) {
        outputs.push({
          value: botRemaining,
          scriptPublicKey: k.payToAddressScript(bot.botAddress),
          role: "bot-change",
        });
      }
      const spend: kron.spend.CovenantSpend = {
        kind: "transfer",
        inputs: [],
        outputs,
        economics: {},
      };
      const fundingEntries = [...sortedBotEntries, ...sortedConnectedEntries];
      connectedInputIndexes = sortedConnectedEntries.map(
        (_, index) => sortedBotEntries.length + index,
      );
      let assembly = kron.spend.assembleNativeTx(k, {
        spend,
        fundingEntries,
        changeAddress: user.walletAddress,
        networkFee: 10_000n,
      });
      networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
      assembly = kron.spend.assembleNativeTx(k, {
        spend,
        fundingEntries,
        changeAddress: user.walletAddress,
        networkFee,
      });
      if (assembly.change < MINIMUM_OUTPUT_SOMPI) {
        throw new Error("Connected wallet needs at least the network fee plus 0.2 KAS of spendable change.");
      }
      transaction = assembly.transaction;
    }
    transaction = k.signTransaction(transaction, [key], false);
    for (let index = 0; index < sortedBotEntries.length; index += 1) {
      if (!transaction.inputs[index]?.signatureScript) {
        throw new Error("Bot wallet could not sign the withdrawal transaction.");
      }
    }
    for (const index of connectedInputIndexes) {
      if (transaction.inputs[index]?.signatureScript) {
        throw new Error("Bot signer unexpectedly modified a connected-wallet input.");
      }
    }
    const txJsonString = transaction.serializeToSafeJSON();
    const prepared: PreparedWithdrawal = {
      action: "withdraw",
      startedAt: startedAt.toISOString(),
      preparedTransaction: txJsonString,
      connectedInputIndexes,
      amountSompi: requestedAmount.toString(),
      feeSompi: networkFee.toString(),
      remainingSompi: botRemaining.toString(),
      destinationAddress: user.walletAddress,
    };
    const [preparedClaim] = await db.update(tradingBotsTable).set({
      inFlight: prepared,
      updatedAt: new Date(),
    }).where(and(
      eq(tradingBotsTable.id, bot.id),
      eq(tradingBotsTable.inFlight, preparing),
    )).returning({ id: tradingBotsTable.id });
    if (!preparedClaim) throw new Error("Withdrawal preparation lost ownership of the operation marker.");

    return {
      txJsonString,
      signInputs: connectedInputIndexes.map((index) => ({ index, sighashType: 1 })),
      ...(input.mode === "max" ? { approvalMessage: maxWithdrawalApprovalMessage(prepared) } : {}),
      destinationAddress: user.walletAddress,
      amountKas: formatKas(requestedAmount),
      feeKas: formatKas(networkFee),
      remainingBalanceKas: formatKas(botRemaining),
    };
  } catch (error) {
    await db.update(tradingBotsTable).set({
      inFlight: null,
      updatedAt: new Date(),
    }).where(and(
      eq(tradingBotsTable.id, bot.id),
      eq(tradingBotsTable.inFlight, preparing),
    ));
    throw error;
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}

export async function submitUserBotKasWithdrawal(userId: string, signedTransaction: string) {
  const [[user], [bot]] = await Promise.all([
    db.select().from(walletUsersTable).where(eq(walletUsersTable.id, userId)).limit(1),
    db.select().from(tradingBotsTable).where(eq(tradingBotsTable.userId, userId)).limit(1),
  ]);
  if (!user || !bot) throw new Error("Bot wallet was not found.");
  const prepared = bot.inFlight as PreparedWithdrawal | null;
  if (
    !prepared ||
    prepared.action !== "withdraw" ||
    prepared.destinationAddress !== user.walletAddress ||
    !prepared.preparedTransaction
  ) {
    throw new Error("No prepared withdrawal is awaiting this wallet signature.");
  }

  let expectedJson: any;
  let signedJson: any;
  const feeSignatures = new Map<number, string>();
  const k = await loadKaspa();
  try {
    expectedJson = JSON.parse(prepared.preparedTransaction);
    if (prepared.connectedInputIndexes.length === 0) {
      const approval = JSON.parse(signedTransaction);
      if (
        !approval || typeof approval.txJsonString !== "string" ||
        typeof approval.approvalSignature !== "string"
      ) throw new Error("Missing wallet approval for Max withdrawal.");
      const signature = /^[a-fA-F0-9]+$/.test(approval.approvalSignature)
        ? approval.approvalSignature
        : Buffer.from(approval.approvalSignature, "base64").toString("hex");
      if (!k.verifyMessage({
        message: maxWithdrawalApprovalMessage(prepared),
        signature,
        publicKey: user.publicKey,
      })) throw new Error("Wallet approval for Max withdrawal could not be verified.");
      signedJson = JSON.parse(approval.txJsonString);
    } else {
      signedJson = JSON.parse(signedTransaction);
    }
  } catch {
    throw new Error("KasWare returned an unreadable or invalid withdrawal approval.");
  }
  for (const index of prepared.connectedInputIndexes) {
    const signature = signedJson?.inputs?.[index]?.signatureScript;
    if (typeof signature !== "string" || !signature) {
      throw new Error("KasWare did not sign every connected-wallet fee input.");
    }
    feeSignatures.set(index, canonicalFeeSignatureScript(signature));
    signedJson.inputs[index].signatureScript = expectedJson.inputs[index].signatureScript;
  }
  if (JSON.stringify(signedJson) !== JSON.stringify(expectedJson)) {
    throw new Error("Signed transaction changed fields other than the approved fee-input signatures.");
  }
  for (const [index, signature] of feeSignatures) {
    signedJson.inputs[index].signatureScript = signature;
  }

  const transaction = k.Transaction.deserializeFromSafeJSON(JSON.stringify(signedJson));
  const submitting: SubmittingWithdrawal = {
    ...prepared,
    action: "withdraw-submitting",
  };
  const [claim] = await db.update(tradingBotsTable).set({
    inFlight: submitting,
    updatedAt: new Date(),
  }).where(and(
    eq(tradingBotsTable.id, bot.id),
    eq(tradingBotsTable.inFlight, prepared),
  )).returning({ id: tradingBotsTable.id });
  if (!claim) throw new Error("The prepared withdrawal changed. Refresh and prepare it again.");

  const rpc = new k.RpcClient({ url: NODE_URL, networkId: NETWORK_ID, encoding: k.Encoding.Borsh });
  let submissionAttempted = false;
  try {
    await rpc.connect();
    submissionAttempted = true;
    const result = await rpc.submitTransaction({
      transaction,
      allowOrphan: false,
    });

    await db.transaction(async (tx) => {
      await tx.insert(kasWithdrawalsTable).values({
        botId: bot.id,
        userId,
        transactionId: result.transactionId,
        destinationAddress: user.walletAddress,
        amountSompi: BigInt(prepared.amountSompi),
        feeSompi: BigInt(prepared.feeSompi),
      });
      const [updated] = await tx.update(tradingBotsTable).set({
        inFlight: null,
        stopReason: null,
        updatedAt: new Date(),
      }).where(and(
        eq(tradingBotsTable.id, bot.id),
        eq(tradingBotsTable.inFlight, submitting),
      )).returning({ id: tradingBotsTable.id });
      if (!updated) throw new Error("Withdrawal bookkeeping lost ownership of the operation marker.");
    });

    return {
      transactionId: result.transactionId,
      destinationAddress: user.walletAddress,
      amountKas: formatKas(BigInt(prepared.amountSompi)),
      feeKas: formatKas(BigInt(prepared.feeSompi)),
      remainingBalanceKas: formatKas(BigInt(prepared.remainingSompi)),
    };
  } catch (error) {
    if (!submissionAttempted) {
      await db.update(tradingBotsTable).set({
        inFlight: null,
        updatedAt: new Date(),
      }).where(and(
        eq(tradingBotsTable.id, bot.id),
        eq(tradingBotsTable.inFlight, submitting),
      ));
    } else {
      await db.update(tradingBotsTable).set({
        stopReason: "Withdrawal submission is awaiting reconciliation. Do not retry.",
        updatedAt: new Date(),
      }).where(and(
        eq(tradingBotsTable.id, bot.id),
        eq(tradingBotsTable.inFlight, submitting),
      ));
    }
    throw error;
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}