import { clamp, formatUsd } from "./format";
import type { LinkStatus } from "./net";
import type { Side } from "./parse";

export type UnitKind = "infantry" | "tank" | "rocket";
export type StrikeTier = "burst" | "strike" | "bomb";

export const TANK_USD = 2500;
export const FEED_TRADE_USD = 8000;
export const LIQ_STRIKE_USD = 5000;
export const LIQ_BOMB_USD = 25000;
const LUNGE_USD = 400;
const RANGE_FRAC = 0.0022;
const BINS = 8;

export interface Rank {
  key: string;
  side: Side;
  kind: UnitKind;
  x: number;
  target: number;
  lane: number;
  step: number;
  knock: number;
  fire: number;
  cheer: boolean;
  retreating: boolean;
}

export interface Squad {
  side: Side;
  kind: "infantry" | "tank";
  x: number;
  lane: number;
  count: number;
  hitting: number;
}

export interface Fx {
  kind: "burst" | "arc" | "craft" | "smoke" | "dust" | "spark";
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  extra: number;
  flag: number;
}

export interface BookColumn {
  side: Side;
  t: number;
  weight: number;
  bin: number;
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

function opposite(side: Side): Side {
  return side === "long" ? "short" : "long";
}

function strikeTier(notional: number): StrikeTier {
  if (notional >= LIQ_BOMB_USD) return "bomb";
  if (notional >= LIQ_STRIKE_USD) return "strike";
  return "burst";
}

export class Battle {
  ranks: Rank[] = [];
  squads: Squad[] = [];
  fx: Fx[] = [];
  columns: BookColumn[] = [];
  feed: FeedLine[] = [];
  price: number | null = null;
  funding: number | null = null;
  oiUsd: number | null = null;
  pressureLong = 0;
  pressureShort = 0;
  sawFlow = false;
  round: Round | null = null;
  banner: { text: string; side: Side; life: number; age: number } | null = null;
  shake = 0;
  pulse = -1;
  shown = 0.5;
  phase: "live" | "victory" = "live";
  link: LinkStatus = { state: "connecting", detail: "connecting", retryInMs: null };
  winsLong = 0;
  winsShort = 0;

  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private prices: Sample[] = [];
  private liqs: Sample[] = [];
  private clock = 0;
  private roundBorn = 0;
  private bookDirty = true;
  private victoryLeft = 0;
  private victor: Side | null = null;

  setLink(status: LinkStatus): void {
    this.link = status;
  }

  addTrade(side: Side, notional: number, price: number): void {
    if (!(notional > 0) || !(price > 0)) return;
    this.sawFlow = true;
    this.notePrice(price, true);
    if (side === "long") this.pressureLong += notional;
    else this.pressureShort += notional;
    if (notional >= FEED_TRADE_USD) {
      const label = side === "long" ? "BUY" : "SELL";
      this.pushFeed(`${label} ${formatUsd(notional)}`, side);
    }
    if (notional >= LUNGE_USD && this.phase === "live") this.launch(side, notional);
  }

