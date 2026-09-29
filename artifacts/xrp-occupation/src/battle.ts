import { clamp } from "./format";
import type { Side } from "./parse";

export interface Unit {
  side: Side;
  x: number;
  y: number;
  health: number;
  notional: number;
  leverage: number | null;
  phase: number;
  speed: number;
  depth: number;
  state: "march" | "hold" | "dying" | "dead";
  die: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

export interface Shock {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  maxLife: number;
  side: Side;
}

export interface Pulse {
  x: number;
}

const MAX_UNITS = 380;
const MAX_PARTICLES = 700;

function maxLev(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function opposite(side: Side): Side {
  return side === "long" ? "short" : "long";
}

function chunks(notional: number): number[] {
  const cap = 100_000;
  const parts: number[] = [];
  let left = notional;
  while (left > cap && parts.length < 3) {
    parts.push(cap);
    left -= cap;
  }
  if (left > 0) parts.push(left);
  return parts;
}

export class Battle {
  units: Unit[] = [];
  particles: Particle[] = [];
  shocks: Shock[] = [];
  pulses: Pulse[] = [];
  frontX = 0.5;
  price: number | null = null;
  funding: number | null = null;
  wind = 0;
  punch = 0;
  thump = 0;
  pressureLong = 0;
  pressureShort = 0;
  sawFlow = false;
  ledgerIndex: number | null = null;

  private anchor: number | null = null;
  private priceShift = 0;
  private shove = 0;
  private windTarget = 0;
  private lane = 0;
  private pend = {
    long: 0,
    short: 0,
    longLev: null as number | null,
    shortLev: null as number | null,
    age: 0,
  };

  addTrade(side: Side, notional: number, leverage: number | null): void {
    if (!(notional > 0)) return;
    this.sawFlow = true;
    if (side === "long") this.pressureLong += notional;
    else this.pressureShort += notional;
    this.damage(opposite(side), notional);
    if (notional >= 25_000) {
      this.materialize(side, notional, leverage);
      return;
    }
    if (side === "long") {
      this.pend.long += notional;
      this.pend.longLev = maxLev(this.pend.longLev, leverage);
    } else {
      this.pend.short += notional;
      this.pend.shortLev = maxLev(this.pend.shortLev, leverage);
    }
  }

  setMark(price: number, funding: number): void {
    if (!(price > 0) || !Number.isFinite(funding)) return;
    this.price = price;
    this.funding = funding;
    if (this.anchor == null) this.anchor = price;
    // Positive funding: longs pay. Wind blows against them, toward the left.
    this.windTarget = clamp(funding / 0.0003, -1, 1);
  }

  liquidate(side: Side, notional: number, leverage: number | null): void {
    if (!(notional > 0)) return;
    this.sawFlow = true;
    let best: Unit | null = null;
    let bestScore = Infinity;
    for (const unit of this.units) {
      if (unit.side !== side || unit.state === "dead" || unit.state === "dying") {
        continue;
      }
      const score = Math.abs(
        Math.log(Math.max(unit.notional, 1)) - Math.log(notional),
      );
      if (score < bestScore) {
        best = unit;
        bestScore = score;
      }
    }
    const x = best
      ? best.x
      : side === "long"
        ? Math.max(0.05, this.frontX - 0.04)
        : Math.min(0.95, this.frontX + 0.04);
    const y = best ? best.y : 0.5;
    if (best) {
      best.state = "dead";
      best.health = 0;
      if (leverage != null) best.leverage = leverage;
    }
    this.burst(x, y, side, notional);
    const mag = clamp(0.02 + Math.log10(Math.max(notional, 10)) * 0.016, 0.02, 0.11);
    this.shove += side === "long" ? -mag : mag;
    this.punch = Math.min(
      1,
      this.punch + 0.45 + Math.min(0.55, Math.log10(Math.max(notional, 10)) / 8),
    );
  }

  ledger(index: number): void {
    if (!(index > 0)) return;
    this.ledgerIndex = index;
    this.thump = 1;
    this.pulses.push({ x: -0.08 });
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    const step = Math.min(dt, 0.05);

    this.wind += (this.windTarget - this.wind) * (1 - Math.exp(-step / 0.6));
    if (this.anchor != null && this.price != null) {
      const follow = 1 - Math.exp(-step / 40);
      this.anchor += (this.price - this.anchor) * follow;
      const rel = (this.price - this.anchor) / this.anchor;
      this.priceShift = clamp((rel / 0.004) * 0.22, -0.26, 0.26);
    }
    this.shove *= Math.exp(-step / 2.4);
    this.frontX = clamp(0.5 + this.priceShift + this.shove, 0.16, 0.84);

    const decay = Math.exp(-step / 14);
    this.pressureLong *= decay;
    this.pressureShort *= decay;

    this.pend.age += step;
    this.flush("long");
    this.flush("short");
    if (this.pend.long <= 0 && this.pend.short <= 0) this.pend.age = 0;

    this.moveUnits(step);
    this.separate();
    for (const unit of this.units) {
      unit.y = clamp(unit.y, 0.07, 0.93);
      unit.x = clamp(unit.x, 0.01, 0.99);
    }

    for (const particle of this.particles) {
      particle.life -= step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vx *= Math.exp(-step * 1.4);
      particle.vy *= Math.exp(-step * 1.4);
    }
    if (this.particles.some((particle) => particle.life <= 0)) {
      this.particles = this.particles.filter((particle) => particle.life > 0);
    }
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }

    for (const shock of this.shocks) {
      shock.life -= step;
      const k = 1 - shock.life / shock.maxLife;
      shock.r = shock.max * Math.max(0, k);
    }
    if (this.shocks.some((shock) => shock.life <= 0)) {
      this.shocks = this.shocks.filter((shock) => shock.life > 0);
    }

    for (const pulse of this.pulses) pulse.x += step * 1.35;
    if (this.pulses.some((pulse) => pulse.x > 1.15)) {
      this.pulses = this.pulses.filter((pulse) => pulse.x <= 1.15);
    }

    this.thump *= Math.exp(-step / 0.35);
    this.punch *= Math.exp(-step / 0.16);

    if (this.units.some((unit) => unit.state === "dead")) {
      this.units = this.units.filter((unit) => unit.state !== "dead");
    }
  }

  private flush(side: Side): void {
    const amount = side === "long" ? this.pend.long : this.pend.short;
    if (amount <= 0) return;
    const ready = amount >= 50 || this.pend.age >= 0.7;
    if (!ready) return;
    const leverage = side === "long" ? this.pend.longLev : this.pend.shortLev;
    if (side === "long") {
      this.pend.long = 0;
      this.pend.longLev = null;
    } else {
      this.pend.short = 0;
      this.pend.shortLev = null;
    }
    this.materialize(side, amount, leverage);
  }

  private materialize(side: Side, notional: number, leverage: number | null): void {
    for (const part of chunks(notional)) {
      const host = this.countYoung(side) >= 6 ? this.youngestMarching(side) : null;
      if (host) {
        host.notional += part;
        host.health += part;
        host.leverage = maxLev(host.leverage, leverage);
        continue;
      }
      this.units.push(this.makeUnit(side, part, leverage));
    }
    this.trim();
  }

  private makeUnit(side: Side, notional: number, leverage: number | null): Unit {
    this.lane += 1;
    const y = 0.1 + ((this.lane * 0.381966) % 1) * 0.8;
    return {
      side,
      x: side === "long" ? 0.018 + Math.random() * 0.04 : 0.982 - Math.random() * 0.04,
      y,
      health: notional,
      notional,
      leverage,
      phase: Math.random() * Math.PI * 2,
      speed: 0.055 + Math.random() * 0.035,
      depth: 0.012 + Math.random() * 0.055,
      state: "march",
      die: 0,
    };
  }

  private countYoung(side: Side): number {
    let count = 0;
    for (const unit of this.units) {
      if (unit.side === side && unit.state === "march" && unit.x < 0.12) count += 1;
      else if (unit.side === side && unit.state === "march" && unit.x > 0.88) count += 1;
    }
    return count;
  }

  private youngestMarching(side: Side): Unit | null {
    let host: Unit | null = null;
    for (const unit of this.units) {
      if (unit.side !== side || unit.state !== "march") continue;
      const nearEdge =
        side === "long" ? unit.x < 0.2 : unit.x > 0.8;
      if (!nearEdge) continue;
      host = unit;
    }
    return host;
  }

  private moveUnits(dt: number): void {
    for (const unit of this.units) {
      if (unit.state === "dying") {
        unit.die -= dt;
        if (unit.die <= 0) unit.state = "dead";
        continue;
      }
      if (unit.state === "dead") continue;

      const head =
        unit.side === "long" ? Math.max(this.wind, 0) : Math.max(-this.wind, 0);
      const speed = unit.speed * (1 - head * 0.75);
      const dir = unit.side === "long" ? 1 : -1;
      if (unit.state === "march") {
        unit.x += dir * speed * dt;
        unit.phase += dt * 7;
      }

      const limit =
        unit.side === "long" ? this.frontX - unit.depth : this.frontX + unit.depth;
      const reached = unit.side === "long" ? unit.x >= limit : unit.x <= limit;
      if (reached) {
        unit.x = limit;
        unit.state = "hold";
      }

      if (unit.state === "hold") {
        const target =
          unit.side === "long" ? this.frontX - unit.depth : this.frontX + unit.depth;
        unit.x += (target - unit.x) * Math.min(1, dt * 3);
        const push =
          unit.side === "long" ? -Math.max(this.wind, 0) : Math.max(-this.wind, 0);
        unit.x += push * 0.02 * dt;
        const gap = unit.side === "long" ? this.frontX - unit.x : unit.x - this.frontX;
        if (gap > unit.depth + 0.08) unit.state = "march";
      }

      unit.y = clamp(unit.y, 0.07, 0.93);
      unit.x = clamp(unit.x, 0.01, 0.99);
    }
  }

  private separate(): void {
    const held = this.units.filter((unit) => unit.state === "hold");
    const min = 0.02;
    for (let i = 0; i < held.length; i += 1) {
      const a = held[i];
      if (!a) continue;
      for (let j = i + 1; j < held.length; j += 1) {
        const b = held[j];
        if (!b || a.side !== b.side) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 0 || d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.3;
        const uy = (dy / d) * push;
        a.y += uy;
        b.y -= uy;
      }
    }
  }

  private damage(side: Side, amount: number): void {
    const foes = this.units.filter(
      (unit) =>
        unit.side === side &&
        (unit.state === "march" || unit.state === "hold") &&
        unit.health > 0,
    );
    if (!foes.length) return;
    let sum = 0;
    const weights = foes.map((unit) => {
      const dist = Math.abs(unit.x - this.frontX);
      const weight = Math.max(unit.health, 1) / (0.03 + dist);
      sum += weight;
      return weight;
    });
    for (let i = 0; i < foes.length; i += 1) {
      const foe = foes[i];
      const weight = weights[i];
      if (!foe || weight == null || sum <= 0) continue;
      foe.health -= amount * (weight / sum);
      if (foe.health <= 0) this.wearOut(foe);
    }
  }

  private wearOut(unit: Unit): void {
    if (unit.state === "dying" || unit.state === "dead") return;
    unit.health = 0;
    unit.state = "dying";
    unit.die = 0.45;
    this.puff(unit.x, unit.y, unit.side, 7);
  }

  private puff(x: number, y: number, side: Side, count: number): void {
    const color = side === "long" ? [62, 224, 197] : [255, 91, 61];
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.02 + Math.random() * 0.06;
      const life = 0.25 + Math.random() * 0.35;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        max: life,
        size: 1.2 + Math.random() * 1.8,
        r: color[0] ?? 255,
        g: color[1] ?? 255,
        b: color[2] ?? 255,
      });
    }
  }

  private burst(x: number, y: number, side: Side, notional: number): void {
    const count = clamp(Math.round(24 + Math.log10(notional) * 18), 22, 96);
    const color = side === "long" ? [62, 224, 197] : [255, 91, 61];
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.08 + Math.random() * 0.42;
      const life = 0.35 + Math.random() * 0.75;
      const hot = i % 4 === 0;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        max: life,
        size: 1.6 + Math.random() * 3.4,
        r: hot ? 255 : (color[0] ?? 255),
        g: hot ? 244 : (color[1] ?? 255),
        b: hot ? 226 : (color[2] ?? 255),
      });
    }
    const maxLife = 0.55;
    this.shocks.push({
      x,
      y,
      r: 0,
      max: 0.18 + Math.min(0.32, Math.log10(Math.max(notional, 10)) / 14),
      life: maxLife,
      maxLife,
      side,
    });
  }

  private trim(): void {
    if (this.units.length <= MAX_UNITS) return;
    const ranked = [...this.units].sort((a, b) => a.health - b.health);
    const drop = new Set(ranked.slice(0, this.units.length - MAX_UNITS));
    this.units = this.units.filter((unit) => !drop.has(unit));
  }
}
