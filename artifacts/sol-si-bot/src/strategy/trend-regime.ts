import type { BotConfig } from "../config.js";
import type { Candle, MarketSnapshot, PositionView, StrategySignal } from "../types.js";

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    e = values[i]! * k + e * (1 - k);
  }
  return e;
}

/** Wilder-ish ATR from candles. */
function atr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      ),
    );
  }
  if (trs.length < period) return null;
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Trend + regime skeleton.
 * - Trend: fast EMA vs slow EMA on closes
 * - Regime: ATR% must clear floor (skip chop)
 * - Borrow: skip new entries when hourly borrow is extreme (threshold TBD)
 *
 * Does not pyramid; one SOL-PERP position max.
 */
export class TrendRegimeStrategy {
  constructor(private readonly cfg: BotConfig) {}

  evaluate(input: {
    candles: Candle[];
    snapshot: MarketSnapshot;
    position: PositionView | null;
  }): StrategySignal {
    const closes = input.candles.map((c) => c.close);
    const fast = ema(closes, this.cfg.emaFast);
    const slow = ema(closes, this.cfg.emaSlow);
    const atrVal = atr(input.candles, this.cfg.atrPeriod);
    const price = input.snapshot.price || closes.at(-1) || 0;

    if (fast === null || slow === null || atrVal === null || price <= 0) {
      return {
        action: "hold",
        reason: "insufficient candle/oracle data (wire market feed)",
        confidence: 0,
      };
    }

    const atrPct = (atrVal / price) * 100;
    const trending = atrPct >= this.cfg.regimeAtrPctFloor;
    const up = fast > slow;
    const down = fast < slow;

    // Borrow filter — conservative stub threshold
    const borrow = input.snapshot.hourlyBorrowBps ?? 0;
    const borrowExpensive = borrow > 20; // TODO: calibrate vs edge model

    if (input.position) {
      if (!trending) {
        return {
          action: "flat",
          reason: `regime collapsed (ATR% ${atrPct.toFixed(2)} < floor)`,
          confidence: 0.6,
          meta: { atrPct, fast, slow },
        };
      }
      if (input.position.side === "long" && down) {
        return {
          action: "flat",
          reason: "EMA cross against long",
          confidence: 0.7,
          meta: { fast, slow },
        };
      }
      if (input.position.side === "short" && up) {
        return {
          action: "flat",
          reason: "EMA cross against short",
          confidence: 0.7,
          meta: { fast, slow },
        };
      }
      return {
        action: "hold",
        reason: "position aligned with trend/regime",
        confidence: 0.5,
        meta: { atrPct, fast, slow },
      };
    }

    if (!trending) {
      return {
        action: "flat",
        reason: `chop / low ATR% (${atrPct.toFixed(2)})`,
        confidence: 0.4,
        meta: { atrPct },
      };
    }

    if (borrowExpensive) {
      return {
        action: "hold",
        reason: `borrow expensive (${borrow} bps/hr) — skip new entry`,
        confidence: 0.3,
        meta: { borrow },
      };
    }

    if (up) {
      return {
        action: "long",
        reason: "fast EMA > slow EMA + regime OK",
        confidence: 0.55,
        meta: { atrPct, fast, slow },
      };
    }
    if (down) {
      return {
        action: "short",
        reason: "fast EMA < slow EMA + regime OK",
        confidence: 0.55,
        meta: { atrPct, fast, slow },
      };
    }

    return { action: "hold", reason: "neutral EMAs", confidence: 0.2 };
  }
}
