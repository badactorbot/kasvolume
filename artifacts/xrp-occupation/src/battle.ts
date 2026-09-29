import { clamp, formatUsd } from "./format";
import type { LinkStatus } from "./net";
import type { Side } from "./parse";

export type UnitKind = "infantry" | "tank" | "artillery";
export type StrikeTier = "burst" | "strike" | "bomb";

export const TANK_USD = 2500;
export const FEED_TRADE_USD = 8000;
export const LIQ_STRIKE_USD = 5000;
export const LIQ_BOMB_USD = 25000;
const INFANTRY_USD = 350;
const RANGE_FRAC = 0.0022;

export interface Unit {
  side: Side;
  kind: UnitKind;
  x: number;
  lane: number;
  health: number;
  notional: number;
  state: "march" | "hold" | "dying";
  die: number;
  flash: number;
  age: number;
}

export interface Strike {
  side: Side;
  tier: StrikeTier;
  x: number;
  life: number;
  max: number;
}

export interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  tone: "long" | "short" | "gold" | "bone";
}

export interface BookColumn {
  side: Side;
  t: number;
  weight: number;
}

export interface FeedLine {
  text: string;
  tone: "long" | "short" | "gold";
}

export interface Round {
  low: number;
  high: number;
}

interface Sample {
  t: number;
  v: number;
}

const MAX_UNITS = 42;

function opposite(side: Side): Side {
  return side === "long" ? "short" : "long";
}

function strikeTier(notional: number): StrikeTier {
  if (notional >= LIQ_BOMB_USD) return "bomb";
  if (notional >= LIQ_STRIKE_USD) return "strike";
  return "burst";
}

export class Battle {
  units: Unit[] = [];
  strikes: Strike[] = [];
  bits: Bit[] = [];
  columns: BookColumn[] = [];
  feed: FeedLine[] = [];
  price: number | null = null;
  funding: number | null = null;
  oiUsd: number | null = null;
  pressureLong = 0;
  pressureShort = 0;
  sawFlow = false;
  round: Round | null = null;
  banner: { text: string; side: Side; life: number } | null = null;
  shake = 0;
  pulse = -1;
  link: LinkStatus = { state: "connecting", detail: "connecting", retryInMs: null };
  winsLong = 0;
  winsShort = 0;

  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private bucket = { long: 0, short: 0, age: 0 };
  private prices: Sample[] = [];
  private liqs: Sample[] = [];
  private artilleryAt = { long: -10, short: -10 };
  private clock = 0;
  private roundBorn = 0;
  private bookDirty = true;

  setLink(status: LinkStatus): void {
    this.link = status;
  }

  addTrade(side: Side, notional: number, price: number): void {
    if (!(notional > 0) || !(price > 0)) return;
    this.sawFlow = true;
    this.notePrice(price, true);
    if (side === "long") this.pressureLong += notional;
    else this.pressureShort += notional;
    this.damage(opposite(side), notional);
    if (notional >= FEED_TRADE_USD) {
      const label = side === "long" ? "BUY" : "SELL";
      this.pushFeed(`${label} ${formatUsd(notional)}`, side);
    }
    if (notional >= TANK_USD) {
      this.spawn(side, notional, this.kindFor(side, notional));
      return;
    }
    if (side === "long") this.bucket.long += notional;
    else this.bucket.short += notional;
  }

  addLiquidation(side: Side, notional: number): void {
    if (!(notional > 0)) return;
    this.sawFlow = true;
    this.liqs.push({ t: this.clock, v: notional });
    const tier = strikeTier(notional);
    const x = this.strikeX(side);
    const life = tier === "bomb" ? 0.85 : tier === "strike" ? 0.55 : 0.32;
    this.strikes.push({ side, tier, x, life, max: life });
    this.burstBits(x, side, tier);
    this.shake = Math.max(this.shake, tier === "bomb" ? 0.4 : tier === "strike" ? 0.22 : 0.1);
    if (tier !== "burst") {
      const who = side === "long" ? "LONG" : "SHORT";
      const tag = tier === "bomb" ? "BOMB" : "STRIKE";
      this.pushFeed(`${tag} ${who} ${formatUsd(notional)}`, side);
    }
    if (this.hotLiq()) this.spawnArtillery(opposite(side), Math.max(notional, TANK_USD));
    this.damage(side, notional);
  }

