import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, managedLotsTable, tradingBotsTable } from "@workspace/db";
import {
  executeUserAutomatedConsolidateLots,
  executeUserAutomatedSellLots,
  RetryableTradeStateError,
  TradeSubmissionAttemptedError,
} from "./kron-live-service";
import { decryptPrivateKey } from "./user-app-service";
import { reconcileStaleInFlight } from "./interrupted-trade-service";
import { logger } from "./logger";

/** Concurrent requests only block while a sell-all is actively heartbeating.
 *  Vercel kills the function at 60s, so a lock older than this is a crashed run. */
const ACTIVE_SELL_ALL_MS = 90_000;
/** Wait between one-lot fallback sells so the pool/sequencer can settle. */
const BETWEEN_LOTS_MS = 8_000;
/** Backoff when the curve/pool reports busy / transient reject. */
const RETRY_WAIT_MS = 20_000;
/** Overall deadline for one Sell All request. */
const SELL_ALL_DEADLINE_MS = 10 * 60_000;
/** Max rebuild/submit attempts per lot batch. */
const MAX_ATTEMPTS_PER_BATCH = 4;

type SellAllInFlight = {
  action: "sell-all";
  startedAt: string;
  heartbeatAt: string;
  lotCount?: number;
  soldCount?: number;
  stage?: "sell" | "consolidate";
};

type ManagedLotRow = Awaited<ReturnType<typeof listOpenLots>>[number];
type LiveCredentials = { privateKey: string; tokenId: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function listOpenLots(botId: string) {
  return db
    .select()
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, botId), isNull(managedLotsTable.soldAt)))
    .orderBy(asc(managedLotsTable.createdAt));
}

/**
 * Covenant/presence script rejects — the tx never landed.
 * Multi-lot AMM pool sells often fail here while one-lot (or consolidate-then-sell) succeeds.
 */
function isSignatureScriptRejection(message: string) {
  return /verification failed|script ran, but verification failed|failed to verify the signature script/i
    .test(message);
}

/** RPC rejections that did not land — safe to clear the lock / try another strategy. */
function isHardSubmissionRejection(message: string) {
  return isSignatureScriptRejection(message)
    || /double.?spend|already spent|insufficient funds|utxo.*not found|no longer spendable/i
      .test(message);
}

/** Transient node/mempool conditions worth a short retry of the same batch. */
function isTransientFailure(error: unknown, message: string) {
  if (error instanceof RetryableTradeStateError) return true;
  if (isHardSubmissionRejection(message)) return false;
  return /orphan|is an orphan|curve is busy|in-flight sequenced|amm pool has an in-flight|rejected transaction/i
    .test(message);
}

function sellAllMarkerAgeMs(marker: { heartbeatAt?: string; startedAt?: string }) {
  const beat = typeof marker.heartbeatAt === "string"
    ? Date.parse(marker.heartbeatAt)
    : typeof marker.startedAt === "string"
      ? Date.parse(marker.startedAt)
      : Number.NaN;
  return Number.isFinite(beat) ? Date.now() - beat : Number.POSITIVE_INFINITY;
}

function retainSellAllForReconciliation(stopReason: string | null | undefined) {
  return /uncertain|reconcil/i.test(stopReason ?? "");
}

function describeActiveSellAll(marker: {
  soldCount?: number;
  lotCount?: number;
  stage?: string;
  heartbeatAt?: string;
  startedAt?: string;
}) {
  const ageSec = Math.max(0, Math.round(sellAllMarkerAgeMs(marker) / 1000));
  const sold = typeof marker.soldCount === "number" ? marker.soldCount : 0;
  const lots = typeof marker.lotCount === "number" ? marker.lotCount : undefined;
  const stage = marker.stage === "consolidate" ? "merging lots" : "selling";
  return lots != null
    ? `${stage}, ${sold} of ${lots} sold, last update ${ageSec}s ago`
    : `${stage}, last update ${ageSec}s ago`;
}

async function clearSellAllByAction(botId: string) {
  await db.update(tradingBotsTable).set({
    inFlight: null,
    stopReason: null,
    updatedAt: new Date(),
  }).where(and(
    eq(tradingBotsTable.id, botId),
    sql`${tradingBotsTable.inFlight}->>'action' = 'sell-all'`,
  ));
}

