import * as kron from "@kronsdk/kron-sdk";
import { loadKaspa } from "@kronsdk/kron-sdk/wasm";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.kron.technology";
const INDEXER_URL = "https://idx.kron.technology/v1/kcc20";
const NODE_URL = "wss://node.kron.technology";
const SEQUENCER_URL = "https://seq.kron.technology";
const NETWORK_ID = "mainnet";
const LIVE_TEST_KAS = 21;
const SOMPI_PER_KAS = 100_000_000n;
const MAXIMUM_DEBIT_SOMPI = 2_275_000_000n;
const MINIMUM_RESERVE_SOMPI = 2_500_000_000n;
const EXECUTION_CONFIRMATION = "BUY-21-KAS-KDIST-ONCE";
const EXECUTION_LOCK = path.resolve(process.cwd(), ".local/kron-live-buy.executed.json");

export type LiveBotCredentials = {
  privateKey: string;
  tokenId: string;
};

export class TradeSubmissionAttemptedError extends Error {
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "TradeSubmissionAttemptedError";
    (this as Error & { cause?: unknown }).cause = cause;
  }
}

export class RetryableTradeStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableTradeStateError";
  }
}

const toBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const toKas = (sompi: bigint) => Number(sompi) / Number(SOMPI_PER_KAS);

function unwrapIndexerRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value ?? null;
}

function poolParamsFromCurve(curveParams: {
  creatorFeeOwner: string;
  platformFeeOwner: string;
  dexCreatorFeeBps?: number;
  dexPlatformFeeBps?: number;
  dexLpFeeBps?: number;
  poolLockedShares?: number;
}) {
  return {
    creatorFeeOwner: toBytes(curveParams.creatorFeeOwner),
    platformFeeOwner: toBytes(curveParams.platformFeeOwner),
    creatorFeeBps: BigInt(curveParams.dexCreatorFeeBps ?? 0),
    platformFeeBps: BigInt(curveParams.dexPlatformFeeBps ?? 0),
    lpFeeBps: BigInt(curveParams.dexLpFeeBps ?? 0),
    lockedShares: BigInt(curveParams.poolLockedShares ?? 1_000_000),
  };
}

type PoolHeadSnapshot = {
  pool: { transactionId: string; index: number };
  poolToken: { transactionId: string; index: number };
  reserves: {
    kasReserve: string;
    tokenReserve: string;
    totalShares: string;
    lpCovid: string | null;
  };
};

/** Prefer confirmed indexer head when the sequencer has no in-flight chain. */
async function resolvePoolHead(
  tick: string,
  indexer: InstanceType<typeof kron.client.IndexerClient>,
  submit: boolean,
): Promise<PoolHeadSnapshot> {
  const sequence = (await new kron.client.SequencerClient(SEQUENCER_URL).head(tick)) as {
    head: {
      poolOutpoint: { transactionId: string; index: number };
      poolTokenOutpoint: { transactionId: string; index: number };
      reserves: PoolHeadSnapshot["reserves"];
    } | null;
    depth: number;
  };
  if (submit && sequence.head) {
    throw new RetryableTradeStateError(
      "The AMM pool has an in-flight sequenced trade; waiting for it to settle.",
    );
  }
  if (sequence.head) {
    return {
      pool: sequence.head.poolOutpoint,
      poolToken: sequence.head.poolTokenOutpoint,
      reserves: sequence.head.reserves,
    };
  }
  const confirmed = unwrapIndexerRow<PoolHeadSnapshot>(await indexer.poolhead(tick));
  if (!confirmed?.pool || !confirmed?.poolToken || !confirmed?.reserves) {
    throw new RetryableTradeStateError(
      "AMM pool head is temporarily unavailable; waiting to retry.",
    );
  }
  return confirmed;
}

/** User console always passes credentials.tokenId from the bot row / UI. Env is CLI-only. */
function resolveLiveTokenId(credentials?: LiveBotCredentials) {
  if (credentials) {
    const tokenId = credentials.tokenId?.trim().toLowerCase();
    if (!tokenId) {
      throw new Error("Bot token ID is required. Enter the covenant ID in the console.");
    }
    return tokenId;
  }
  const tokenId = process.env.KRON_TOKEN_ID?.trim().toLowerCase();
  if (!tokenId) {
    throw new Error(
      "KRON_TOKEN_ID env is required only for server-owned CLI / file automation (not wallet-connect user bots).",
    );
  }
  return tokenId;
}

async function executionAlreadyCompleted() {
  try {
    await access(EXECUTION_LOCK);
    return true;
  } catch {
    return false;
  }
}

export async function prepareLiveBuy() {
  return runLiveBuy(false, false);
}

export async function validateLiveBuySignature() {
  return runLiveBuy(false, true);
}

export async function executeAutomatedBuy() {
  return runLiveBuy(true, false, true);
}

export async function executeUserAutomatedBuy(credentials: LiveBotCredentials) {
  return runLiveBuy(true, false, true, credentials, false);
}

export async function executeLiveBuy(confirmation: string) {
  if (confirmation !== EXECUTION_CONFIRMATION) {
    throw new Error("Exact live-buy confirmation phrase was not supplied.");
  }
  if (await executionAlreadyCompleted()) {
    throw new Error("The one-trade live-test cap has already been consumed.");
  }
  return runLiveBuy(true, false);
}

