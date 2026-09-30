import type { BotConfig } from "../config.js";
import type { Candle, MarketSnapshot, PositionView, Side } from "../types.js";

/**
 * Thin HTTP client for Jupiter Perps public API (verified against
 * https://perps-api.jup.ag/v1/docs — Sep 2026).
 *
 *   base:   https://perps-api.jup.ag/v1
 *   header: x-perps-api-version: v2
 *
 *   GET  /market-stats?mint=
 *   GET  /pool-info?mint=
 *   GET  /positions?walletAddress=
 *   POST /positions/increase
 *   POST /positions/decrease
 *   POST /positions/close-all
 *   POST /transaction/execute
 *
 * Trading endpoints return unsigned serialized Solana tx(s) (base64).
 * Keepers fulfill after the request tx lands — fills are not instant.
 *
 * USD fields from the API are typically raw ×1e6 integers as strings.
 */

const API_VERSION_HEADER = { "x-perps-api-version": "v2" } as const;

/** Well-known mints used by Jupiter Perps (USDC / wSOL). */
export const MINTS = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  SOL: "So11111111111111111111111111111111111111112",
} as const;

export interface IncreasePositionParams {
  walletAddress: string;
  asset: "SOL";
  inputToken: "USDC";
  /** Raw token amount (USDC = 6 decimals). e.g. "10000000" = 10 USDC */
  inputTokenAmount: string;
  side: Side;
  /** String leverage, e.g. "10" — min 1.1 */
  leverage: string;
  maxSlippageBps: string;
}

export interface DecreasePositionParams {
  positionPubkey: string;
  receiveToken: "USDC" | "SOL";
  entirePosition?: boolean;
  sizeUsdDelta?: string;
  collateralUsdDelta?: string;
  maxSlippageBps?: string;
}