/** Refresh / dashboard: drop a crashed sell-all lock so the user can retry. */
export async function expireStaleSellAllInFlight(bot: {
  id: string;
  inFlight: unknown;
  stopReason: string | null;
}) {
  const marker = bot.inFlight as { action?: string; startedAt?: string; heartbeatAt?: string } | null;
  if (!marker || marker.action !== "sell-all") return { cleared: false, active: false };
  if (retainSellAllForReconciliation(bot.stopReason)) {
    return { cleared: false, active: true };
  }
  const ageMs = sellAllMarkerAgeMs(marker);
  const rejected = isHardSubmissionRejection(bot.stopReason ?? "");
  if (!rejected && ageMs < ACTIVE_SELL_ALL_MS) {
    return { cleared: false, active: true };
  }
  await clearSellAllByAction(bot.id);
  logger.warn({ botId: bot.id, ageMs }, "Cleared stalled sell-all marker on dashboard refresh");
  return { cleared: true, active: false };
}

async function heartbeat(botId: string, base: SellAllInFlight, patch: Partial<SellAllInFlight> = {}) {
  const next: SellAllInFlight = {
    ...base,
    ...patch,
    heartbeatAt: new Date().toISOString(),
  };
  await db.update(tradingBotsTable).set({
    inFlight: next,
    updatedAt: new Date(),
  }).where(eq(tradingBotsTable.id, botId));
  return next;
}

async function markLotsSold(
  botId: string,
  lots: ManagedLotRow[],
  transactionId: string,
  previousTotalTrades: number,
) {
  const soldAt = new Date();
  await db.transaction(async (tx) => {
    for (const lot of lots) {
      await tx.update(managedLotsTable).set({
        sellTransactionId: transactionId,
        soldAt,
      }).where(eq(managedLotsTable.id, lot.id));
    }
    const remaining = await tx
      .select({ id: managedLotsTable.id })
      .from(managedLotsTable)
      .where(and(eq(managedLotsTable.botId, botId), isNull(managedLotsTable.soldAt)))
      .limit(1);
    const cleared = remaining.length === 0;
    await tx.update(tradingBotsTable).set({
      phase: cleared ? "buying" : "selling",
      ...(cleared ? { completedBuys: 0, completedSells: 0 } : {}),
      totalTrades: previousTotalTrades + 1,
      lastTradeAt: soldAt,
      nextRunAt: null,
      stopReason: null,
      updatedAt: soldAt,
    }).where(eq(tradingBotsTable.id, botId));
  });
  return soldAt;
}

async function sellMappedLots(args: {
  botId: string;
  credentials: LiveCredentials;
  lots: ManagedLotRow[];
  mapped: { transactionId: string; index: number; amount: string }[];
  inFlight: SellAllInFlight;
  deadline: number;
  previousTotalTrades: number;
  soldCount: number;
  stage: "sell" | "consolidate";
}): Promise<{ inFlight: SellAllInFlight; transactionId: string; soldCount: number; totalTrades: number }> {
  const { botId, credentials, lots, mapped, deadline, stage } = args;
  let { inFlight, soldCount, previousTotalTrades } = args;
  let lastMessage = "Unknown sell failure";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BATCH && Date.now() < deadline; attempt += 1) {
    inFlight = await heartbeat(botId, inFlight, {
      lotCount: lots.length,
      soldCount,
      stage,
    });
    let submissionAttempted = false;
    try {
      const result = await executeUserAutomatedSellLots(mapped, credentials);
      submissionAttempted = true;
      if (!result.transactionId) {
        throw new Error("Sell-all submission returned no transaction ID.");
      }
      await markLotsSold(botId, lots, result.transactionId, previousTotalTrades);
      previousTotalTrades += 1;
      soldCount += lots.length;
      logger.info({
        botId,
        transactionId: result.transactionId,
        soldCount: lots.length,
        tokenIn: result.tokenIn,
        stage,
      }, "Sell-all batch completed");
      return {
        inFlight,
        transactionId: result.transactionId,
        soldCount,
        totalTrades: previousTotalTrades,
      };
    } catch (error) {
      submissionAttempted ||= error instanceof TradeSubmissionAttemptedError;
      lastMessage = error instanceof Error ? error.message : "Unknown sell failure";
      const hardReject = isHardSubmissionRejection(lastMessage);
      const transient = isTransientFailure(error, lastMessage);

      if (submissionAttempted && !hardReject && !transient) {
        await db.update(tradingBotsTable).set({
          status: "paused",
          nextRunAt: null,
          stopReason: `Sell-all paused after uncertain submission: ${lastMessage}`,
          inFlight,
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, botId));
        throw new Error(
          `Sell-all may have been submitted and needs reconciliation. ${lastMessage}`,
        );
      }

      if (hardReject) {
        throw new Error(lastMessage);
      }

      if (transient && attempt < MAX_ATTEMPTS_PER_BATCH && Date.now() + RETRY_WAIT_MS < deadline) {
        logger.warn({
          botId,
          attempt,
          lotCount: lots.length,
          err: lastMessage,
          stage,
        }, "Sell-all retrying batch after transient failure");
        inFlight = await heartbeat(botId, inFlight, { lotCount: lots.length, soldCount, stage });
        await sleep(RETRY_WAIT_MS);
        continue;
      }

      throw new Error(lastMessage);
    }
  }

  throw new Error(`Sell-all timed out: ${lastMessage}`);
}

