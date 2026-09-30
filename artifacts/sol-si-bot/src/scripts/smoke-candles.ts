/**
 * One-shot smoke: load 1h candles + run trend+regime once.
 * Exits 0 if candles load and signal is not "insufficient candle/oracle data".
 */
import { loadConfig } from "../config.js";
import { JupiterPerpsClient, MarketDataService } from "../market/jupiter.js";
import { TrendRegimeStrategy } from "../strategy/trend-regime.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const market = new MarketDataService(JupiterPerpsClient.fromConfig(cfg), cfg);
  const strategy = new TrendRegimeStrategy(cfg);

  const candles = await market.fetchCandles(cfg.candleLimit);
  const snapshot = await market.fetchSnapshot();
  const signal = strategy.evaluate({ candles, snapshot, position: null });

  console.log(
    JSON.stringify(
      {
        candleSource: cfg.candleSource,
        symbol: cfg.candleSymbol,
        interval: cfg.candleInterval,
        candleCount: candles.length,
        firstTime: new Date(candles[0]!.timeMs).toISOString(),
        lastTime: new Date(candles.at(-1)!.timeMs).toISOString(),
        lastClose: candles.at(-1)!.close,
        jupiterPrice: snapshot.price,
        signal: signal.action,
        reason: signal.reason,
        meta: signal.meta ?? null,
      },
      null,
      2,
    ),
  );

  if (candles.length < cfg.emaSlow + 2) {
    throw new Error(
      `Need ≥ ${cfg.emaSlow + 2} candles for EMA_SLOW; got ${candles.length}`,
    );
  }
  if (signal.reason.includes("insufficient candle")) {
    throw new Error(`Strategy still data-starved: ${signal.reason}`);
  }
  if (!["long", "short", "flat", "hold"].includes(signal.action)) {
    throw new Error(`Unexpected action ${signal.action}`);
  }

  console.log(
    `OK — candles=${candles.length} signal=${signal.action} (DRY_RUN default unchanged)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