async function runLiveBuy(
  submit: boolean,
  signOnly: boolean,
  automation = false,
  credentials?: LiveBotCredentials,
  enforceMinimumOutput = true,
) {
  const privateKey = credentials?.privateKey.trim() ?? process.env.KASPA_BOT_PRIVATE_KEY?.trim();
  const tokenId = resolveLiveTokenId(credentials);
  if (!privateKey) throw new Error("Dedicated bot wallet secret is not configured.");

  const k = await loadKaspa();
  let key: any;
  try {
    key = new k.PrivateKey(privateKey);
  } catch {
    throw new Error("The configured bot wallet private key is invalid.");
  }

  const publicKey = key.toPublicKey();
  const walletAddress = publicKey.toAddress(k.NetworkType.Mainnet).toString();
  const buyerPubkey = toBytes(publicKey.toXOnlyPublicKey().toString());
  const registry = new kron.client.RegistryClient(API_URL);
  const indexer = new kron.client.IndexerClient(INDEXER_URL);
  const entry = (await registry.tokenlist({ all: true })).tokens.find(
    (token) => token.covenantId.toLowerCase() === tokenId,
  );
  if (!entry || !entry.extensions.chainVerified || entry.network !== NETWORK_ID) {
    throw new Error("Configured token is not a chain-verified Kron mainnet token.");
  }
  if (!entry.extensions.curveParams) {
    throw new Error("Configured token is missing Kron template params.");
  }

  const token = unwrapIndexerRow<any>(await indexer.token(entry.symbol.toLowerCase()));
  if (!token) {
    throw new RetryableTradeStateError(
      "Indexer has no live state for this token yet; waiting to retry.",
    );
  }

  const graduated = Boolean(token.graduated || token.cpState?.graduated);
  const poolCovidHex = (
    entry.extensions.poolCovenantId ||
    token.poolCovenantId ||
    ""
  ).toLowerCase() || null;

  // Graduated KCC20 tokens trade on the locked AMM pool, not the bonding curve.
  if (graduated) {
    if (!poolCovidHex) {
      throw new Error("This token has graduated but has no AMM pool covenant id.");
    }
    return runPoolBuy({
      submit,
      signOnly,
      automation,
      enforceMinimumOutput,
      privateKey,
      key,
      publicKey,
      walletAddress,
      buyerPubkey: buyerPubkey,
      entry,
      token,
      poolCovidHex,
      indexer,
    });
  }

  if (!entry.extensions.curveCovenantId) {
    throw new Error("Configured token has no active Kron bonding curve.");
  }
  if (!token.cpState) {
    throw new RetryableTradeStateError(
      "Bonding-curve state is temporarily unavailable; waiting to retry.",
    );
  }

  const templates = await kron.client.fetchCpTemplates({
    baseUrl: API_URL,
    tokenCovid: entry.covenantId,
    curveParams: entry.extensions.curveParams,
    templateVersion: entry.extensions.templateVersion ?? null,
  });
  const tokenCovid = toBytes(entry.covenantId);
  const curveCovid = toBytes(entry.extensions.curveCovenantId);
  const sequence = await new kron.client.SequencerClient(
    SEQUENCER_URL,
  ).curveHead(entry.extensions.curveCovenantId);
  if (submit && sequence.ok && sequence.head) {
    throw new RetryableTradeStateError(
      "The curve has an in-flight sequenced trade; waiting for it to settle.",
    );
  }
  const tokenReserve = BigInt(token.cpState.tokenReserve);
  const state = { graduated: false, tokenCovid, tokenReserve };
  const inventoryState = kron.kcc20.covenantIdOwned(curveCovid, tokenReserve, false);
  const curveAddress = kron.curveCp.cpAddress(k, templates.curve, state, NETWORK_ID);
  const inventoryAddress = kron.kcc20.kcc20Address(
    k,
    templates.token,
    inventoryState,
    NETWORK_ID,
  );

  const rpc = new k.RpcClient({
    url: NODE_URL,
    networkId: NETWORK_ID,
    encoding: k.Encoding.Borsh,
  });
  await rpc.connect();
  try {
    const [
      { entries: curveEntries },
      { entries: inventoryEntries },
      { entries: walletEntries },
      tokenBalanceResponse,
    ] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [curveAddress] }),
      rpc.getUtxosByAddresses({ addresses: [inventoryAddress] }),
      rpc.getUtxosByAddresses({ addresses: [walletAddress] }),
      indexer.balance(entry.symbol.toLowerCase(), walletAddress),
    ]);
    if (curveEntries.length !== 1 || inventoryEntries.length !== 1) {
      throw new RetryableTradeStateError(
        "Live curve state is temporarily ambiguous; waiting before retrying.",
      );
    }
    if (!walletEntries.length) throw new Error("Bot wallet has no spendable KAS UTXOs.");

    const curveParams = entry.extensions.curveParams;
    const quoteState = {
      realKas: BigInt(token.cpState.realKas),
      tokenReserve,
      vKas: BigInt(curveParams.vKas),
      graduationKas: BigInt(curveParams.graduationKas),
      creatorFeeBps: BigInt(curveParams.creatorFeeBps),
      platformFeeBps: BigInt(curveParams.platformFeeBps),
      devFundBps: BigInt(curveParams.devFundBps ?? 0),
    };
    const quote = kron.curve.quoteCpBuy(
      quoteState,
      BigInt(LIVE_TEST_KAS) * SOMPI_PER_KAS,
    );
    if (!quote?.tokenOut) throw new Error("Kron returned no executable 21 KAS buy quote.");

    const fundingEntries = [...walletEntries]
      .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))
      .slice(0, 1);
    const curveEntry = curveEntries[0];
    const inventoryEntry = inventoryEntries[0];
    const spend = kron.curveCp.buildCpBuy(
      k,
      templates.curve,
      templates.token,
      {
        transactionId: curveEntry.outpoint.transactionId,
        index: curveEntry.outpoint.index,
        realKas: BigInt(curveEntry.amount),
        state,
      },
      {
        transactionId: inventoryEntry.outpoint.transactionId,
        index: inventoryEntry.outpoint.index,
        value: BigInt(inventoryEntry.amount),
        amount: tokenReserve,
      },
      curveCovid,
      buyerPubkey,
      quote.kasIn,
      quote.tokenOut,
      [],
      2,
    );
    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee,
    });

    const fundingTotal = fundingEntries.reduce(
      (sum, item) => sum + BigInt(item.amount),
      0n,
    );
    const walletBalance = walletEntries.reduce(
      (sum, item) => sum + BigInt(item.amount),
      0n,
    );
    const maximumDebit = fundingTotal - assembly.change;
    const recipientDust = maximumDebit - quote.total - networkFee;
    if (maximumDebit > MAXIMUM_DEBIT_SOMPI) {
      throw new Error(
        `Maximum debit ${toKas(maximumDebit)} KAS exceeds the approved 22.75 KAS cap.`,
      );
    }
    if (!automation && walletBalance - maximumDebit < MINIMUM_RESERVE_SOMPI) {
      throw new Error("Trade would breach the 25 KAS wallet reserve.");
    }
    if (enforceMinimumOutput && quote.tokenOut < 8n) {
      throw new Error("Quote fell below the approved minimum output of 8 KDIST.");
    }
    const rawTokenBalance = Array.isArray(tokenBalanceResponse)
      ? tokenBalanceResponse[0]?.balance
      : (tokenBalanceResponse as any)?.balance;

    let transactionId: string | undefined;
    let fundingSignatureScriptBytes: number[] | undefined;
    if (submit || signOnly) {
      const inputsBefore = assembly.transaction.inputs;
      const covenantScripts = inputsBefore
        .slice(0, assembly.fundingInputIndexes[0])
        .map((input: any) => input.signatureScript);
      assembly.transaction = k.signTransaction(assembly.transaction, [key], false);
      const inputsAfter = assembly.transaction.inputs;
      covenantScripts.forEach((script: string, index: number) => {
        if (inputsAfter[index].signatureScript !== script) {
          throw new Error("Native signer modified a covenant input; refusing submission.");
        }
      });
      fundingSignatureScriptBytes = assembly.fundingInputIndexes.map((index) => {
        const script = inputsAfter[index].signatureScript;
        if (!script || typeof script !== "string" || script.length % 2 !== 0) {
          throw new Error("Native signer produced an invalid funding signature script.");
        }
        return script.length / 2;
      });
    }
    if (submit && !automation) {
      await mkdir(path.dirname(EXECUTION_LOCK), { recursive: true });
      await writeFile(
        EXECUTION_LOCK,
        JSON.stringify({ status: "pending", createdAt: new Date().toISOString() }),
        { flag: "wx" },
      );
      try {
        const result = await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        });
        transactionId = result.transactionId;
        await writeFile(
          EXECUTION_LOCK,
          JSON.stringify({
            status: "submitted",
            transactionId,
            submittedAt: new Date().toISOString(),
            tokenId: entry.covenantId,
            tradeKas: LIVE_TEST_KAS,
            maximumDebitKas: toKas(maximumDebit),
          }),
        );
      } catch (error) {
        await unlink(EXECUTION_LOCK).catch(() => undefined);
        throw error;
      }
    } else if (submit) {
      try {
        const result = await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        });
        transactionId = result.transactionId;
      } catch (error) {
        throw new TradeSubmissionAttemptedError(
          error instanceof Error ? error.message : "Buy submission failed with an unknown result.",
          error,
        );
      }
    }

    return {
      tokenId: entry.covenantId,
      symbol: entry.symbol,
      tokenName: entry.name,
      walletAddress,
      walletKasBalance: toKas(walletBalance),
      walletTokenBalance: Number(rawTokenBalance ?? 0),
      tradeKas: LIVE_TEST_KAS,
      tokenOut: Number(quote.tokenOut),
      kronFeeKas: toKas(quote.fee),
      networkFeeKas: toKas(networkFee),
      recipientDustKas: toKas(recipientDust),
      maximumDebitKas: toKas(maximumDebit),
      transactionBuilt: true,
      signed: submit || signOnly,
      submitted: submit,
      transactionId,
      fundingSignatureScriptBytes,
      preparedAt: new Date().toISOString(),
      warnings: [
        "This preview is state-dependent and must be rebuilt immediately before execution.",
        submit
          ? "The one-time live-test cap is now permanently consumed."
          : "No transaction was signed or submitted.",
        "Live execution is available only from the private server command line.",
      ],
    };
  } finally {
    await rpc.disconnect().catch(() => undefined);
    key = undefined;
  }
}

