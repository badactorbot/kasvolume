import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db, managedLotsTable, tradingBotsTable } from "@workspace/db";
import {
  executeUserAutomatedBuy,
  executeUserAutomatedSell,
  RetryableTradeStateError,
  TradeSubmissionAttemptedError,
} from "./kron-live-service";
import { decryptPrivateKey } from "./user-app-service";
import { logger } from "./logger";
import { reconcileStaleInFlight } from "./interrupted-trade-service";

const TRADE_INTERVAL_MS = 6 * 60_000;
const TRANSIENT_RETRY_MS = 60_000;
let schedulerBusy = false;

async function runBot(bot: typeof tradingBotsTable.$inferSelect) {
  if (!bot.tokenId) return;
  const action = bot.phase === "buying" ? "buy" : "sell";
  const startedAt = new Date();
  const inFlight = { action, startedAt: startedAt.toISOString() };
  const [claim] = await db.update(tradingBotsTable).set({
    inFlight,
    stopReason: null,
    updatedAt: startedAt,
  }).where(and(
    eq(tradingBotsTable.id, bot.id),
    eq(tradingBotsTable.status, "running"),
    isNull(tradingBotsTable.inFlight),
  )).returning({ id: tradingBotsTable.id });
  if (!claim) return;

  let submissionAttempted = false;
  try {
    const credentials = {
      privateKey: decryptPrivateKey(bot.encryptedPrivateKey),
      tokenId: bot.tokenId,
    };
    if (action === "buy") {
      const result = await executeUserAutomatedBuy(credentials);
      submissionAttempted = true;
      if (!result.transactionId) throw new Error("Buy submission returned no transaction ID.");
      await db.transaction(async (tx) => {
        await tx.insert(managedLotsTable).values({
          botId: bot.id,
          buyTransactionId: result.transactionId!,
          outputIndex: 2,
          tokenAmount: BigInt(result.tokenOut),
          costSompi: BigInt(Math.round(result.maximumDebitKas * 100_000_000)),
          tokenId: bot.tokenId,
          tokenSymbol: bot.tokenSymbol,
        });
        const completedBuys = bot.completedBuys + 1;
        const [updated] = await tx.update(tradingBotsTable).set({
          phase: completedBuys >= 5 ? "selling" : "buying",
          completedBuys,
          completedSells: completedBuys >= 5 ? 0 : bot.completedSells,
          totalTrades: bot.totalTrades + 1,
          lastTradeAt: new Date(),
          nextRunAt: new Date(Date.now() + TRADE_INTERVAL_MS),
          inFlight: null,
          stopReason: null,
          updatedAt: new Date(),
        }).where(and(
          eq(tradingBotsTable.id, bot.id),
          eq(tradingBotsTable.inFlight, inFlight),
        )).returning({ id: tradingBotsTable.id });
        if (!updated) throw new Error("Buy bookkeeping lost ownership of the operation marker.");
      });
    } else {
      const [lot] = await db
        .select()
        .from(managedLotsTable)
        .where(and(eq(managedLotsTable.botId, bot.id), isNull(managedLotsTable.soldAt)))
        .orderBy(asc(managedLotsTable.createdAt))
        .limit(1);
      if (!lot) throw new Error("No managed token lot is available to sell.");
      const result = await executeUserAutomatedSell({
        transactionId: lot.buyTransactionId,
        index: lot.outputIndex,
        amount: lot.tokenAmount.toString(),
      }, credentials);
      submissionAttempted = true;
      if (!result.transactionId) throw new Error("Sell submission returned no transaction ID.");
      await db.transaction(async (tx) => {
        await tx.update(managedLotsTable).set({
          sellTransactionId: result.transactionId,
          soldAt: new Date(),
        }).where(eq(managedLotsTable.id, lot.id));
        const completedSells = bot.completedSells + 1;
        const cycleComplete = completedSells >= 5;
        const [updated] = await tx.update(tradingBotsTable).set({
          phase: cycleComplete ? "buying" : "selling",
          completedBuys: cycleComplete ? 0 : bot.completedBuys,
          completedSells: cycleComplete ? 0 : completedSells,
          totalTrades: bot.totalTrades + 1,
          lastTradeAt: new Date(),
          nextRunAt: new Date(Date.now() + TRADE_INTERVAL_MS),
          inFlight: null,
          stopReason: null,
          updatedAt: new Date(),
        }).where(and(
          eq(tradingBotsTable.id, bot.id),
          eq(tradingBotsTable.inFlight, inFlight),
        )).returning({ id: tradingBotsTable.id });
        if (!updated) throw new Error("Sell bookkeeping lost ownership of the operation marker.");
      });
    }
    logger.info({ botId: bot.id, action }, "User Kron trade accepted");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown automation failure";
    submissionAttempted ||= error instanceof TradeSubmissionAttemptedError;
    const retryable = !submissionAttempted && error instanceof RetryableTradeStateError;
    const [transitioned] = await db.update(tradingBotsTable).set({
      status: retryable ? "running" : "paused",
      nextRunAt: retryable ? new Date(Date.now() + TRANSIENT_RETRY_MS) : null,
      stopReason: retryable ? `Waiting to retry: ${message}` : `Safety pause: ${message}`,
      inFlight: submissionAttempted ? inFlight : null,
      updatedAt: new Date(),
    }).where(and(
      eq(tradingBotsTable.id, bot.id),
      eq(tradingBotsTable.status, "running"),
      eq(tradingBotsTable.inFlight, inFlight),
    )).returning({ id: tradingBotsTable.id });
    if (!transitioned) {
      await db.update(tradingBotsTable).set({
        inFlight: submissionAttempted ? inFlight : null,
        ...(submissionAttempted ? {
          nextRunAt: null,
          stopReason: `Safety pause: ${message}`,
        } : {}),
        updatedAt: new Date(),
      }).where(and(
        eq(tradingBotsTable.id, bot.id),
        eq(tradingBotsTable.inFlight, inFlight),
      ));
    }
    if (retryable) {
      logger.warn({ err: error, botId: bot.id, action }, "User Kron trade deferred for retry");
    } else {
      logger.error({ err: error, botId: bot.id, action }, "User Kron bot paused");
    }
  }
}

async function tick() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const interruptedBots = await db
      .select()
      .from(tradingBotsTable)
      .where(and(
        eq(tradingBotsTable.status, "running"),
        isNotNull(tradingBotsTable.inFlight),
      ))
      .limit(10);
    for (const bot of interruptedBots) {
      await reconcileStaleInFlight(bot).catch((error) => {
        logger.error({ err: error, botId: bot.id }, "Failed to reconcile interrupted user trade");
      });
    }

    const bots = await db
      .select()
      .from(tradingBotsTable)
      .where(and(
        eq(tradingBotsTable.status, "running"),
        isNull(tradingBotsTable.inFlight),
        lte(tradingBotsTable.nextRunAt, new Date()),
      ))
      .limit(10);
    for (const bot of bots) await runBot(bot);
  } finally {
    schedulerBusy = false;
  }
}

export function startUserAutomationScheduler() {
  const timer = setInterval(() => void tick().catch((error) => {
    logger.error({ err: error }, "User automation scheduler tick failed");
  }), 15_000);
  timer.unref();
  logger.info("Database-backed user automation scheduler loaded");
}