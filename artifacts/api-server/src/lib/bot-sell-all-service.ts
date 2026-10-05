import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db, managedLotsTable, tradingBotsTable } from "@workspace/db";
import {
  executeUserAutomatedSellLots,
  RetryableTradeStateError,
  TradeSubmissionAttemptedError,
} from "./kron-live-service";
import { decryptPrivateKey } from "./user-app-service";
import { reconcileStaleInFlight } from "./interrupted-trade-service";
import { logger } from "./logger";

/** Concurrent requests only block while a sell-all is actively heartbeating. */
const ACTIVE_SELL_ALL_MS = 2 * 60_000;
/** Backoff when the curve/pool reports busy / transient reject. */
const RETRY_WAIT_MS = 20_000;
/** Overall deadline for one Sell All request. */
const SELL_ALL_DEADLINE_MS = 10 * 60_000;
/** Max rebuild/submit attempts per lot batch. */
const MAX_ATTEMPTS_PER_BATCH = 4;
/**
 * Multi-input AMM sells above this size have been observed to fail covenant
 * verification on-chain; fall back to smaller batches after one hard reject.
 */
const PREFERRED_SINGLE_TX_MAX_LOTS = 2;

type SellAllInFlight = {
  action: "sell-all";
  startedAt: string;
  heartbeatAt: string;
  lotCount?: number;
  soldCount?: number;
};

type ManagedLotRow = Awaited<ReturnType<typeof listOpenLots>>[number];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function listOpenLots(botId: string) {
  return db
    .select()
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, botId), isNull(managedLotsTable.soldAt)))
    .orderBy(asc(managedLotsTable.createdAt));
}

/** RPC rejections that did not land — safe to clear the lock / try another strategy. */
function isHardSubmissionRejection(message: string) {
  return /verification failed|script ran, but verification failed|failed to verify the signature script|double.?spend|already spent|insufficient funds|utxo.*not found|no longer spendable/i
    .test(message);
}

/** Transient node/mempool conditions worth a short retry of the same batch. */
function isTransientFailure(error: unknown, message: string) {
  if (error instanceof RetryableTradeStateError) return true;
  if (isHardSubmissionRejection(message)) return false;
  return /orphan|is an orphan|curve is busy|in-flight sequenced|amm pool has an in-flight|rejected transaction/i
    .test(message);
}