export interface TxBuildResponse {
  serializedTxBase64?: string;
  /** close-all returns an array of txs */
  serializedTxs?: Array<{
    serializedTxBase64?: string;
    positionRequestPubkey?: string;
  }>;
  positionPubkey?: string;
  quote?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ExecuteSignedParams {
  action:
    | "increase-position"
    | "decrease-position"
    | "close-all-positions"
    | string;
  /** Base64 signed transaction */
  signedTransactionBase64: string;
}

export class JupiterPerpsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromConfig(cfg: BotConfig): JupiterPerpsClient {
    return new JupiterPerpsClient(cfg.jupiterPerpsApiUrl.replace(/\/$/, ""));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...API_VERSION_HEADER,
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Jupiter Perps ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 500)}`,
      );
    }

    return (await res.json()) as T;
  }

  async getPositions(walletAddress: string): Promise<unknown> {
    return this.request(
      `/positions?walletAddress=${encodeURIComponent(walletAddress)}`,
    );
  }

  /** Live path: GET /market-stats?mint=… */
  async getMarketStats(mint: string = MINTS.SOL): Promise<unknown> {
    const qs = new URLSearchParams({ mint });
    return this.request(`/market-stats?${qs}`);
  }

  /**
   * Pool / custody info — borrow rates often live here.
   * TODO: confirm field names for hourly borrow if shape drifts.
   */
  async getPoolInfo(mint: string = MINTS.SOL): Promise<unknown> {
    const qs = new URLSearchParams({ mint });
    return this.request(`/pool-info?${qs}`);
  }

  async increasePosition(params: IncreasePositionParams): Promise<TxBuildResponse> {
    return this.request<TxBuildResponse>("/positions/increase", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async decreasePosition(params: DecreasePositionParams): Promise<TxBuildResponse> {
    return this.request<TxBuildResponse>("/positions/decrease", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async closeAllPositions(walletAddress: string): Promise<TxBuildResponse> {
    return this.request<TxBuildResponse>("/positions/close-all", {
      method: "POST",
      body: JSON.stringify({ walletAddress }),
    });
  }

  /**
   * Submit a signed request transaction for keeper fulfillment.
   * `action` enum includes increase-position / decrease-position / …
   */
  async executeSigned(params: ExecuteSignedParams): Promise<unknown> {
    return this.request("/transaction/execute", {
      method: "POST",
      body: JSON.stringify({
        action: params.action,
        transaction: params.signedTransactionBase64,
      }),
    });
  }
}

/** Convert Jupiter raw USD string (×1e6) to human USD number. */
export function rawUsdToNumber(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // Heuristic: values that look like raw micro-USD
  if (Math.abs(n) >= 1000) return n / 1e6;
  return n;
}

/** Best-effort normalize of positions payload → PositionView[]. */
export function normalizePositions(payload: unknown): PositionView[] {
  const root = payload as Record<string, unknown> | unknown[];
  const list: unknown[] = Array.isArray(root)
    ? root
    : Array.isArray((root as { dataList?: unknown[] })?.dataList)
      ? ((root as { dataList: unknown[] }).dataList)
      : Array.isArray((root as { data?: unknown[] })?.data)
        ? ((root as { data: unknown[] }).data)
        : Array.isArray((root as { positions?: unknown[] })?.positions)
          ? ((root as { positions: unknown[] }).positions)
          : [];

  return list
    .map((item): PositionView | null => {
      const p = item as Record<string, unknown>;
      const sideRaw = String(p.side ?? p.positionSide ?? "").toLowerCase();
      if (sideRaw !== "long" && sideRaw !== "short") return null;

      const sizeUsd = rawUsdToNumber(p.sizeUsd ?? p.size ?? p.positionSizeUsd);
      const collateralUsd = rawUsdToNumber(
        p.collateralUsd ?? p.collateral ?? p.valueUsd,
      );
      const leverage = Number(p.leverage ?? 0) ||
        (collateralUsd > 0 ? sizeUsd / collateralUsd : 0);

      return {
        positionPubkey: String(p.positionPubkey ?? p.pubkey ?? p.id ?? ""),
        asset: p.asset ? String(p.asset) : undefined,
        side: sideRaw,
        sizeUsd,
        collateralUsd,
        leverage: Number.isFinite(leverage) ? leverage : 0,
        entryPrice: rawUsdToNumber(p.entryPriceUsd ?? p.entryPrice) || undefined,
        unrealizedPnlUsd:
          rawUsdToNumber(p.pnlAfterFeesUsd ?? p.pnlUsd ?? p.unrealizedPnlUsd) ||
          undefined,
      };
    })
    .filter((x): x is PositionView => x !== null);
}

/**
 * Market data: price from GET /market-stats; optional borrow from /pool-info.
 * Candle history is stubbed — plug Birdeye/Pyth/CEX later for EMA/ATR.
 */
export class MarketDataService {
  constructor(private readonly client: JupiterPerpsClient) {}

  async fetchSnapshot(): Promise<MarketSnapshot> {
    try {
      const stats = (await this.client.getMarketStats(MINTS.SOL)) as Record<
        string,
        unknown
      >;
      const price = Number(stats.price ?? 0);

      let hourlyBorrowBps: number | undefined;
      try {
        const pool = (await this.client.getPoolInfo(MINTS.SOL)) as Record<
          string,
          unknown
        >;
        const funding =
          (pool.fundingRateState as Record<string, unknown> | undefined) ??
          pool;
        const bps = Number(
          funding.hourlyFundingBps ??
            pool.hourlyFundingBps ??
            pool.hourlyBorrowBps,
        );
        if (Number.isFinite(bps)) hourlyBorrowBps = bps;
      } catch {
        // Borrow optional for scaffold ticks
      }

      if (price > 0) {
        return {
          asset: "SOL",
          price,
          hourlyBorrowBps,
          fetchedAtMs: Date.now(),
        };
      }
    } catch (err) {
      console.warn(
        "[market] Jupiter market-stats unavailable; using stub price",
        err instanceof Error ? err.message : err,
      );
    }

    return {
      asset: "SOL",
      price: 0,
      fetchedAtMs: Date.now(),
    };
  }

  /**
   * Placeholder OHLCV. Strategy will often emit "hold" until real candles exist.
   * TODO: wire 1h candles (Birdeye / Pyth / exchange proxy).
   */
  async fetchCandles(_limit = 120): Promise<Candle[]> {
    return [];
  }
}
