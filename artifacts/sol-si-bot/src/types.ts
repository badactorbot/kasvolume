/** Shared types for SOL SI bot. */

export type Side = "long" | "short";
export type SignalAction = "long" | "short" | "flat" | "hold";

export interface Candle {
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketSnapshot {
  asset: "SOL";
  /** Oracle / mark price in USD */
  price: number;
  /** Hourly borrow rate in bps if available */
  hourlyBorrowBps?: number;
  fetchedAtMs: number;
}

export interface StrategySignal {
  action: SignalAction;
  reason: string;
  confidence: number;
  meta?: Record<string, number | string | boolean>;
}

export interface PositionView {
  positionPubkey?: string;
  asset?: string;
  side: Side;
  sizeUsd: number;
  collateralUsd: number;
  leverage: number;
  entryPrice?: number;
  unrealizedPnlUsd?: number;
}

export interface OrderIntent {
  kind: "increase" | "decrease" | "close_all" | "flatten";
  side?: Side;
  /** Collateral in raw USDC (6 decimals) for increase */
  collateralRaw?: string;
  leverage?: number;
  maxSlippageBps?: number;
  reason: string;
}

export interface EquityState {
  equityUsd: number;
  dayStartEquityUsd: number;
  peakEquityUsd: number;
  paused: boolean;
  pauseReason?: string;
}