  applyTicker(patch: {
    lastPrice: number | null;
    markPrice: number | null;
    fundingRate: number | null;
    openInterestValue: number | null;
  }): void {
    if (patch.fundingRate != null) this.funding = patch.fundingRate;
    if (patch.openInterestValue != null && patch.openInterestValue > 0) {
      this.oiUsd = patch.openInterestValue;
    }
    if (this.round == null) {
      const seed = patch.lastPrice ?? patch.markPrice;
      if (seed != null && seed > 0) this.price = seed;
    }
  }

  applyBook(
    type: "snapshot" | "delta",
    bids: [number, number][],
    asks: [number, number][],
  ): void {
    if (type === "snapshot") {
      this.bids.clear();
      this.asks.clear();
    }
    this.writeLevels(this.bids, bids);
    this.writeLevels(this.asks, asks);
    this.bookDirty = true;
  }

  pulseLedger(): void {
    this.pulse = 0;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    const step = Math.min(dt, 0.05);
    this.clock += step;
    const decay = Math.exp(-step / 14);
    this.pressureLong *= decay;
    this.pressureShort *= decay;
    this.bucket.age += step;
    this.flush("long");
    this.flush("short");
    if (this.bucket.long <= 0 && this.bucket.short <= 0) this.bucket.age = 0;
    this.move(step);
    this.trimDead();
    this.strikes = this.strikes.filter((strike) => {
      strike.life -= step;
      return strike.life > 0;
    });
    for (const bit of this.bits) {
      bit.life -= step;
      bit.x += bit.vx * step;
      bit.y += bit.vy * step;
      bit.vy += 0.35 * step;
    }
    this.bits = this.bits.filter((bit) => bit.life > 0).slice(-240);
    if (this.pulse >= 0) {
      this.pulse += step * 0.85;
      if (this.pulse > 1.05) this.pulse = -1;
    }
    this.shake = Math.max(0, this.shake - step);
    if (this.banner) {
      this.banner.life -= step;
      if (this.banner.life <= 0) this.banner = null;
    }
    this.prices = this.prices.filter((sample) => this.clock - sample.t < 8);
    this.liqs = this.liqs.filter((sample) => this.clock - sample.t < 10);
    if (this.bookDirty) {
      this.rebuildColumns();
      this.bookDirty = false;
    }
  }

  readout(): string {
    const price = this.price == null ? "PRICE --" : `PRICE ${this.price.toFixed(4)}`;
    const latest = this.feed[0]?.text ?? "FEED EMPTY";
    const banner = this.banner ? ` BANNER ${this.banner.text}` : "";
    return `${this.statusText()} | ${price} | UNITS ${this.units.length} | ${latest}${banner}`;
  }

  statusText(): string {
    const status = this.link;
    if (status.state === "live") return "BYBIT LIVE";
    if (status.state === "connecting") return "BYBIT CONNECTING";
    if (status.state === "blocked") return "BYBIT BLOCKED";
    const retry =
      status.retryInMs == null ? "" : ` RETRY ${Math.ceil(status.retryInMs / 1000)}S`;
    return `BYBIT DOWN${retry}`;
  }

  private notePrice(price: number, fromTrade: boolean): void {
    this.price = price;
    if (fromTrade) this.prices.push({ t: this.clock, v: price });
    if (!this.round) {
      this.openRound(price);
      return;
    }
    if (this.banner || this.clock - this.roundBorn < 2) return;
    if (price >= this.round.high) this.win("long");
    else if (price <= this.round.low) this.win("short");
  }

  private openRound(price: number): void {
    const pad = price * RANGE_FRAC;
    this.round = { low: price - pad, high: price + pad };
    this.roundBorn = this.clock;
    this.bookDirty = true;
  }

  private win(side: Side): void {
    if (!this.price) return;
    const text = side === "long" ? "LONGS TAKE THE RANGE" : "SHORTS TAKE THE RANGE";
    this.banner = { text, side, life: 3.2 };
    this.pushFeed(text, side);
    if (side === "long") this.winsLong += 1;
    else this.winsShort += 1;
    this.units = [];
    this.strikes = [];
    this.bits = [];
    this.openRound(this.price);
  }

  frontT(): number {
    if (!this.price || !this.round) return 0.5;
    const span = this.round.high - this.round.low;
    if (!(span > 0)) return 0.5;
    return clamp((this.price - this.round.low) / span, 0, 1);
  }