  addLiquidation(side: Side, notional: number): void {
    if (!(notional > 0)) return;
    this.sawFlow = true;
    this.liqs.push({ t: this.clock, v: notional });
    const tier = strikeTier(notional);
    const x = this.strikeX(side);
    if (tier === "bomb") this.spawnCraft(side, x);
    else if (tier === "strike") this.spawnArc(side, x);
    else this.detonate(side, x, "burst");
    if (tier !== "burst") {
      const who = side === "long" ? "LONG" : "SHORT";
      const tag = tier === "bomb" ? "BOMB" : "ROCKET";
      this.pushFeed(`${tag} ${who} ${formatUsd(notional)}`, side);
    }
    this.kickRockets(opposite(side));
    this.ensureRockets();
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
    this.easeFront(step);
    this.march(step);
    this.marchSquads(step);
    this.simFx(step);
    this.shake = Math.max(0, this.shake - step * 1.4);
    if (this.pulse >= 0) {
      this.pulse += step * 0.85;
      if (this.pulse > 1.05) this.pulse = -1;
    }
    if (this.banner) {
      this.banner.age += step;
      this.banner.life -= step;
      if (this.banner.life <= 0 && this.phase !== "victory") this.banner = null;
    }
    if (this.phase === "victory") {
      this.victoryLeft -= step;
      if (this.victoryLeft <= 0) this.finishVictory();
    }
    this.prices = this.prices.filter((sample) => this.clock - sample.t < 8);
    this.liqs = this.liqs.filter((sample) => this.clock - sample.t < 10);
    if (this.phase === "live" && this.bookDirty) {
      this.rebuildColumns();
      this.syncFormation();
      this.ensureRockets();
      this.bookDirty = false;
    }
  }