/** Merge many lots into one token UTXO, then sell that piece in a second TX. */
async function consolidateThenSell(args: {
  botId: string;
  credentials: LiveCredentials;
  lots: ManagedLotRow[];
  inFlight: SellAllInFlight;
  deadline: number;
  previousTotalTrades: number;
  soldCount: number;
}) {
  const { botId, credentials, lots, deadline } = args;
  let { inFlight, soldCount, previousTotalTrades } = args;
  let lastMessage = "Unknown consolidate failure";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BATCH && Date.now() < deadline; attempt += 1) {
    inFlight = await heartbeat(botId, inFlight, {
      lotCount: lots.length,
      soldCount,
      stage: "consolidate",
    });
    let submissionAttempted = false;
    try {
      const mapped = lots.map((lot) => ({
        transactionId: lot.buyTransactionId,
        index: lot.outputIndex,
        amount: lot.tokenAmount.toString(),
      }));
      const consolidated = await executeUserAutomatedConsolidateLots(mapped, credentials);
      submissionAttempted = true;
      logger.info({
        botId,
        transactionId: consolidated.transactionId,
        lotCount: lots.length,
        amount: consolidated.amount,
      }, "Sell-all consolidated lots into one token UTXO");

      const sold = await sellMappedLots({
        botId,
        credentials,
        lots,
        mapped: [{
          transactionId: consolidated.transactionId,
          index: consolidated.index,
          amount: consolidated.amount,
        }],
        inFlight,
        deadline,
        previousTotalTrades,
        soldCount,
        stage: "sell",
      });
      return {
        ...sold,
        consolidateTransactionId: consolidated.transactionId,
      };
    } catch (error) {
      submissionAttempted ||= error instanceof TradeSubmissionAttemptedError;
      lastMessage = error instanceof Error ? error.message : "Unknown consolidate failure";
      const hardReject = isHardSubmissionRejection(lastMessage);
      const transient = isTransientFailure(error, lastMessage);

      if (submissionAttempted && !hardReject && !transient) {
        await db.update(tradingBotsTable).set({
          status: "paused",
          nextRunAt: null,
          stopReason: `Sell-all paused after uncertain consolidation: ${lastMessage}`,
          inFlight,
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, botId));
        throw new Error(
          `Sell-all may have consolidated on-chain and needs reconciliation. ${lastMessage}`,
        );
      }

      if (hardReject) throw new Error(lastMessage);

      if (transient && attempt < MAX_ATTEMPTS_PER_BATCH && Date.now() + RETRY_WAIT_MS < deadline) {
        logger.warn({
          botId,
          attempt,
          err: lastMessage,
        }, "Sell-all retrying consolidate after transient failure");
        await sleep(RETRY_WAIT_MS);
        continue;
      }
      throw new Error(lastMessage);
    }
  }

  throw new Error(`Sell-all consolidate timed out: ${lastMessage}`);
}

