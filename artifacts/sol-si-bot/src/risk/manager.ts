import type { BotConfig } from "../config.js";
import type {
  EquityState,
  OrderIntent,
  PositionView,
  Side,
  StrategySignal,
} from "../types.js";

/**
 * Hard gates before every order. Owns flatten on kill / emergency.
 * 10× is allowed by config but never exceeded.
 */
export class RiskManager {
  private state: EquityState;
  private emergency = false;

  constructor(private readonly cfg: BotConfig) {
    this.state = {
      equityUsd: 0,
      dayStartEquityUsd: 0,
      peakEquityUsd: 0,
      paused: false,
    };
  }

  getStatus(): EquityState & { emergency: boolean } {
    return { ...this.state, emergency: this.emergency };
  }

  /** Call when wallet + position mark are known. */
  markEquity(equityUsd: number, utcDayChanged = false): void {
    if (this.state.dayStartEquityUsd <= 0 || utcDayChanged) {
      this.state.dayStartEquityUsd = equityUsd;
    }
    this.state.equityUsd = equityUsd;
    this.state.peakEquityUsd = Math.max(this.state.peakEquityUsd, equityUsd);

    const dayLossPct =
      this.state.dayStartEquityUsd > 0
        ? ((this.state.dayStartEquityUsd - equityUsd) /
            this.state.dayStartEquityUsd) *
          100
        : 0;
    const ddPct =
      this.state.peakEquityUsd > 0
        ? ((this.state.peakEquityUsd - equityUsd) / this.state.peakEquityUsd) *
          100
        : 0;

    if (dayLossPct >= this.cfg.dailyLossKillPct) {
      this.pause(
        `daily loss kill: −${dayLossPct.toFixed(2)}% ≥ ${this.cfg.dailyLossKillPct}%`,
      );
    } else if (ddPct >= this.cfg.maxDrawdownPct) {
      this.pause(
        `max drawdown pause: −${ddPct.toFixed(2)}% ≥ ${this.cfg.maxDrawdownPct}%`,
      );
    }
  }

  pause(reason: string): void {
    this.state.paused = true;
    this.state.pauseReason = reason;
  }

  resume(): void {
    this.state.paused = false;
    this.state.pauseReason = undefined;
  }

  triggerEmergency(reason: string): void {
    this.emergency = true;
    this.pause(`EMERGENCY: ${reason}`);
  }

  clearEmergency(): void {
    this.emergency = false;
  }

  /**
   * Map strategy signal → order intent or null, applying risk caps.
   * On pause/emergency with open position → flatten intent.
   */
  plan(input: {
    signal: StrategySignal;
    position: PositionView | null;
    equityUsd: number;
  }): OrderIntent | null {
    const { signal, position, equityUsd } = input;

    if (this.emergency || this.state.paused) {
      if (position && position.sizeUsd > 0) {
        return {
          kind: "flatten",
          reason: this.state.pauseReason ?? "paused",
        };
      }
      return null;
    }

    if (signal.action === "hold") return null;

    if (signal.action === "flat") {
      if (position && position.sizeUsd > 0) {
        return { kind: "flatten", reason: signal.reason };
      }
      return null;
    }

    // Entry: long or short
    if (position) {
      // v1: no pyramid / flip-in-place — flatten first if opposing (strategy should emit flat)
      return null;
    }

    const collateralUsd = this.cfg.collateralUsdc;
    const maxCollateral = equityUsd * this.cfg.maxCollateralFraction;
    if (equityUsd > 0 && collateralUsd > maxCollateral) {
      return null; // skip oversized vs MAX_COLLATERAL_FRACTION
    }

    const side: Side = signal.action;
    const raw = BigInt(Math.round(collateralUsd * 1e6)).toString();

    return {
      kind: "increase",
      side,
      collateralRaw: raw,
      leverage: this.cfg.maxLeverage,
      maxSlippageBps: this.cfg.maxSlippageBps,
      reason: signal.reason,
    };
  }

  /** Reject if requested leverage exceeds hard cap. */
  assertLeverage(leverage: number): boolean {
    return leverage > 0 && leverage <= this.cfg.maxLeverage + 1e-9;
  }
}