export type ManagedSellLot = {
  transactionId: string;
  index: number;
  amount: string;
};

export async function executeAutomatedSell(lot: ManagedSellLot) {
  return runAutomatedSell([lot], true);
}

export async function executeUserAutomatedSell(
  lot: ManagedSellLot,
  credentials: LiveBotCredentials,
) {
  return runAutomatedSell([lot], true, credentials);
}

/** Sell one or many managed lots in a single covenant transaction. */
export async function executeUserAutomatedSellLots(
  lots: ManagedSellLot[],
  credentials: LiveBotCredentials,
) {
  if (!lots.length) throw new Error("No managed token lots were provided to sell.");
  return runAutomatedSell(lots, true, credentials);
}

/**
 * Merge several presence-owned token lots into one UTXO so a later sell only needs
 * a single trader token input. Returns the consolidated lot outpoint.
 */
export async function executeUserAutomatedConsolidateLots(
  lots: ManagedSellLot[],
  credentials: LiveBotCredentials,
) {
  if (lots.length < 2) throw new Error("Consolidation needs at least two managed lots.");
  const privateKey = credentials.privateKey.trim();
  const tokenId = resolveLiveTokenId(credentials);
  if (!privateKey) throw new Error("Live wallet configuration is missing.");

  const k = await loadKaspa();
  const key = new k.PrivateKey(privateKey);
  const publicKey = key.toPublicKey();
  const walletAddress = publicKey.toAddress(k.NetworkType.Mainnet).toString();
  const registry = new kron.client.RegistryClient(API_URL);
  const indexer = new kron.client.IndexerClient(INDEXER_URL);
  const entry = (await registry.tokenlist({ all: true })).tokens.find(
    (token) => token.covenantId.toLowerCase() === tokenId,
  );
  if (!entry?.extensions.curveParams) {
    throw new Error("Configured token is missing Kron template params.");
  }
  const templates = await kron.client.fetchCpTemplates({
    baseUrl: API_URL,
    tokenCovid: entry.covenantId,
    curveParams: entry.extensions.curveParams,
    templateVersion: entry.extensions.templateVersion ?? null,
  });
  const tick = entry.symbol.toLowerCase();
  const owned = await indexer.tokenUtxos(tick, walletAddress);
  const prepared = lots.map((lot) => {
    const ownedLot = owned.find(
      (item) =>
        item.outpoint.transactionId === lot.transactionId &&
        item.outpoint.index === lot.index &&
        item.amount === lot.amount,
    );
    if (!ownedLot) throw new Error("Managed token lot is no longer spendable for consolidation.");
    const decoded = kron.kcc20.decodeKcc20Redeem(toBytes(ownedLot.redeemScriptHex));
    const sellerAddress = kron.kcc20.kcc20Address(
      k,
      decoded.template,
      decoded.state,
      NETWORK_ID,
    );
    return { lot, decoded, sellerAddress };
  });
  const sellerAddresses = [...new Set(prepared.map((item) => item.sellerAddress))];
  const rpc = new k.RpcClient({
    url: NODE_URL,
    networkId: NETWORK_ID,
    encoding: k.Encoding.Borsh,
  });
  await rpc.connect();
  try {
    const [{ entries: sellerEntries }, { entries: walletEntries }] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: sellerAddresses }),
      rpc.getUtxosByAddresses({ addresses: [walletAddress] }),
    ]);
    if (!walletEntries.length) throw new Error("Required funding UTXO is missing for consolidation.");
    const tokens = prepared.map(({ lot, decoded }) => {
      const sellerEntry = sellerEntries.find(
        (item: any) =>
          item.outpoint.transactionId === lot.transactionId &&
          item.outpoint.index === lot.index,
      );
      if (!sellerEntry) throw new Error("Required consolidate UTXO is missing.");
      return {
        transactionId: lot.transactionId,
        index: lot.index,
        value: BigInt(sellerEntry.amount),
        state: decoded.state,
      };
    });
    const fundingEntries = [...walletEntries]
      .sort((a: any, b: any) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))
      .slice(0, 1);
    // [...token inputs] [funding]
    const presenceWitnessIdx = tokens.length;
    const spend = kron.curveCp.buildConsolidate(
      k,
      templates.token,
      tokens,
      presenceWitnessIdx,
      { tokenCovid: entry.covenantId },
    );
    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee,
    });
    const covenantScripts = assembly.transaction.inputs
      .slice(0, assembly.fundingInputIndexes[0])
      .map((input: any) => input.signatureScript);
    assembly.transaction = k.signTransaction(assembly.transaction, [key], false);
    covenantScripts.forEach((script: string, index: number) => {
      if (assembly.transaction.inputs[index].signatureScript !== script) {
        throw new Error("Signer modified a covenant input.");
      }
    });
    let result = null;
    try {
      result = await rpc.submitTransaction({
        transaction: assembly.transaction,
        allowOrphan: false,
      });
    } catch (error) {
      throw new TradeSubmissionAttemptedError(
        error instanceof Error ? error.message : "Consolidate submission failed with an unknown result.",
        error,
      );
    }
    if (!result?.transactionId) {
      throw new Error("Consolidation returned no transaction ID.");
    }
    const totalAmount = tokens.reduce((sum, token) => sum + token.state.amount, 0n);
    return {
      transactionId: result.transactionId,
      index: 0,
      amount: totalAmount.toString(),
      lotCount: lots.length,
      networkFeeKas: toKas(networkFee),
      submitted: true,
    };
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}

