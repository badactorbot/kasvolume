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
/** Overall deadline for one Sell All request (single-tx retries). */
const SELL_ALL_DEADLINE_MS = 10 * 60_000;
/** Max rebuild/submit attempts for the one combined sell. */
const MAX_ATTEMPTS = 12;

type SellAllInFlight = {
  action: "sell-all";
  startedAt: string;
  heartbeatAt: string;
  lotCount?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function listOpenLots(botId: string) {
  return db
    .select()
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, botId), isNull(managedLotsTable.soldAt)))
    .orderBy(asc(managedLotsTable.createdAt));
}

/** RPC rejections that did not land on-chain — safe to retry or clear the lock. */
function isDefinitiveSubmissionRejection(message: string) {
  return /orphan|is an orphan|rejected transaction|double.?spend|already spent|insufficient funds|utxo.*not found|no longer spendable/i
    .test(message);
}

function isRetryableFailure(error: unknown, message: string) {
  if (error instanceof RetryableTradeStateError) return true;
  return /orphan|is an orphan|curve is busy|in-flight sequenced|amm pool has an in-flight|no longer spendable/i
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
  const lots = openLots.map((lot) => ({
    transactionId: lot.buyTransactionId,
    index: lot.outputIndex,
    amount: lot.tokenAmount.toString(),
  }));
  const deadline = Date.now() + SELL_ALL_DEADLINE_MS;
  let lastMessage = "Unknown sell failure";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && Date.now() < deadline; attempt += 1) {
      inFlight = await heartbeat(bot.id, inFlight, { lotCount: openLots.length });
      let submissionAttempted = false;
      try {
        const result = await executeUserAutomatedSellLots(lots, credentials);
        submissionAttempted = true;
        if (!result.transactionId) {
          throw new Error("Sell-all submission returned no transaction ID.");
        }

        const soldAt = new Date();
        await db.transaction(async (tx) => {
          for (const lot of openLots) {
            await tx.update(managedLotsTable).set({
              sellTransactionId: result.transactionId,
              soldAt,
            }).where(eq(managedLotsTable.id, lot.id));
          }
          await tx.update(tradingBotsTable).set({
            phase: "buying",
            completedBuys: 0,
            completedSells: 0,
            totalTrades: bot.totalTrades + 1,
            lastTradeAt: soldAt,
            nextRunAt: null,
            inFlight: null,
            stopReason: null,
            updatedAt: soldAt,
          }).where(eq(tradingBotsTable.id, bot.id));
        });

        logger.info({
          botId: bot.id,
          transactionId: result.transactionId,
          soldCount: openLots.length,
          tokenIn: result.tokenIn,
        }, "Sell-all completed in one transaction");

        return {
          soldCount: openLots.length,
          remainingOpenLots: 0,
          sellTransactionIds: [result.transactionId],
          complete: true,
          message: `Sold all ${openLots.length} managed position(s) in one transaction. You can withdraw KAS now.`,
        };
      } catch (error) {
        submissionAttempted ||= error instanceof TradeSubmissionAttemptedError;
        lastMessage = error instanceof Error ? error.message : "Unknown sell failure";
        const definitiveReject = submissionAttempted && isDefinitiveSubmissionRejection(lastMessage);
        const retryable = isRetryableFailure(error, lastMessage)
          || (submissionAttempted && definitiveReject);

        if (submissionAttempted && !definitiveReject) {
          await db.update(tradingBotsTable).set({
            status: "paused",
            nextRunAt: null,
            stopReason: `Sell-all paused after uncertain submission: ${lastMessage}`,
            inFlight,
            updatedAt: new Date(),
          }).where(eq(tradingBotsTable.id, bot.id));
          throw new Error(
            `Sell-all may have been submitted and needs reconciliation. ${lastMessage}`,
          );
        }

        if (retryable && attempt < MAX_ATTEMPTS && Date.now() + RETRY_WAIT_MS < deadline) {
          logger.warn({
            botId: bot.id,
            attempt,
            err: lastMessage,
          }, "Sell-all retrying single-tx sell after transient failure");
          inFlight = await heartbeat(bot.id, inFlight, { lotCount: openLots.length });
          await sleep(RETRY_WAIT_MS);
          continue;
        }

        await db.update(tradingBotsTable).set({
          inFlight: null,
          stopReason: `Sell-all failed: ${lastMessage}`,
          phase: "selling",
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
        throw new Error(`Sell-all failed: ${lastMessage}`);
      }
    }

    await db.update(tradingBotsTable).set({
      inFlight: null,
      stopReason: `Sell-all timed out: ${lastMessage}`,
      phase: "selling",
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));
    throw new Error(`Sell-all timed out: ${lastMessage}`);
  } catch (error) {
    throw error;
  }
}