async function clearSellAllMarker(botId: string, marker: unknown) {
  await db.update(tradingBotsTable).set({
    inFlight: null,
    stopReason: null,
    updatedAt: new Date(),
  }).where(and(
    eq(tradingBotsTable.id, botId),
    eq(tradingBotsTable.inFlight, marker),
  ));
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

function chunkLots<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

async function sellLotBatch(args: {
  botId: string;
  credentials: { privateKey: string; tokenId: string };
  lots: ManagedLotRow[];
  inFlight: SellAllInFlight;
  deadline: number;
  previousTotalTrades: number;
  soldCount: number;
}): Promise<{ inFlight: SellAllInFlight; transactionId: string; soldCount: number; totalTrades: number }> {
  const { botId, credentials, lots, deadline } = args;
  let { inFlight, soldCount, previousTotalTrades } = args;
  const mapped = lots.map((lot) => ({
    transactionId: lot.buyTransactionId,
    index: lot.outputIndex,
    amount: lot.tokenAmount.toString(),
  }));
  let lastMessage = "Unknown sell failure";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BATCH && Date.now() < deadline; attempt += 1) {
    inFlight = await heartbeat(botId, inFlight, {
      lotCount: lots.length,
      soldCount,
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
        // Same inputs will keep failing covenant verification — let caller shrink the batch.
        throw new Error(lastMessage);
      }

      if (transient && attempt < MAX_ATTEMPTS_PER_BATCH && Date.now() + RETRY_WAIT_MS < deadline) {
        logger.warn({
          botId,
          attempt,
          lotCount: lots.length,
          err: lastMessage,
        }, "Sell-all retrying batch after transient failure");
        inFlight = await heartbeat(botId, inFlight, { lotCount: lots.length, soldCount });
        await sleep(RETRY_WAIT_MS);
        continue;
      }

      throw new Error(lastMessage);
    }
  }

  throw new Error(`Sell-all timed out: ${lastMessage}`);
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
    const marker = bot.inFlight as { action?: string; startedAt?: string; heartbeatAt?: string };
    if (marker.action === "sell-all") {
      const beat = typeof marker.heartbeatAt === "string"
        ? Date.parse(marker.heartbeatAt)
        : typeof marker.startedAt === "string"
          ? Date.parse(marker.startedAt)
          : Number.NaN;
      const ageMs = Number.isFinite(beat) ? Date.now() - beat : Number.POSITIVE_INFINITY;
      const activelyRunning = ageMs < ACTIVE_SELL_ALL_MS && !bot.stopReason;
      if (activelyRunning) {
        throw new Error("A sell-all operation is already in progress. Wait a moment and try again.");
      }
      await clearSellAllMarker(bot.id, bot.inFlight);
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
  let remaining = openLots;

  try {
    // Prefer one transaction when the open set is small enough to verify reliably.
    const batchSizes = remaining.length <= PREFERRED_SINGLE_TX_MAX_LOTS
      ? [remaining.length]
      : [remaining.length, PREFERRED_SINGLE_TX_MAX_LOTS, 1];

    let strategyIndex = 0;
    while (remaining.length > 0 && Date.now() < deadline) {
      const size = Math.min(batchSizes[Math.min(strategyIndex, batchSizes.length - 1)]!, remaining.length);
      const batches = chunkLots(remaining, size);
      try {
        for (const batch of batches) {
          if (Date.now() >= deadline) throw new Error("Sell-all timed out before all lots were sold.");
          const result = await sellLotBatch({
            botId: bot.id,
            credentials,
            lots: batch,
            inFlight,
            deadline,
            previousTotalTrades: totalTrades,
            soldCount,
          });
          inFlight = result.inFlight;
          sellTransactionIds.push(result.transactionId);
          soldCount = result.soldCount;
          totalTrades = result.totalTrades;
        }
        remaining = await listOpenLots(bot.id);
        if (remaining.length === 0) break;
        // Unexpected leftovers after a full pass — shrink batch size.
        strategyIndex += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown sell failure";
        const hard = isHardSubmissionRejection(message);
        if (hard && size > 1 && strategyIndex < batchSizes.length - 1) {
          logger.warn({
            botId: bot.id,
            size,
            err: message,
          }, "Sell-all shrinking batch size after hard rejection");
          strategyIndex += 1;
          remaining = await listOpenLots(bot.id);
          continue;
        }
        await db.update(tradingBotsTable).set({
          inFlight: null,
          stopReason: `Sell-all failed: ${message}`,
          phase: "selling",
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
        throw new Error(`Sell-all failed: ${message}`);
      }
    }

    remaining = await listOpenLots(bot.id);
    await db.update(tradingBotsTable).set({
      inFlight: null,
      stopReason: remaining.length === 0
        ? null
        : `Sell-all incomplete: ${remaining.length} managed lot(s) still open.`,
      phase: remaining.length === 0 ? "buying" : "selling",
      completedBuys: remaining.length === 0 ? 0 : bot.completedBuys,
      completedSells: remaining.length === 0 ? 0 : bot.completedSells,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));

    if (remaining.length > 0) {
      throw new Error(
        `Sell-all incomplete after ${soldCount} sale(s); ${remaining.length} managed lot(s) remain.`,
      );
    }

    return {
      soldCount,
      remainingOpenLots: 0,
      sellTransactionIds,
      complete: true,
      message: sellTransactionIds.length === 1
        ? `Sold all ${soldCount} managed position(s) in one transaction. You can withdraw KAS now.`
        : `Sold all ${soldCount} managed position(s) across ${sellTransactionIds.length} transaction(s). You can withdraw KAS now.`,
    };
  } catch (error) {
    throw error;
  }
}
