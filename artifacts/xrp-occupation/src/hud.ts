import type { Battle } from "./battle";
import type { OpenInterestUpdate } from "./feeds";
import {
  formatFunding,
  formatPrice,
  formatRetry,
  formatUsd,
  formatXrp,
} from "./format";
import type { LinkStatus } from "./net";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function statusLine(status: LinkStatus): string {
  if (status.state === "live") return "LIVE";
  if (status.state === "connecting") return "CONNECTING";
  const retry = formatRetry(status.retryInMs);
  const suffix = retry ? ` · ${retry}` : "";
  if (status.state === "blocked") {
    return `BLOCKED · ${status.detail.toUpperCase()}${suffix}`;
  }
  return `DISCONNECTED${suffix}`;
}

export class Hud {
  private binance: LinkStatus = {
    state: "connecting",
    detail: "connecting",
    retryInMs: null,
  };
  private xrpl: LinkStatus = {
    state: "connecting",
    detail: "connecting",
    retryInMs: null,
  };
  private oiXrp: number | null = null;
  private oiBlocked = false;
  private oiDetail = "";

  private binanceFeed = el<HTMLElement>("feed-binance");
  private xrplFeed = el<HTMLElement>("feed-xrpl");
  private binanceState = el<HTMLElement>("binance-state");
  private xrplState = el<HTMLElement>("xrpl-state");
  private longVal = el<HTMLElement>("long-val");
  private shortVal = el<HTMLElement>("short-val");
  private fieldNote = el<HTMLElement>("field-note");
  private markVal = el<HTMLElement>("mark-val");
  private fundingVal = el<HTMLElement>("funding-val");
  private windVal = el<HTMLElement>("wind-val");
  private oiVal = el<HTMLElement>("oi-val");
  private ledgerVal = el<HTMLElement>("ledger-val");
  private meterLong = el<HTMLElement>("meter-long");
  private meterShort = el<HTMLElement>("meter-short");

  setBinance(status: LinkStatus): void {
    this.binance = status;
  }

  setXrpl(status: LinkStatus): void {
    this.xrpl = status;
  }

  setOi(update: OpenInterestUpdate): void {
    this.oiBlocked = update.blocked;
    this.oiDetail = update.detail;
    if (update.ok && update.xrp != null) this.oiXrp = update.xrp;
  }

  sync(battle: Battle): void {
    this.binanceFeed.dataset.state = this.binance.state;
    this.xrplFeed.dataset.state = this.xrpl.state;
    setText(this.binanceState, statusLine(this.binance));
    setText(this.xrplState, statusLine(this.xrpl));

    setText(
      this.longVal,
      battle.sawFlow ? formatUsd(battle.pressureLong) : "—",
    );
    setText(
      this.shortVal,
      battle.sawFlow ? formatUsd(battle.pressureShort) : "—",
    );

    const total = battle.pressureLong + battle.pressureShort;
    const longShare = total > 0 ? (battle.pressureLong / total) * 100 : 50;
    this.meterLong.style.width = `${longShare}%`;
    this.meterShort.style.width = `${100 - longShare}%`;

    setText(this.markVal, battle.price == null ? "—" : formatPrice(battle.price));
    if (battle.funding == null) {
      setText(this.fundingVal, "—");
      setText(this.windVal, "");
    } else {
      setText(this.fundingVal, formatFunding(battle.funding));
      if (battle.funding > 0.0000005) setText(this.windVal, "LONGS PAY · WIND ON LONGS");
      else if (battle.funding < -0.0000005) setText(this.windVal, "SHORTS PAY · WIND ON SHORTS");
      else setText(this.windVal, "FLAT");
    }

    if (this.oiBlocked && this.oiXrp == null) {
      setText(this.oiVal, "BLOCKED");
    } else if (this.oiXrp != null && battle.price != null) {
      setText(
        this.oiVal,
        `${formatUsd(this.oiXrp * battle.price)} · ${formatXrp(this.oiXrp)}`,
      );
    } else if (this.oiXrp != null) {
      setText(this.oiVal, formatXrp(this.oiXrp));
    } else if (this.oiDetail && this.oiDetail !== "live") {
      setText(this.oiVal, this.oiDetail.toUpperCase());
    } else {
      setText(this.oiVal, "—");
    }

    const ledger =
      battle.ledgerIndex == null
        ? "—"
        : `#${Math.round(battle.ledgerIndex).toLocaleString("en-US")}`;
    setText(this.ledgerVal, ledger);
    this.ledgerVal.classList.toggle("thump", battle.thump > 0.45);

    const alive = battle.units.some((unit) => unit.state !== "dead");
    let note = "";
    let tone = "";
    if (!alive && this.binance.state === "blocked") {
      note =
        "Binance blocked: restricted location. The field stays empty until that feed connects.";
      tone = "alert";
    } else if (!alive && this.binance.state !== "live") {
      note =
        this.binance.state === "connecting"
          ? "Connecting to Binance. The field stays empty until taker flow arrives."
          : "Binance disconnected. Retrying. The field stays empty until the feed connects.";
      tone = "alert";
    } else if (!alive) {
      note = "Awaiting taker flow.";
    }
    setText(this.fieldNote, note);
    if (this.fieldNote.dataset.tone !== tone) this.fieldNote.dataset.tone = tone;
  }
}