async function sellLotsOneByOne(args: {
  botId: string;
  credentials: LiveCredentials;
  lots: ManagedLotRow[];
  inFlight: SellAllInFlight;
  deadline: number;
  previousTotalTrades: number;
  soldCount: number;
}): Promise<{
  inFlight: SellAllInFlight;
  sellTransactionIds: string[];
  soldCount: number;
  totalTrades: number;
}> {
  const { botId, credentials, lots, deadline } = args;
  let { inFlight, soldCount, previousTotalTrades } = args;
  const sellTransactionIds: string[] = [];
  for (let i = 0; i < lots.length && Date.now() < deadline; i += 1) {
    const lot = lots[i];
    const result = await sellMappedLots({
      botId,
      credentials,
      lots: [lot],
      mapped: [{
        transactionId: lot.buyTransactionId,
        index: lot.outputIndex,
        amount: lot.tokenAmount.toString(),
      }],
      inFlight,
      deadline,
      previousTotalTrades,
      soldCount,
      stage: "sell",
    });
    inFlight = result.inFlight;
    sellTransactionIds.push(result.transactionId);
    soldCount = result.soldCount;
    previousTotalTrades = result.totalTrades;
    if (i < lots.length - 1 && Date.now() + BETWEEN_LOTS_MS < deadline) {
      inFlight = await heartbeat(botId, inFlight, { soldCount, stage: "sell" });
      await sleep(BETWEEN_LOTS_MS);
    }
  }
  return { inFlight, sellTransactionIds, soldCount, totalTrades: previousTotalTrades };
}

