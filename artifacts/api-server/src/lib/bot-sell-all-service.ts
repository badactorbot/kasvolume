import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import { db, managedLotsTable, tradingBotsTable } from "@workspace/db";
import {
  executeUserAutomatedSell,
  RetryableTradeStateError,
  TradeSubmissionAttemptedError,
} from "./kron-live-service";
import { decryptPrivateKey } from "./user-app-service";
import { reconcileStaleInFlight } from "./interrupted-trade-service";
import { logger } from "./logger";

const ACTIVE_SELL_ALL_MS = 2 * 60_000;

type SellAllInFlight = {
  action: "sell-all";
  startedAt: string;
  currentLotId?: string;
};

async function countOpenLots(botId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, botId), isNull(managedLotsTable.soldAt)));
  return Number(row?.value ?? 0);
}

/** RPC rejections that did not land on-chain — safe to clear the sell-all lock. */
function isDefinitiveSubmissionRejection(message: string) {
  return /orphan|is an orphan|rejected transaction|double.?spend|already spent|insufficient funds|utxo.*not found|no longer spendable/i
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
    const marker = bot.inFlight as { action?: string; startedAt?: string };
    if (marker.action === "sell-all") {
      const startedAt = typeof marker.startedAt === "string"
        ? Date.parse(marker.startedAt)
        : Number.NaN;
      const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : Number.POSITIVE_INFINITY;
      // Only block while a sell-all is actively running with no failure recorded.
      // Once stopReason is set (or the marker is stale), open lots are source of truth — allow retry.
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

  const openLots = await db
    .select()
    .from(managedLotsTable)
    .where(and(eq(managedLotsTable.botId, bot.id), isNull(managedLotsTable.soldAt)))
    .orderBy(asc(managedLotsTable.createdAt));
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
  const inFlight: SellAllInFlight = {
    action: "sell-all",
    startedAt: startedAt.toISOString(),
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
  const sellTransactionIds: string[] = [];
  let soldCount = 0;
  const initialTotalTrades = bot.totalTrades;

  for (const lot of openLots) {
    const lotMarker: SellAllInFlight = {
      ...inFlight,
      currentLotId: lot.id,
    };
    await db.update(tradingBotsTable).set({
      inFlight: lotMarker,
      updatedAt: new Date(),
    }).where(eq(tradingBotsTable.id, bot.id));

    let submissionAttempted = false;
    try {
      const result = await executeUserAutomatedSell({
        transactionId: lot.buyTransactionId,
        index: lot.outputIndex,
        amount: lot.tokenAmount.toString(),
      }, credentials);
      submissionAttempted = true;
      if (!result.transactionId) {
        throw new Error("Sell submission returned no transaction ID.");
      }

      await db.transaction(async (tx) => {
        await tx.update(managedLotsTable).set({
          sellTransactionId: result.transactionId,
          soldAt: new Date(),
        }).where(eq(managedLotsTable.id, lot.id));
        await tx.update(tradingBotsTable).set({
          totalTrades: initialTotalTrades + soldCount + 1,
          lastTradeAt: new Date(),
          inFlight: lotMarker,
          stopReason: null,
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
      });

      sellTransactionIds.push(result.transactionId);
      soldCount += 1;
      logger.info({ botId: bot.id, lotId: lot.id, transactionId: result.transactionId }, "Sell-all lot sold");
    } catch (error) {
      submissionAttempted ||= error instanceof TradeSubmissionAttemptedError;
      const message = error instanceof Error ? error.message : "Unknown sell failure";
      const remainingOpenLots = await countOpenLots(bot.id);
      const definitiveReject = submissionAttempted && isDefinitiveSubmissionRejection(message);

      if (submissionAttempted && !definitiveReject) {
        await db.update(tradingBotsTable).set({
          status: "paused",
          nextRunAt: null,
          stopReason: `Sell-all paused after uncertain submission: ${message}`,
          inFlight: lotMarker,
          updatedAt: new Date(),
        }).where(eq(tradingBotsTable.id, bot.id));
        throw new Error(
          `Sold ${soldCount} position(s); a later sell may have been submitted and needs reconciliation. ${message}`,
        );
      }

      // Clear lock on pre-submit failures and definitive RPC rejections (e.g. orphan)
      // so the user can retry immediately. Unsold lots remain open in managed_lots.
      await db.update(tradingBotsTable).set({
        inFlight: null,
        stopReason: soldCount > 0
          ? `Sell-all stopped after ${soldCount} sale(s): ${message}`
          : `Sell-all failed: ${message}`,
        phase: remainingOpenLots === 0 ? "buying" : "selling",
        completedBuys: remainingOpenLots === 0 ? 0 : bot.completedBuys,
        completedSells: remainingOpenLots === 0 ? 0 : bot.completedSells,
        updatedAt: new Date(),
      }).where(eq(tradingBotsTable.id, bot.id));

      if (error instanceof RetryableTradeStateError) {
        throw new Error(
          `Sold ${soldCount} of ${openLots.length} position(s). Curve busy — wait a moment and retry Sell all. ${message}`,
        );
      }
      throw new Error(
        `Sold ${soldCount} of ${openLots.length} position(s), then failed: ${message}`,
      );
    }
  }

  const remainingOpenLots = await countOpenLots(bot.id);
  await db.update(tradingBotsTable).set({
    phase: "buying",
    completedBuys: 0,
    completedSells: 0,
    nextRunAt: null,
    inFlight: null,
    stopReason: null,
    updatedAt: new Date(),
  }).where(eq(tradingBotsTable.id, bot.id));

  return {
    soldCount,
    remainingOpenLots,
    sellTransactionIds,
    complete: remainingOpenLots === 0,
    message: remainingOpenLots === 0
      ? `Sold ${soldCount} managed position(s). You can withdraw KAS now.`
      : `Sold ${soldCount} position(s); ${remainingOpenLots} remain. Retry Sell all.`,
  };
}