export async function validateAutomatedSell(lot: ManagedSellLot) {
  return runAutomatedSell([lot], false);
}

async function runAutomatedSell(
  lots: ManagedSellLot[],
  submit: boolean,
  credentials?: LiveBotCredentials,
) {
  if (!lots.length) throw new Error("No managed token lots were provided to sell.");
  const privateKey = credentials?.privateKey.trim() ?? process.env.KASPA_BOT_PRIVATE_KEY?.trim();
  const tokenId = resolveLiveTokenId(credentials);
  if (!privateKey) throw new Error("Live wallet configuration is missing.");

  const k = await loadKaspa();
  const key = new k.PrivateKey(privateKey);
  const publicKey = key.toPublicKey();
  const walletAddress = publicKey.toAddress(k.NetworkType.Mainnet).toString();
  const traderPubkey = toBytes(publicKey.toXOnlyPublicKey().toString());
  const registry = new kron.client.RegistryClient(API_URL);
  const indexer = new kron.client.IndexerClient(INDEXER_URL);
  const entry = (await registry.tokenlist({ all: true })).tokens.find(
    (token) => token.covenantId.toLowerCase() === tokenId,
  );
  if (!entry?.extensions.curveParams) {
    throw new Error("Configured token is missing Kron template params.");
  }
  const token = unwrapIndexerRow<any>(await indexer.token(entry.symbol.toLowerCase()));
  if (!token) {
    throw new RetryableTradeStateError(
      "Indexer has no live state for this token yet; waiting to retry.",
    );
  }

  const graduated = Boolean(token.graduated || token.cpState?.graduated);
  const poolCovidHex = (
    entry.extensions.poolCovenantId ||
    token.poolCovenantId ||
    ""
  ).toLowerCase() || null;

  if (graduated) {
    if (!poolCovidHex) {
      throw new Error("This token has graduated but has no AMM pool covenant id.");
    }
    return runPoolSell({
      lots,
      submit,
      privateKey,
      key,
      publicKey,
      walletAddress,
      traderPubkey,
      entry,
      token,
      poolCovidHex,
      indexer,
    });
  }

  if (!entry.extensions.curveCovenantId) {
    throw new Error("Configured token has no active Kron bonding curve.");
  }
  if (!token.cpState) {
    throw new RetryableTradeStateError(
      "Bonding-curve state is temporarily unavailable; waiting to retry.",
    );
  }

  const sequence = await new kron.client.SequencerClient(
    SEQUENCER_URL,
  ).curveHead(entry.extensions.curveCovenantId);
  if (sequence.ok && sequence.head) {
    throw new RetryableTradeStateError(
      "The curve is busy with an in-flight sequenced trade; waiting before retrying.",
    );
  }

  const templates = await kron.client.fetchCpTemplates({
    baseUrl: API_URL,
    tokenCovid: entry.covenantId,
    curveParams: entry.extensions.curveParams,
    templateVersion: entry.extensions.templateVersion ?? null,
  });
  const tokenCovid = toBytes(entry.covenantId);
  const curveCovid = toBytes(entry.extensions.curveCovenantId);
  const tokenReserve = BigInt(token.cpState.tokenReserve);
  const totalTokenIn = lots.reduce((sum, lot) => sum + BigInt(lot.amount), 0n);
  const state = { graduated: false, tokenCovid, tokenReserve };
  const inventoryState = kron.kcc20.covenantIdOwned(curveCovid, tokenReserve, false);
  const curveAddress = kron.curveCp.cpAddress(k, templates.curve, state, NETWORK_ID);
  const inventoryAddress = kron.kcc20.kcc20Address(
    k,
    templates.token,
    inventoryState,
    NETWORK_ID,
  );
  const owned = await indexer.tokenUtxos(entry.symbol.toLowerCase(), walletAddress);
  const preparedLots = lots.map((lot) => {
    const ownedLot = owned.find(
      (item) =>
        item.outpoint.transactionId === lot.transactionId &&
        item.outpoint.index === lot.index &&
        item.amount === lot.amount,
    );
    if (!ownedLot) throw new Error("Managed token lot is no longer spendable.");
    const decoded = kron.kcc20.decodeKcc20Redeem(toBytes(ownedLot.redeemScriptHex));
    const sellerAddress = kron.kcc20.kcc20Address(
      k,
      decoded.template,
      decoded.state,
      NETWORK_ID,
    );
    return { lot, decoded, sellerAddress };
  });
  const sellerAddresses = [...new Set(preparedLots.map((item) => item.sellerAddress))];

  const rpc = new k.RpcClient({
    url: NODE_URL,
    networkId: NETWORK_ID,
    encoding: k.Encoding.Borsh,
  });
  await rpc.connect();
  try {
    const [
      { entries: curveEntries },
      { entries: inventoryEntries },
      { entries: sellerEntries },
      { entries: walletEntries },
    ] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [curveAddress] }),
      rpc.getUtxosByAddresses({ addresses: [inventoryAddress] }),
      rpc.getUtxosByAddresses({ addresses: sellerAddresses }),
      rpc.getUtxosByAddresses({ addresses: [walletAddress] }),
    ]);
    if (curveEntries.length !== 1 || inventoryEntries.length !== 1) {
      throw new RetryableTradeStateError(
        "Live curve state is temporarily ambiguous; waiting before retrying.",
      );
    }
    const sellerTokens = preparedLots.map(({ lot, decoded }) => {
      const sellerEntry = sellerEntries.find(
        (item) =>
          item.outpoint.transactionId === lot.transactionId &&
          item.outpoint.index === lot.index,
      );
      if (!sellerEntry) throw new Error("Required sell UTXO is missing.");
      return {
        transactionId: lot.transactionId,
        index: lot.index,
        value: BigInt(sellerEntry.amount),
        state: decoded.state,
      };
    });
    if (!walletEntries.length) throw new Error("Required sell UTXO is missing.");

    const p = entry.extensions.curveParams;
    const quote = kron.curve.quoteCpSell(
      {
        realKas: BigInt(token.cpState.realKas),
        tokenReserve,
        vKas: BigInt(p.vKas),
        graduationKas: BigInt(p.graduationKas),
        creatorFeeBps: BigInt(p.creatorFeeBps),
        platformFeeBps: BigInt(p.platformFeeBps),
        devFundBps: BigInt(p.devFundBps ?? 0),
      },
      totalTokenIn,
    );
    if (!quote?.net || quote.net <= 0n) throw new Error("Managed lots have no positive sell quote.");

    const fundingEntries = [...walletEntries]
      .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))
      .slice(0, 1);
    const curveEntry = curveEntries[0];
    const inventoryEntry = inventoryEntries[0];
    // [0]=curve [1]=inventory [...sellerTokens] [funding]
    const presenceWitnessIdx = 2 + sellerTokens.length;
    const spend = kron.curveCp.buildCpSell(
      k,
      templates.curve,
      templates.token,
      {
        transactionId: curveEntry.outpoint.transactionId,
        index: curveEntry.outpoint.index,
        realKas: BigInt(curveEntry.amount),
        state,
      },
      sellerTokens,
      {
        transactionId: inventoryEntry.outpoint.transactionId,
        index: inventoryEntry.outpoint.index,
        value: BigInt(inventoryEntry.amount),
        amount: tokenReserve,
      },
      curveCovid,
      traderPubkey,
      totalTokenIn,
      quote.kasOut,
      presenceWitnessIdx,
    );
    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee,
    });
    const fundingTotal = BigInt(fundingEntries[0].amount);
    const netCredit = assembly.change - fundingTotal;
    if (netCredit <= 0n) throw new Error("Assembled sell does not produce a positive KAS credit.");

    const covenantScripts = assembly.transaction.inputs
      .slice(0, assembly.fundingInputIndexes[0])
      .map((input: any) => input.signatureScript);
    assembly.transaction = k.signTransaction(assembly.transaction, [key], false);
    covenantScripts.forEach((script: string, index: number) => {
      if (assembly.transaction.inputs[index].signatureScript !== script) {
        throw new Error("Signer modified a covenant input.");
      }
    });
    let result = null;
    if (submit) {
      try {
        result = await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        });
      } catch (error) {
        throw new TradeSubmissionAttemptedError(
          error instanceof Error ? error.message : "Sell submission failed with an unknown result.",
          error,
        );
      }
    }
    return {
      transactionId: result?.transactionId,
      tokenIn: Number(totalTokenIn),
      lotCount: lots.length,
      grossKas: toKas(quote.kasOut),
      kronFeeKas: toKas(quote.fee),
      networkFeeKas: toKas(networkFee),
      netCreditKas: toKas(netCredit),
      signed: true,
      submitted: submit,
    };
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}