  private kindFor(side: Side, notional: number): UnitKind {
    if (notional >= TANK_USD && this.hotVol()) {
      this.artilleryAt[side] = this.clock;
      return "artillery";
    }
    return "tank";
  }

  private hotVol(): boolean {
    if (!this.price || this.prices.length < 2) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const sample of this.prices) {
      if (sample.v < lo) lo = sample.v;
      if (sample.v > hi) hi = sample.v;
    }
    return (hi - lo) / this.price >= 0.0008;
  }

  private hotLiq(): boolean {
    let sum = 0;
    for (const sample of this.liqs) sum += sample.v;
    return sum >= 15000;
  }

  private spawnArtillery(side: Side, notional: number): void {
    if (this.clock - this.artilleryAt[side] < 3) return;
    this.artilleryAt[side] = this.clock;
    this.spawn(side, notional, "artillery");
  }

  private flush(side: Side): void {
    const amount = side === "long" ? this.bucket.long : this.bucket.short;
    if (amount <= 0) return;
    const ready = amount >= INFANTRY_USD || this.bucket.age >= 0.45;
    if (!ready) return;
    if (side === "long") this.bucket.long = 0;
    else this.bucket.short = 0;
    const kind: UnitKind = amount >= TANK_USD ? this.kindFor(side, amount) : "infantry";
    this.spawn(side, amount, kind);
  }

  private spawn(side: Side, notional: number, kind: UnitKind): void {
    const front = this.frontT();
    const young = this.units.find(
      (unit) =>
        unit.side === side &&
        unit.kind === kind &&
        unit.age < 0.22 &&
        unit.state === "march" &&
        notional < FEED_TRADE_USD,
    );
    if (young) {
      young.health += notional;
      young.notional += notional;
      young.flash = 0.15;
      return;
    }
    const lane = Math.random();
    let x = front;
    if (kind === "artillery") {
      x = side === "long" ? 0.08 + Math.random() * 0.08 : 0.84 + Math.random() * 0.08;
    } else if (kind === "tank") {
      const back = 0.08 + Math.random() * 0.08;
      x = side === "long" ? Math.max(0.08, front - back) : Math.min(0.92, front + back);
    } else {
      const back = 0.025 + Math.random() * 0.05;
      x = side === "long" ? Math.max(0.1, front - back) : Math.min(0.9, front + back);
    }
    this.units.push({
      side,
      kind,
      x,
      lane,
      health: notional,
      notional,
      state: kind === "artillery" ? "hold" : "march",
      die: 0,
      flash: notional >= FEED_TRADE_USD ? 0.45 : 0.12,
      age: 0,
    });
    if (this.units.length > MAX_UNITS) {
      const ranked = [...this.units].sort((a, b) => a.health - b.health);
      const drop = new Set(ranked.slice(0, this.units.length - MAX_UNITS));
      this.units = this.units.filter((unit) => !drop.has(unit));
    }
  }

  private move(dt: number): void {
    const front = this.frontT();
    for (const unit of this.units) {
      unit.age += dt;
      unit.flash = Math.max(0, unit.flash - dt);
      if (unit.state === "dying") {
        unit.die -= dt;
        continue;
      }
      if (unit.kind === "artillery") {
        const park = unit.side === "long" ? 0.12 : 0.88;
        unit.x += (park - unit.x) * Math.min(1, dt * 2);
        continue;
      }
      const speed = (unit.kind === "tank" ? 0.07 : 0.11) * dt;
      if (unit.side === "long") unit.x += speed;
      else unit.x -= speed;
      const holdAt = unit.side === "long" ? front - 0.02 : front + 0.02;
      const reached = unit.side === "long" ? unit.x >= holdAt : unit.x <= holdAt;
      if (reached) {
        unit.x = holdAt;
        unit.state = "hold";
      } else if (unit.state === "hold") {
        const gap = unit.side === "long" ? front - unit.x : unit.x - front;
        if (gap > 0.08) unit.state = "march";
      }
      unit.x = clamp(unit.x, 0.04, 0.96);
    }
  }

  private damage(side: Side, amount: number): void {
    const foes = this.units.filter(
      (unit) => unit.side === side && unit.state !== "dying" && unit.health > 0,
    );
    if (!foes.length || !(amount > 0)) return;
    const front = this.frontT();
    let sum = 0;
    const weights = foes.map((unit) => {
      const weight = Math.max(unit.health, 1) / (0.03 + Math.abs(unit.x - front));
      sum += weight;
      return weight;
    });
    for (let i = 0; i < foes.length; i += 1) {
      const foe = foes[i];
      const weight = weights[i];
      if (!foe || weight == null || sum <= 0) continue;
      foe.health -= amount * (weight / sum);
      if (foe.health <= 0) {
        foe.health = 0;
        foe.state = "dying";
        foe.die = 0.25;
        this.puff(foe.x, foe.side);
      }
    }
  }

  private strikeX(side: Side): number {
    const front = this.frontT();
    const mates = this.units.filter((unit) => unit.side === side && unit.state !== "dying");
    if (mates.length) {
      const pick = mates[Math.floor(Math.random() * mates.length)];
      if (pick) return pick.x;
    }
    return side === "long" ? Math.max(0.08, front - 0.06) : Math.min(0.92, front + 0.06);
  }

  private burstBits(x: number, side: Side, tier: StrikeTier): void {
    const count = tier === "bomb" ? 28 : tier === "strike" ? 14 : 7;
    for (let i = 0; i < count; i += 1) {
      const life = 0.25 + Math.random() * 0.45;
      this.bits.push({
        x,
        y: 0.62 + Math.random() * 0.08,
        vx: (Math.random() - 0.5) * (tier === "bomb" ? 0.45 : 0.22),
        vy: -0.05 - Math.random() * 0.2,
        life,
        max: life,
        tone: i % 3 === 0 ? "gold" : i % 3 === 1 ? "bone" : side,
      });
    }
  }

  private puff(x: number, side: Side): void {
    for (let i = 0; i < 4; i += 1) {
      const life = 0.2;
      this.bits.push({
        x,
        y: 0.66,
        vx: (Math.random() - 0.5) * 0.08,
        vy: -0.04,
        life,
        max: life,
        tone: side,
      });
    }
  }

  private trimDead(): void {
    if (!this.units.some((unit) => unit.state === "dying" && unit.die <= 0)) return;
    this.units = this.units.filter((unit) => !(unit.state === "dying" && unit.die <= 0));
  }

  private writeLevels(book: Map<number, number>, rows: [number, number][]): void {
    for (const [price, size] of rows) {
      if (size <= 0) book.delete(price);
      else book.set(price, size);
    }
  }

  private rebuildColumns(): void {
    const round = this.round;
    const price = this.price;
    if (!round || price == null) {
      this.columns = [];
      return;
    }
    const bins = 12;
    const bidBins = new Array<number>(bins).fill(0);
    const askBins = new Array<number>(bins).fill(0);
    const bidSpan = Math.max(price - round.low, price * 0.0001);
    const askSpan = Math.max(round.high - price, price * 0.0001);
    for (const [level, qty] of this.bids) {
      if (level < round.low || level > price) continue;
      const t = (level - round.low) / bidSpan;
      const index = Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
      const bin = bidBins[index] ?? 0;
      bidBins[index] = bin + level * qty;
    }
    for (const [level, qty] of this.asks) {
      if (level < price || level > round.high) continue;
      const t = (level - price) / askSpan;
      const index = Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
      const bin = askBins[index] ?? 0;
      askBins[index] = bin + level * qty;
    }
    let max = 1;
    for (const value of bidBins) if (value > max) max = value;
    for (const value of askBins) if (value > max) max = value;
    const columns: BookColumn[] = [];
    const front = this.frontT();
    for (let i = 0; i < bins; i += 1) {
      const bid = bidBins[i] ?? 0;
      const ask = askBins[i] ?? 0;
      if (bid > 0) {
        columns.push({
          side: "long",
          t: (front * i) / bins,
          weight: Math.log10(bid + 10) / Math.log10(max + 10),
        });
      }
      if (ask > 0) {
        columns.push({
          side: "short",
          t: front + ((1 - front) * (i + 1)) / bins,
          weight: Math.log10(ask + 10) / Math.log10(max + 10),
        });
      }
    }
    this.columns = columns;
  }

  private pushFeed(text: string, tone: FeedLine["tone"]): void {
    this.feed.unshift({ text, tone });
    if (this.feed.length > 4) this.feed.length = 4;
  }
}