export async function sellAllUserBotManagedPositions(userId: string) {
  let [bot] = await db.select().from(tradingBotsTable)
    .where(eq(tradingBotsTable.userId, userId))
    .limit(1);
  if (!bot) throw new Error("Bot wallet was not found.");
  const tokenId = bot.tokenId;
  if (!tokenId) throw new Error("Bot has no configured token to sell.");
  if (bot.status === "running") {
    throw new Error("Stop trading before selling remaining managed positions.");
  }

  if (bot.inFlight) {
    const marker = bot.inFlight as {
      action?: string;
      startedAt?: string;
      heartbeatAt?: string;
      soldCount?: number;
      lotCount?: number;
      stage?: string;
    };
    if (marker.action === "sell-all") {
      if (retainSellAllForReconciliation(bot.stopReason)) {
        throw new Error(
          bot.stopReason
            ?? "The last sell needs reconciliation before retrying Sell All.",
        );
      }
      const ageMs = sellAllMarkerAgeMs(marker);
      const rejected = isHardSubmissionRejection(bot.stopReason ?? "");
      const activelyRunning = !rejected && ageMs < ACTIVE_SELL_ALL_MS;
      if (activelyRunning) {
        throw new Error(
          `Sell All is still running (${describeActiveSellAll(marker)}). `
            + "Wait for that submit to finish. If it stays stuck, wait about 90 seconds and click Sell All again.",
        );
      }
      await clearSellAllByAction(bot.id);
      logger.warn({ botId: bot.id, ageMs, stopReason: bot.stopReason }, "Cleared stalled sell-all marker for retry");
      [bot] = await db.select().from(tradingBotsTable)
        .where(eq(tradingBotsTable.id, bot.id))
        .limit(1);
      if (!bot) throw new Error("Bot wallet was not found.");
      if (bot.inFlight) {
        throw new Error("The bot operation changed. Refresh and try sell all again.");
      }
    } else {
      await reconcileStaleInFlight(bot);
      [bot] = await db.select().from(tradingBotsTable)
        .where(eq(tradingBotsTable.id, bot.id))
        .limit(1);
      if (!bot || bot.inFlight) {
        throw new Error("The interrupted trade requires reconciliation before selling positions.");
      }
    }
  }

  const openLots = await listOpenLots(bot.id);
  if (openLots.length === 0) {
    return {
      soldCount: 0,
      remainingOpenLots: 0,
      sellTransactionIds: [] as string[],
      complete: true,
      message: "No open managed token positions to sell.",
    };
  }

  const startedAt = new Date();
  let inFlight: SellAllInFlight = {
    action: "sell-all",
    startedAt: startedAt.toISOString(),
    heartbeatAt: startedAt.toISOString(),
    lotCount: openLots.length,
    soldCount: 0,
    stage: "sell",
  };
  const [claim] = await db.update(tradingBotsTable).set({
    inFlight,
    stopReason: null,
    updatedAt: startedAt,
  }).where(and(
    eq(tradingBotsTable.id, bot.id),
    ne(tradingBotsTable.status, "running"),
    isNull(tradingBotsTable.inFlight),
  )).returning({ id: tradingBotsTable.id });
  if (!claim) throw new Error("The bot state changed. Refresh and try sell all again.");

  const credentials = {
    privateKey: decryptPrivateKey(bot.encryptedPrivateKey),
    tokenId,
  };
  const deadline = Date.now() + SELL_ALL_DEADLINE_MS;
  const sellTransactionIds: string[] = [];
  let soldCount = 0;
  let totalTrades = bot.totalTrades;

  try {
    const mapped = openLots.map((lot) => ({
      transactionId: lot.buyTransactionId,
      index: lot.outputIndex,
      amount: lot.tokenAmount.toString(),
    }));

    /**
     * Multi-lot AMM pool sells frequently fail covenant/presence verification on-chain
     * (same "script ran, but verification failed" as a bad funding sig). One-lot sells and
     * consolidate-then-sell clear those positions. Skip the doomed combined submit when
     * there is more than one open lot.
     */
    try {
      if (openLots.length === 1) {
        const result = await sellMappedLots({
          botId: bot.id,
          credentials,
          lots: openLots,
          mapped,
          inFlight,
          deadline,
          previousTotalTrades: totalTrades,
          soldCount,
          stage: "sell",
        });
        inFlight = result.inFlight;
        sellTransactionIds.push(result.transactionId);
        soldCount = result.soldCount;
        totalTrades = result.totalTrades;
      } else {
        logger.info({
          botId: bot.id,
          lotCount: openLots.length,
        }, "Sell-all using one-lot submits to avoid multi-input AMM verify rejects");
        const sequential = await sellLotsOneByOne({
          botId: bot.id,
          credentials,
          lots: openLots,
          inFlight,
          deadline,
          previousTotalTrades: totalTrades,
          soldCount,
        });
        inFlight = sequential.inFlight;
        sellTransactionIds.push(...sequential.sellTransactionIds);
        soldCount = sequential.soldCount;
        totalTrades = sequential.totalTrades;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sell failure";
      if (/needs reconciliation|uncertain submission|uncertain consolidation/i.test(message)) {
        throw error;
      }
      // Soft/unexpected failures — surface and clear the lock.
      if (!isHardSubmissionRejection(message)) {
        await db.update(tradingBotsTable).set({
          inFlight: null,
          stopReason: `Sell-all failed: ${message}`,
          phase: "selling",
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
        throw new Error(`Sell-all failed: ${message}`);
      }

      let remaining = await listOpenLots(bot.id);
      if (remaining.length === 0) {
        soldCount = openLots.length;
      } else if (remaining.length >= 2 && isHardSubmissionRejection(message)) {
        logger.warn({
          botId: bot.id,
          lotCount: remaining.length,
          err: message,
        }, "Sell-all falling back to consolidate-then-sell after lot rejects");
        const result = await consolidateThenSell({
          botId: bot.id,
          credentials,
          lots: remaining,
          inFlight,
          deadline,
          previousTotalTrades: totalTrades,
          soldCount,
        });
        inFlight = result.inFlight;
        sellTransactionIds.push(result.transactionId);
        soldCount = result.soldCount;
        totalTrades = result.totalTrades;
      } else {
        await db.update(tradingBotsTable).set({
          inFlight: null,
          stopReason: `Sell-all failed: ${message}`,
          phase: "selling",
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
        throw error;
      }
    }

    const leftover = await listOpenLots(bot.id);
    await db.update(tradingBotsTable).set({
      inFlight: null,
      stopReason: leftover.length === 0
        ? null
        : `Sell-all incomplete: ${leftover.length} managed lot(s) still open.`,
      phase: leftover.length === 0 ? "buying" : "selling",
      completedBuys: leftover.length === 0 ? 0 : bot.completedBuys,
      completedSells: leftover.length === 0 ? 0 : bot.completedSells,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));

    if (leftover.length > 0) {
      throw new Error(
        `Sell-all incomplete after ${soldCount} sale(s); ${leftover.length} managed lot(s) remain.`,
      );
    }

    return {
      soldCount,
      remainingOpenLots: 0,
      sellTransactionIds,
      complete: true,
      message: sellTransactionIds.length === 1
        ? `Sold all ${soldCount} managed position(s) in one transaction. You can withdraw KAS now.`
        : `Sold all ${soldCount} managed position(s) across ${sellTransactionIds.length} sell transaction(s). You can withdraw KAS now.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/needs reconciliation|uncertain submission|uncertain consolidation/i.test(message)) {
      await db.update(tradingBotsTable).set({
        inFlight: null,
        updatedAt: new Date(),
      }).where(and(
        eq(tradingBotsTable.id, bot.id),
        sql`${tradingBotsTable.inFlight}->>'action' = 'sell-all'`,
      ));
    }
    throw error;
  }
}