async function runPoolBuy(args: {
  submit: boolean;
  signOnly: boolean;
  automation: boolean;
  enforceMinimumOutput: boolean;
  privateKey: string;
  key: any;
  publicKey: any;
  walletAddress: string;
  buyerPubkey: Uint8Array;
  entry: any;
  token: any;
  poolCovidHex: string;
  indexer: InstanceType<typeof kron.client.IndexerClient>;
}) {
  const {
    submit,
    signOnly,
    automation,
    enforceMinimumOutput,
    key,
    walletAddress,
    buyerPubkey,
    entry,
    poolCovidHex,
    indexer,
  } = args;
  let workingKey = key;

  const templates = await kron.client.fetchCpTemplates({
    baseUrl: API_URL,
    tokenCovid: entry.covenantId,
    curveParams: entry.extensions.curveParams,
    templateVersion: entry.extensions.templateVersion ?? null,
  });
  if (!templates.pool) {
    throw new Error("Configured token is missing a compiled AMM pool template.");
  }

  const tick = entry.symbol.toLowerCase();
  const head = await resolvePoolHead(tick, indexer, submit);
  const poolCovid = toBytes(poolCovidHex);
  const tokenCovid = toBytes(entry.covenantId);
  const poolState = {
    kasReserve: BigInt(head.reserves.kasReserve),
    tokenReserve: BigInt(head.reserves.tokenReserve),
    tokenCovid,
    totalShares: BigInt(head.reserves.totalShares),
    lpCovid: toBytes(head.reserves.lpCovid || kron.genesis.ZERO_COVID),
  };
  const poolParams = poolParamsFromCurve(entry.extensions.curveParams);
  const quote = kron.poolCpV3.quotePoolV3Buy(
    poolState,
    poolParams,
    BigInt(LIVE_TEST_KAS) * SOMPI_PER_KAS,
  );
  if (!quote?.tokenOut) {
    throw new Error("Kron returned no executable AMM pool buy quote.");
  }

  const k = await loadKaspa();
  const inventoryState = kron.kcc20.covenantIdOwned(poolCovid, poolState.tokenReserve, false);
  const resolvedPoolAddress = kron.poolCpV3.poolCpV3Address(
    k,
    templates.pool,
    poolState,
    NETWORK_ID,
  );
  const inventoryAddress = kron.kcc20.kcc20Address(
    k,
    templates.token,
    inventoryState,
    NETWORK_ID,
  );

  const rpc = new k.RpcClient({
    url: NODE_URL,
    networkId: NETWORK_ID,
    encoding: k.Encoding.Borsh,
  });
  await rpc.connect();
  try {
    const [
      { entries: poolEntries },
      { entries: inventoryEntries },
      { entries: walletEntries },
      tokenBalanceResponse,
    ] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [resolvedPoolAddress] }),
      rpc.getUtxosByAddresses({ addresses: [inventoryAddress] }),
      rpc.getUtxosByAddresses({ addresses: [walletAddress] }),
      indexer.balance(tick, walletAddress),
    ]);

    const poolEntry = poolEntries.find(
      (item: any) =>
        item.outpoint.transactionId === head.pool.transactionId &&
        item.outpoint.index === head.pool.index,
    ) ?? (poolEntries.length === 1 ? poolEntries[0] : null);
    const inventoryEntry = inventoryEntries.find(
      (item: any) =>
        item.outpoint.transactionId === head.poolToken.transactionId &&
        item.outpoint.index === head.poolToken.index,
    ) ?? (inventoryEntries.length === 1 ? inventoryEntries[0] : null);

    if (!poolEntry || !inventoryEntry) {
      throw new RetryableTradeStateError(
        "Live AMM pool state is temporarily ambiguous; waiting before retrying.",
      );
    }
    if (!walletEntries.length) throw new Error("Bot wallet has no spendable KAS UTXOs.");

    const fundingEntries = [...walletEntries]
      .sort((a: any, b: any) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))
      .slice(0, 1);
    const presenceWitnessIdx = 2; // [0]=pool [1]=poolToken [2]=funding
    const spend = kron.poolCpV3.buildPoolV3SwapKasForToken(
      k,
      templates.pool,
      templates.token,
      poolParams,
      {
        transactionId: poolEntry.outpoint.transactionId,
        index: poolEntry.outpoint.index,
        state: poolState,
        tokenUtxo: {
          transactionId: inventoryEntry.outpoint.transactionId,
          index: inventoryEntry.outpoint.index,
          value: BigInt(inventoryEntry.amount),
        },
      },
      poolCovid,
      buyerPubkey,
      quote,
      [],
      presenceWitnessIdx,
    );

    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee,
    });

    const fundingTotal = fundingEntries.reduce(
      (sum: bigint, item: any) => sum + BigInt(item.amount),
      0n,
    );
    const walletBalance = walletEntries.reduce(
      (sum: bigint, item: any) => sum + BigInt(item.amount),
      0n,
    );
    const maximumDebit = fundingTotal - assembly.change;
    const recipientDust = maximumDebit - quote.total - networkFee;
    if (maximumDebit > MAXIMUM_DEBIT_SOMPI) {
      throw new Error(
        `Maximum debit ${toKas(maximumDebit)} KAS exceeds the approved 22.75 KAS cap.`,
      );
    }
    if (!automation && walletBalance - maximumDebit < MINIMUM_RESERVE_SOMPI) {
      throw new Error("Trade would breach the 25 KAS wallet reserve.");
    }
    if (enforceMinimumOutput && quote.tokenOut < 8n) {
      throw new Error("Quote fell below the approved minimum output of 8 tokens.");
    }
    const rawTokenBalance = Array.isArray(tokenBalanceResponse)
      ? tokenBalanceResponse[0]?.balance
      : (tokenBalanceResponse as any)?.balance;

    let transactionId: string | undefined;
    let fundingSignatureScriptBytes: number[] | undefined;
    if (submit || signOnly) {
      const inputsBefore = assembly.transaction.inputs;
      const covenantScripts = inputsBefore
        .slice(0, assembly.fundingInputIndexes[0])
        .map((input: any) => input.signatureScript);
      assembly.transaction = k.signTransaction(assembly.transaction, [workingKey], false);
      const inputsAfter = assembly.transaction.inputs;
      covenantScripts.forEach((script: string, index: number) => {
        if (inputsAfter[index].signatureScript !== script) {
          throw new Error("Native signer modified a covenant input; refusing submission.");
        }
      });
      fundingSignatureScriptBytes = assembly.fundingInputIndexes.map((index: number) => {
        const script = inputsAfter[index].signatureScript;
        if (!script || typeof script !== "string" || script.length % 2 !== 0) {
          throw new Error("Native signer produced an invalid funding signature script.");
        }
        return script.length / 2;
      });
    }
    if (submit && !automation) {
      await mkdir(path.dirname(EXECUTION_LOCK), { recursive: true });
      await writeFile(
        EXECUTION_LOCK,
        JSON.stringify({ status: "pending", createdAt: new Date().toISOString() }),
        { flag: "wx" },
      );
      try {
        const result = await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        });
        transactionId = result.transactionId;
        await writeFile(
          EXECUTION_LOCK,
          JSON.stringify({
            status: "submitted",
            transactionId,
            submittedAt: new Date().toISOString(),
            tokenId: entry.covenantId,
            tradeKas: LIVE_TEST_KAS,
            maximumDebitKas: toKas(maximumDebit),
            venue: "pool",
          }),
        );
      } catch (error) {
        await unlink(EXECUTION_LOCK).catch(() => undefined);
        throw error;
      }
    } else if (submit) {
      try {
        const result = await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        });
        transactionId = result.transactionId;
      } catch (error) {
        throw new TradeSubmissionAttemptedError(
          error instanceof Error ? error.message : "Pool buy submission failed with an unknown result.",
          error,
        );
      }
    }

    return {
      tokenId: entry.covenantId,
      symbol: entry.symbol,
      tokenName: entry.name,
      walletAddress,
      walletKasBalance: toKas(walletBalance),
      walletTokenBalance: Number(rawTokenBalance ?? 0),
      tradeKas: LIVE_TEST_KAS,
      tokenOut: Number(quote.tokenOut),
      kronFeeKas: toKas(quote.creatorFee + quote.platformFee + quote.lpFee),
      networkFeeKas: toKas(networkFee),
      recipientDustKas: toKas(recipientDust),
      maximumDebitKas: toKas(maximumDebit),
      transactionBuilt: true,
      signed: submit || signOnly,
      submitted: submit,
      transactionId,
      fundingSignatureScriptBytes,
      preparedAt: new Date().toISOString(),
      venue: "pool",
      warnings: [
        "This preview is state-dependent and must be rebuilt immediately before execution.",
        submit
          ? "The one-time live-test cap is now permanently consumed."
          : "No transaction was signed or submitted.",
        "Live execution is available only from the private server command line.",
      ],
    };
  } finally {
    await rpc.disconnect().catch(() => undefined);
    workingKey = undefined;
  }
}