  readout(): string {
    const price = this.price == null ? "PRICE --" : `PRICE ${this.price.toFixed(4)}`;
    const latest = this.feed[0]?.text ?? "FEED EMPTY";
    const banner = this.banner ? ` BANNER ${this.banner.text}` : "";
    return `${this.statusText()} | ${price} | RANKS ${this.ranks.length} | LUNGES ${this.squads.length} | ${latest}${banner}`;
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

  frontT(): number {
    if (!this.price || !this.round) return 0.5;
    const span = this.round.high - this.round.low;
    if (!(span > 0)) return 0.5;
    return clamp((this.price - this.round.low) / span, 0, 1);
  }

  private notePrice(price: number, fromTrade: boolean): void {
    this.price = price;
    if (fromTrade) this.prices.push({ t: this.clock, v: price });
    if (!this.round) {
      this.openRound(price);
      this.shown = this.frontT();
      return;
    }
    if (this.banner || this.phase === "victory" || this.clock - this.roundBorn < 2) return;
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
    this.banner = { text, side, life: 2.3, age: 0 };
    this.pushFeed(text, side);
    if (side === "long") this.winsLong += 1;
    else this.winsShort += 1;
    this.phase = "victory";
    this.victor = side;
    this.victoryLeft = 2.15;
    this.squads = [];
    for (const rank of this.ranks) {
      if (rank.side === side) {
        rank.cheer = true;
        rank.retreating = false;
      } else {
        rank.cheer = false;
        rank.retreating = true;
        rank.target = rank.side === "long" ? -0.28 : 1.28;
      }
    }
  }

  private finishVictory(): void {
    this.phase = "live";
    this.victor = null;
    this.banner = null;
    this.ranks = [];
    this.squads = [];
    this.fx = [];
    if (this.price) this.openRound(this.price);
  }

  private easeFront(dt: number): void {
    const target = this.frontT();
    const prev = this.shown;
    const k = 1 - Math.exp(-dt / 0.3);
    this.shown += (target - this.shown) * k;
    if (Math.abs(this.shown - prev) > 0.0035) this.puffDust(this.shown);
  }

  private launch(side: Side, notional: number): void {
    const tank = notional >= TANK_USD;
    const count = clamp(Math.round(notional / (tank ? 4500 : 900)), 1, tank ? 3 : 5);
    const open = this.squads.find((squad) => squad.side === side && squad.hitting <= 0);
    if (this.squads.length >= 6 && open) {
      open.count = Math.min(tank ? 3 : 6, open.count + 1);
      return;
    }
    this.squads.push({
      side,
      kind: tank ? "tank" : "infantry",
      x: side === "long" ? 0.07 : 0.93,
      lane: Math.random(),
      count,
      hitting: 0,
    });
  }

  private march(dt: number): void {
    for (const rank of this.ranks) {
      rank.knock = Math.max(0, rank.knock - dt * 1.6);
      rank.fire = Math.max(0, rank.fire - dt);
      const gap = rank.target - rank.x;
      const moving = Math.abs(gap) > 0.006;
      if (!moving) continue;
      const dir = gap > 0 ? 1 : -1;
      const base = rank.kind === "tank" ? 0.11 : rank.kind === "rocket" ? 0.07 : 0.26;
      const speed = base * (rank.retreating ? 2.4 : 1);
      rank.x += dir * speed * dt;
      if ((dir > 0 && rank.x > rank.target) || (dir < 0 && rank.x < rank.target)) rank.x = rank.target;
      rank.step += dt * (rank.kind === "tank" ? 4.5 : 8);
    }
    this.ranks = this.ranks.filter((rank) => rank.x > -0.35 && rank.x < 1.35);
  }

  private marchSquads(dt: number): void {
    const front = this.frontT();
    const next: Squad[] = [];
    for (const squad of this.squads) {
      if (squad.hitting > 0) {
        squad.hitting -= dt;
        if (squad.hitting > 0) next.push(squad);
        continue;
      }
      const goal = squad.side === "long" ? front - 0.015 : front + 0.015;
      const dir = goal > squad.x ? 1 : -1;
      const speed = squad.kind === "tank" ? 0.62 : 1.05;
      squad.x += dir * speed * dt;
      const arrived = dir > 0 ? squad.x >= goal : squad.x <= goal;
      if (arrived) {
        squad.x = goal;
        squad.hitting = 0.18;
        this.spark(squad.x, squad.side);
        this.scatter(opposite(squad.side), 0.045);
        this.shake = Math.max(this.shake, 0.08);
      }
      next.push(squad);
    }
    this.squads = next;
  }

  private scatter(side: Side, power: number): void {
    const away = side === "long" ? -1 : 1;
    for (const rank of this.ranks) {
      if (rank.side !== side || rank.kind === "rocket") continue;
      if (Math.abs(rank.x - this.frontT()) > 0.22) continue;
      rank.x += away * power;
      rank.knock = Math.max(rank.knock, power * 4);
    }
  }

  private strikeX(side: Side): number {
    const front = this.frontT();
    const mates = this.ranks.filter((rank) => rank.side === side && rank.kind !== "rocket");
    if (mates.length) {
      let best = mates[0];
      if (!best) return side === "long" ? front - 0.05 : front + 0.05;
      for (const rank of mates) {
        if (Math.abs(rank.x - front) < Math.abs(best.x - front)) best = rank;
      }
      return best.x;
    }
    return side === "long" ? Math.max(0.1, front - 0.06) : Math.min(0.9, front + 0.06);
  }

  private detonate(side: Side, x: number, tier: StrikeTier): void {
    const life = tier === "bomb" ? 0.36 : tier === "strike" ? 0.32 : 0.32;
    this.fx.push({
      kind: "burst",
      side,
      x,
      y: tier === "bomb" ? 168 : 176,
      vx: 0,
      vy: 0,
      life,
      max: life,
      extra: tier === "bomb" ? 2 : 1,
      flag: 0,
    });
    const smokes = tier === "bomb" ? 10 : tier === "strike" ? 7 : 0;
    for (let i = 0; i < smokes; i += 1) {
      const smokeLife = tier === "bomb" ? 1.15 : 1;
      this.fx.push({
        kind: "smoke",
        side,
        x: x + (Math.random() - 0.5) * 0.04,
        y: 168 + Math.random() * 10,
        vx: (Math.random() - 0.5) * 0.05,
        vy: -10 - Math.random() * 16,
        life: smokeLife,
        max: smokeLife,
        extra: 0,
        flag: 0,
      });
    }
    const dusts = tier === "bomb" ? 14 : tier === "strike" ? 6 : 3;
    for (let i = 0; i < dusts; i += 1) {
      const dustLife = 0.45 + Math.random() * 0.25;
      this.fx.push({
        kind: "dust",
        side,
        x: x + (Math.random() - 0.5) * 0.08,
        y: 214,
        vx: (Math.random() - 0.5) * 0.2,
        vy: -18 - Math.random() * 20,
        life: dustLife,
        max: dustLife,
        extra: 0,
        flag: 0,
      });
    }
    const power = tier === "bomb" ? 0.1 : tier === "strike" ? 0.06 : 0.035;
    this.scatter(side, power);
    this.shake = Math.max(this.shake, tier === "bomb" ? 0.55 : tier === "strike" ? 0.28 : 0.14);
  }

  private spawnArc(side: Side, x: number): void {
    const from = side === "long" ? 0.02 : 0.98;
    this.fx.push({
      kind: "arc",
      side,
      x: from,
      y: 42,
      vx: (x - from) / 0.48,
      vy: -70,
      life: 0.7,
      max: 0.7,
      extra: x,
      flag: 0,
    });
  }

  private spawnCraft(side: Side, x: number): void {
    const fromLeft = side === "short";
    this.fx.push({
      kind: "craft",
      side,
      x: fromLeft ? -0.12 : 1.12,
      y: 48,
      vx: fromLeft ? 0.85 : -0.85,
      vy: 0,
      life: 1.6,
      max: 1.6,
      extra: x,
      flag: 0,
    });
  }

  private spark(x: number, side: Side): void {
    this.fx.push({
      kind: "spark",
      side,
      x,
      y: 188,
      vx: 0,
      vy: 0,
      life: 0.16,
      max: 0.16,
      extra: 0,
      flag: 0,
    });
  }

  private puffDust(t: number): void {
    for (let i = 0; i < 3; i += 1) {
      const life = 0.28;
      this.fx.push({
        kind: "dust",
        side: "long",
        x: t + (Math.random() - 0.5) * 0.02,
        y: 220,
        vx: (Math.random() - 0.5) * 0.08,
        vy: -12,
        life,
        max: life,
        extra: 0,
        flag: 0,
      });
    }
  }

  private simFx(dt: number): void {
    const snapshot = this.fx.splice(0, this.fx.length);
    const next: Fx[] = [];
    for (const fx of snapshot) {
      fx.life -= dt;
      if (fx.kind === "arc") {
        fx.x += fx.vx * dt;
        fx.vy += 220 * dt;
        fx.y += fx.vy * dt;
        if (fx.y >= 176) {
          this.detonate(fx.side, fx.extra, "strike");
          continue;
        }
      } else if (fx.kind === "craft") {
        fx.x += fx.vx * dt;
        const crossed = fx.vx > 0 ? fx.x >= fx.extra : fx.x <= fx.extra;
        if (fx.flag === 0 && crossed) {
          fx.flag = 1;
          this.detonate(fx.side, fx.extra, "bomb");
        }
      } else {
        if (fx.kind === "dust") fx.vy += 48 * dt;
        fx.x += fx.vx * dt;
        fx.y += fx.vy * dt;
      }
      if (fx.life > 0) next.push(fx);
    }
    this.fx = next.concat(this.fx).slice(-180);
  }

  private kickRockets(side: Side): void {
    for (const rank of this.ranks) {
      if (rank.kind === "rocket" && rank.side === side) rank.fire = 0.2;
    }
  }

  private ensureRockets(): void {
    const hot = this.hotVol() || this.hotLiq();
    if (!hot || this.phase !== "live") {
      if (!hot) this.ranks = this.ranks.filter((rank) => rank.kind !== "rocket");
      return;
    }
    for (const side of ["long", "short"] as const) {
      if (this.ranks.some((rank) => rank.kind === "rocket" && rank.side === side)) continue;
      this.ranks.push({
        key: `rocket:${side}`,
        side,
        kind: "rocket",
        x: side === "long" ? 0.02 : 0.98,
        target: side === "long" ? 0.12 : 0.88,
        lane: 0,
        step: 0,
        knock: 0,
        fire: 0,
        cheer: false,
        retreating: false,
      });
    }
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

  private writeLevels(book: Map<number, number>, rows: [number, number][]): void {
    for (const [level, size] of rows) {
      if (size <= 0) book.delete(level);
      else book.set(level, size);
    }
  }

  private rebuildColumns(): void {
    const round = this.round;
    const price = this.price;
    if (!round || price == null) {
      this.columns = [];
      return;
    }
    const bidBins = new Array<number>(BINS).fill(0);
    const askBins = new Array<number>(BINS).fill(0);
    const bidSpan = Math.max(price - round.low, price * 0.0001);
    const askSpan = Math.max(round.high - price, price * 0.0001);
    for (const [level, qty] of this.bids) {
      if (level < round.low || level > price) continue;
      const t = (level - round.low) / bidSpan;
      const index = Math.min(BINS - 1, Math.max(0, Math.floor(t * BINS)));
      const bin = bidBins[index] ?? 0;
      bidBins[index] = bin + level * qty;
    }
    for (const [level, qty] of this.asks) {
      if (level < price || level > round.high) continue;
      const t = (level - price) / askSpan;
      const index = Math.min(BINS - 1, Math.max(0, Math.floor(t * BINS)));
      const bin = askBins[index] ?? 0;
      askBins[index] = bin + level * qty;
    }
    let max = 1;
    for (const value of bidBins) if (value > max) max = value;
    for (const value of askBins) if (value > max) max = value;
    const columns: BookColumn[] = [];
    const front = this.frontT();
    const left0 = 0.1;
    const right1 = 0.9;
    for (let i = 0; i < BINS; i += 1) {
      const bid = bidBins[i] ?? 0;
      const ask = askBins[i] ?? 0;
      if (bid > 0 && front > left0 + 0.02) {
        columns.push({
          side: "long",
          bin: i,
          t: left0 + ((front - left0) * (i + 0.5)) / BINS,
          weight: Math.log10(bid + 10) / Math.log10(max + 10),
        });
      }
      if (ask > 0 && right1 > front + 0.02) {
        columns.push({
          side: "short",
          bin: i,
          t: front + ((right1 - front) * (i + 0.5)) / BINS,
          weight: Math.log10(ask + 10) / Math.log10(max + 10),
        });
      }
    }
    this.columns = columns;
  }

  private syncFormation(): void {
    const front = this.frontT();
    const want: Rank[] = [];
    for (const column of this.columns) {
      const depth = Math.abs(column.t - front);
      const near = depth < 0.14;
      const heavy = column.weight > 0.74 && !near;
      const count = near
        ? column.weight > 0.55
          ? 4
          : 3
        : column.weight > 0.8
          ? 3
          : column.weight > 0.4
            ? 2
            : 1;
      for (let slot = 0; slot < count; slot += 1) {
        const kind: UnitKind = heavy && slot === 0 ? "tank" : "infantry";
        want.push({
          key: `${column.side}:${column.bin}:${slot}`,
          side: column.side,
          kind,
          x: column.side === "long" ? 0.04 : 0.96,
          target: column.t,
          lane: slot,
          step: 0,
          knock: 0,
          fire: 0,
          cheer: false,
          retreating: false,
        });
      }
    }
    const keep = new Set<string>();
    for (const spec of want) {
      keep.add(spec.key);
      const found = this.ranks.find((rank) => rank.key === spec.key);
      if (found) {
        if (!found.retreating) found.target = spec.target;
        found.kind = spec.kind;
        found.lane = spec.lane;
      } else {
        this.ranks.push(spec);
      }
    }
    this.ranks = this.ranks.filter((rank) => rank.kind === "rocket" || keep.has(rank.key));
  }

  private pushFeed(text: string, tone: FeedLine["tone"]): void {
    this.feed.unshift({ text, tone });
    if (this.feed.length > 3) this.feed.length = 3;
  }
}
