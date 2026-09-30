import type { Candle } from "../types.js";

/**
 * Public 1h OHLCV for SOL via Binance market-data-only klines.
 *
 * Default host: https://data-api.binance.vision (no API key; market data only).
 * Symbol default: SOLUSDT — CEX proxy for SOL trend/regime (not Jupiter oracle).
 *
 * Binance kline row:
 * [ openTime, open, high, low, close, volume, closeTime, ... ]
 *
 * @see https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
 */

export interface CandleFeedConfig {
  baseUrl: string;
  symbol: string;
  interval: string;
  /** Max bars to request (Binance allows up to 1000). */
  limit: number;
}

const DEFAULTS: CandleFeedConfig = {
  baseUrl: "https://data-api.binance.vision",
  symbol: "SOLUSDT",
  interval: "1h",
  limit: 120,
};

export class BinanceCandleFeed {
  private readonly cfg: CandleFeedConfig;

  constructor(partial?: Partial<CandleFeedConfig>) {
    this.cfg = {
      ...DEFAULTS,
      ...partial,
      baseUrl: (partial?.baseUrl ?? DEFAULTS.baseUrl).replace(/\/$/, ""),
    };
  }

  async fetchCandles(limit = this.cfg.limit): Promise<Candle[]> {
    const capped = Math.min(Math.max(limit, 1), 1000);
    const qs = new URLSearchParams({
      symbol: this.cfg.symbol,
      interval: this.cfg.interval,
      limit: String(capped),
    });
    const url = `${this.cfg.baseUrl}/api/v3/klines?${qs}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Binance klines ${res.status}: ${body.slice(0, 300)}`,
      );
    }

    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) {
      throw new Error("Binance klines: unexpected response shape");
    }

    const candles: Candle[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const timeMs = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (
        !Number.isFinite(timeMs) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        continue;
      }
      candles.push({ timeMs, open, high, low, close, volume });
    }

    if (candles.length === 0) {
      throw new Error("Binance klines: empty candle set");
    }

    return candles;
  }
}