async function runPoolSell(args: {
  lots: ManagedSellLot[];
  submit: boolean;
  privateKey: string;
  key: any;
  publicKey: any;
  walletAddress: string;
  traderPubkey: Uint8Array;
  entry: any;
  token: any;
  poolCovidHex: string;
  indexer: InstanceType<typeof kron.client.IndexerClient>;
}) {
  const {
    lots,
    submit,
    key,
    walletAddress,
    traderPubkey,
    entry,
    poolCovidHex,
    indexer,
  } = args;
  if (!lots.length) throw new Error("No managed token lots were provided to sell.");

  const templates = await kron.client.fetchCpTemplates({
    baseUrl: API_URL,
    tokenCovid: entry.covenantId,
    curveParams: entry.extensions.curveParams,
    templateVersion: entry.extensions.templateVersion ?? null,
  });
  if (!templates.pool) {
    throw new Error("Configured token is missing a compiled AMM pool template.");
  }

  const tick = entry.symbol.toLowerCase();
  const head = await resolvePoolHead(tick, indexer, submit);
  const poolCovid = toBytes(poolCovidHex);
  const tokenCovid = toBytes(entry.covenantId);
  const poolState = {
    kasReserve: BigInt(head.reserves.kasReserve),
    tokenReserve: BigInt(head.reserves.tokenReserve),
    tokenCovid,
    totalShares: BigInt(head.reserves.totalShares),
    lpCovid: toBytes(head.reserves.lpCovid || kron.genesis.ZERO_COVID),
  };
  const poolParams = poolParamsFromCurve(entry.extensions.curveParams);
  const k = await loadKaspa();
  const inventoryState = kron.kcc20.covenantIdOwned(poolCovid, poolState.tokenReserve, false);
  const resolvedPoolAddress = kron.poolCpV3.poolCpV3Address(
    k,
    templates.pool,
    poolState,
    NETWORK_ID,
  );
  const inventoryAddress = kron.kcc20.kcc20Address(
    k,
    templates.token,
    inventoryState,
    NETWORK_ID,
  );

  const owned = await indexer.tokenUtxos(tick, walletAddress);
  const preparedLots = lots.map((lot) => {
    const ownedLot = owned.find(
      (item) =>
        item.outpoint.transactionId === lot.transactionId &&
        item.outpoint.index === lot.index &&
        item.amount === lot.amount,
    );
    if (!ownedLot) throw new Error("Managed token lot is no longer spendable.");
    const decoded = kron.kcc20.decodeKcc20Redeem(toBytes(ownedLot.redeemScriptHex));
    const sellerAddress = kron.kcc20.kcc20Address(
      k,
      decoded.template,
      decoded.state,
      NETWORK_ID,
    );
    return { lot, decoded, sellerAddress };
  });
  // Quote from on-chain state amounts so multi-lot sells match covenant conservation.
  const totalTokenIn = preparedLots.reduce(
    (sum, item) => sum + BigInt(item.decoded.state.amount),
    0n,
  );
  const quote = kron.poolCpV3.quotePoolV3Sell(poolState, poolParams, totalTokenIn);
  if (!quote?.net || quote.net <= 0n) {
    throw new Error("Managed lots have no positive AMM pool sell quote.");
  }
  const sellerAddresses = [...new Set(preparedLots.map((item) => item.sellerAddress))];

  const rpc = new k.RpcClient({
    url: NODE_URL,
    networkId: NETWORK_ID,
    encoding: k.Encoding.Borsh,
  });
  await rpc.connect();
  try {
    const [
      { entries: poolEntries },
      { entries: inventoryEntries },
      { entries: sellerEntries },
      { entries: walletEntries },
    ] = await Promise.all([
      rpc.getUtxosByAddresses({ addresses: [resolvedPoolAddress] }),
      rpc.getUtxosByAddresses({ addresses: [inventoryAddress] }),
      rpc.getUtxosByAddresses({ addresses: sellerAddresses }),
      rpc.getUtxosByAddresses({ addresses: [walletAddress] }),
    ]);

    const poolEntry = poolEntries.find(
      (item: any) =>
        item.outpoint.transactionId === head.pool.transactionId &&
        item.outpoint.index === head.pool.index,
    ) ?? (poolEntries.length === 1 ? poolEntries[0] : null);
    const inventoryEntry = inventoryEntries.find(
      (item: any) =>
        item.outpoint.transactionId === head.poolToken.transactionId &&
        item.outpoint.index === head.poolToken.index,
    ) ?? (inventoryEntries.length === 1 ? inventoryEntries[0] : null);
    if (!poolEntry || !inventoryEntry) {
      throw new RetryableTradeStateError(
        "Live AMM pool state is temporarily ambiguous; waiting before retrying.",
      );
    }

    const traderTokens = preparedLots.map(({ lot, decoded }) => {
      const sellerEntry = sellerEntries.find(
        (item: any) =>
          item.outpoint.transactionId === lot.transactionId &&
          item.outpoint.index === lot.index,
      );
      if (!sellerEntry) throw new Error("Required sell UTXO is missing.");
      return {
        transactionId: lot.transactionId,
        index: lot.index,
        value: BigInt(sellerEntry.amount),
        state: decoded.state,
      };
    });
    if (!walletEntries.length) {
      throw new Error("Required sell UTXO is missing.");
    }

    const fundingEntries = [...walletEntries]
      .sort((a: any, b: any) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))
      .slice(0, 1);
    // [0]=pool [1]=poolToken [...traderTokens] [funding]
    const presenceWitnessIdx = 2 + traderTokens.length;
    const spend = kron.poolCpV3.buildPoolV3SwapTokenForKas(
      k,
      templates.pool,
      templates.token,
      poolParams,
      {
        transactionId: poolEntry.outpoint.transactionId,
        index: poolEntry.outpoint.index,
        state: poolState,
        tokenUtxo: {
          transactionId: inventoryEntry.outpoint.transactionId,
          index: inventoryEntry.outpoint.index,
          value: BigInt(inventoryEntry.amount),
        },
      },
      poolCovid,
      traderPubkey,
      traderTokens,
      quote,
      presenceWitnessIdx,
    );

    let assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee: 10_000n,
    });
    const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, assembly, 100);
    assembly = kron.spend.assembleNativeTx(k, {
      spend,
      fundingEntries,
      changeAddress: walletAddress,
      networkFee,
    });

    const fundingTotal = BigInt(fundingEntries[0].amount);
    const explicitTraderKas = templates.pool.recipientBound
      ? quote.kasOut - quote.creatorFee - quote.platformFee
      : 0n;
    const netCredit = assembly.change - fundingTotal + explicitTraderKas;
    if (netCredit <= 0n) {
      throw new Error("Assembled pool sell does not produce a positive KAS credit.");
    }

    const covenantScripts = assembly.transaction.inputs
      .slice(0, assembly.fundingInputIndexes[0])
      .map((input: any) => input.signatureScript);
    assembly.transaction = k.signTransaction(assembly.transaction, [key], false);
    covenantScripts.forEach((script: string, index: number) => {
      if (assembly.transaction.inputs[index].signatureScript !== script) {
        throw new Error("Signer modified a covenant input.");
      }
    });

    let result = null;
    if (submit) {
      try {
        result = await rpc.submitTransaction({
          transaction: assembly.transaction,
          allowOrphan: false,
        });
      } catch (error) {
        throw new TradeSubmissionAttemptedError(
          error instanceof Error ? error.message : "Pool sell submission failed with an unknown result.",
          error,
        );
      }
    }
    return {
      transactionId: result?.transactionId,
      tokenIn: Number(totalTokenIn),
      lotCount: lots.length,
      grossKas: toKas(quote.kasOut),
      kronFeeKas: toKas(quote.creatorFee + quote.platformFee + quote.lpFee),
      networkFeeKas: toKas(networkFee),
      netCreditKas: toKas(netCredit),
      signed: true,
      submitted: submit,
      venue: "pool",
    };
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}