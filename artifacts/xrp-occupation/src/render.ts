import type { Battle, Fx, Rank, Squad } from "./battle";
import { formatFunding, formatPrice, formatUsd } from "./format";
import { drawText, textWidth } from "./font";
import {
  BEAR,
  BEAR_CHEER,
  BEAR_STEP,
  BULL,
  BULL_CHEER,
  BULL_STEP,
  LONG_PALETTE,
  PLANE,
  ROCKET,
  ROCKET_FIRE,
  SHORT_PALETTE,
  TANK,
  TANK_STEP,
  blit,
  type Palette,
} from "./sprites";

const W = 480;
const H = 270;
const GROUND = 92;

function xt(t: number): number {
  return Math.round(36 + t * (444 - 36));
}

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function rowsFor(rank: Rank, frame: number): readonly string[] {
  if (rank.kind === "rocket") return rank.fire > 0 ? ROCKET_FIRE : ROCKET;
  if (rank.kind === "tank") return frame === 1 ? TANK_STEP : TANK;
  if (rank.cheer) return rank.side === "long" ? BULL_CHEER : BEAR_CHEER;
  if (rank.side === "long") return frame === 1 ? BULL_STEP : BULL;
  return frame === 1 ? BEAR_STEP : BEAR;
}

export class FieldView {
  private readonly buf: HTMLCanvasElement;
  private readonly btx: CanvasRenderingContext2D;
  private readonly ctx: CanvasRenderingContext2D;
  private time = 0;
  private cssW = 0;
  private cssH = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.buf = document.createElement("canvas");
    this.buf.width = W;
    this.buf.height = H;
    const btx = this.buf.getContext("2d", { alpha: false });
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!btx || !ctx) throw new Error("Canvas is not available");
    this.btx = btx;
    this.ctx = ctx;
    this.btx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
    this.cssW = W * scale;
    this.cssH = H * scale;
    this.canvas.width = this.cssW;
    this.canvas.height = this.cssH;
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(battle: Battle, dt: number): void {
    this.time += dt;
    const ctx = this.btx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#10141f";
    ctx.fillRect(0, 0, W, H);
    const mag = battle.shake > 0.4 ? 3 : battle.shake > 0.2 ? 2 : battle.shake > 0.04 ? 1 : 0;
    const phase = Math.floor(this.time * 28);
    const ox = mag === 0 ? 0 : phase % 2 === 0 ? mag : -mag;
    const oy = mag > 1 && phase % 3 === 0 ? 1 : 0;
    ctx.save();
    ctx.translate(ox, oy);
    this.sky(ctx);
    this.stars(ctx);
    this.ground(ctx, battle);
    this.wind(ctx, battle);
    this.forts(ctx, battle);
    this.army(ctx, battle.ranks);
    this.squads(ctx, battle.squads);
    this.front(ctx, battle);
    this.fx(ctx, battle.fx);
    this.pulse(ctx, battle.pulse);
    ctx.restore();
    this.banner(ctx, battle);
    this.hud(ctx, battle);
    this.footer(ctx, battle);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = "#05060a";
    this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.ctx.drawImage(this.buf, 0, 0, this.cssW, this.cssH);
  }

  private sky(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#10141f";
    ctx.fillRect(0, 0, W, 78);
    ctx.fillStyle = "#171d2c";
    ctx.fillRect(0, 78, W, GROUND - 78);
  }

  private stars(ctx: CanvasRenderingContext2D): void {
    const blink = Math.floor(this.time * 2);
    for (let i = 0; i < 22; i += 1) {
      const on = (hash(i * 13 + blink) & 3) !== 0;
      if (!on) continue;
      const x = (hash(i * 17) % 450) + 14;
      const y = (hash(i * 29) % 58) + 18;
      ctx.fillStyle = i % 5 === 0 ? "#f3ead4" : "#3c4662";
      ctx.fillRect(x, y, 1, 1);
    }
  }

  private wind(ctx: CanvasRenderingContext2D, battle: Battle): void {
    const rate = battle.funding;
    if (rate == null || Math.abs(rate) < 0.0000005) return;
    const againstLong = rate > 0;
    const mag = Math.max(0.25, Math.min(1, Math.abs(rate) / 0.0003));
    const count = 4 + Math.round(mag * 8);
    const dir = againstLong ? -1 : 1;
    ctx.fillStyle = againstLong ? "#1f7a32" : "#9a2a24";
    for (let i = 0; i < count; i += 1) {
      const span = againstLong ? 200 : 200;
      const origin = againstLong ? 16 : 264;
      const speed = dir * (30 + mag * 90);
      const travel = (hash(i * 41) + this.time * speed) % span;
      const x = origin + (travel < 0 ? travel + span : travel);
      const y = 100 + (hash(i * 19) % 120);
      const len = 3 + (hash(i * 7) % 4);
      ctx.fillRect(Math.round(x), y, len, 1);
    }
  }

  private ground(ctx: CanvasRenderingContext2D, battle: Battle): void {
    ctx.fillStyle = "#24180f";
    ctx.fillRect(0, GROUND, W, 46);
    ctx.fillStyle = "#1c140e";
    ctx.fillRect(0, GROUND + 46, W, H - GROUND - 46);
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(0, GROUND, W, 1);
    for (let x = 4; x < W; x += 6) {
      if ((hash(x) & 3) !== 0) continue;
      ctx.fillStyle = "#2c1e14";
      ctx.fillRect(x, GROUND + 8 + (hash(x + 3) % 130), 2, 1);
    }
    const front = battle.shown;
    if (front < 0.12) {
      ctx.fillStyle = "#4a201c";
      ctx.fillRect(30, GROUND, 28, 150);
    }
    if (front > 0.88) {
      ctx.fillStyle = "#1e3a28";
      ctx.fillRect(422, GROUND, 28, 150);
    }
    if (battle.round) {
      for (const mark of [0, 0.25, 0.5, 0.75, 1]) {
        const x = xt(mark);
        ctx.fillStyle = mark === 0 || mark === 1 ? "#6a5038" : "#3a2818";
        ctx.fillRect(x, GROUND + 2, 1, 148);
      }
      const low = formatPrice(battle.round.low);
      const high = formatPrice(battle.round.high);
      drawText(ctx, low, 36, 232, "#8d8678");
      drawText(ctx, high, 444 - textWidth(high), 232, "#8d8678");
    }
  }

  private forts(ctx: CanvasRenderingContext2D, battle: Battle): void {
    this.fort(ctx, "long", 4);
    this.fort(ctx, "short", 448);
    drawText(ctx, "LONGS", 4, 18, "#3ecf4a");
    drawText(ctx, `BULLS ${battle.winsLong}`, 4, 28, "#3ecf4a");
    const shorts = "SHORTS";
    const bears = `BEARS ${battle.winsShort}`;
    drawText(ctx, shorts, W - 4 - textWidth(shorts), 18, "#e4453a");
    drawText(ctx, bears, W - 4 - textWidth(bears), 28, "#e4453a");
  }

  private fort(ctx: CanvasRenderingContext2D, side: Rank["side"], x: number): void {
    const h = side === "long" ? "#3ecf4a" : "#e4453a";
    const d = side === "long" ? "#145c22" : "#6e1612";
    const n = side === "long" ? "#0c3a14" : "#3a0c0a";
    ctx.fillStyle = d;
    ctx.fillRect(x, 156, 28, 80);
    ctx.fillStyle = h;
    ctx.fillRect(x + 2, 148, 24, 10);
    for (let i = 0; i < 4; i += 1) ctx.fillRect(x + 2 + i * 7, 138, 4, 12);
    ctx.fillStyle = n;
    ctx.fillRect(x + 10, 198, 8, 26);
    ctx.fillStyle = "#c8b48a";
    ctx.fillRect(x + 20, 116, 1, 24);
    ctx.fillStyle = h;
    ctx.fillRect(x + 21, 116, 8, 5);
  }

  private army(ctx: CanvasRenderingContext2D, ranks: readonly Rank[]): void {
    const ordered = [...ranks].sort((a, b) => a.lane - b.lane);
    for (const rank of ordered) this.sprite(ctx, rank, false);
  }

  private squads(ctx: CanvasRenderingContext2D, squads: readonly Squad[]): void {
    for (const squad of squads) {
      for (let i = 0; i < squad.count; i += 1) {
        const rank: Rank = {
          key: "",
          side: squad.side,
          kind: squad.kind,
          x: squad.x,
          target: squad.x + (squad.side === "long" ? 0.05 : -0.05),
          lane: 1 + (i % 3),
          step: this.time * 10 + i,
          knock: 0,
          fire: 0,
          cheer: false,
          retreating: false,
        };
        const ox = (i - (squad.count - 1) / 2) * (squad.kind === "tank" ? 10 : 7);
        this.sprite(ctx, rank, squad.hitting > 0.08, ox);
      }
    }
  }

  private sprite(ctx: CanvasRenderingContext2D, rank: Rank, flash: boolean, ox = 0): void {
    const moving = Math.abs(rank.target - rank.x) > 0.008;
    const frame = moving ? Math.floor(rank.step) % 2 : 0;
    const bob = moving ? 0 : Math.floor(this.time * 3 + rank.lane * 1.7) % 2;
    const rows = rowsFor(rank, frame);
    const base = rank.side === "long" ? LONG_PALETTE : SHORT_PALETTE;
    const palette: Palette = flash ? { h: "#f7f3ea", d: base.d, w: "#ffffff", n: base.n } : base;
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const stepPx = moving && frame === 1 ? (rank.side === "long" ? 1 : -1) : 0;
    const knockPx = Math.round(rank.knock * (rank.side === "long" ? -8 : 8));
    const y = 124 + rank.lane * 22 - height + bob;
    const x = xt(rank.x) - Math.floor(width / 2) + stepPx + knockPx + ox;
    blit(ctx, rows, x, y, palette, rank.side === "short");
  }

  private front(ctx: CanvasRenderingContext2D, battle: Battle): void {
    const x = xt(battle.shown);
    ctx.fillStyle = "#1a120c";
    ctx.fillRect(x - 1, 86, 3, 150);
    ctx.fillStyle = "#f3ead4";
    ctx.fillRect(x, 86, 1, 150);
    ctx.fillStyle = "#f0c84a";
    ctx.fillRect(x - 2, 86, 5, 3);
    const label = battle.price == null ? "----" : formatPrice(battle.price);
    const width = textWidth(label, 2);
    let lx = x - Math.round(width / 2);
    lx = Math.max(52, Math.min(lx, 428 - width));
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(lx - 2, 68, width + 4, 16);
    drawText(ctx, label, lx, 70, "#f3ead4", 2);
  }

  private fx(ctx: CanvasRenderingContext2D, effects: readonly Fx[]): void {
    for (const fx of effects) {
      if (fx.kind === "craft") this.craft(ctx, fx);
      else if (fx.kind === "arc") this.missile(ctx, fx);
      else if (fx.kind === "burst") this.burst(ctx, fx);
      else if (fx.kind === "spark") this.spark(ctx, fx);
      else if (fx.kind === "smoke") {
        ctx.fillStyle = "#6a6458";
        ctx.fillRect(xt(fx.x), Math.round(fx.y), 2, 2);
      } else {
        ctx.fillStyle = "#6a5038";
        ctx.fillRect(xt(fx.x), Math.round(fx.y), 2, 1);
      }
    }
  }

  private craft(ctx: CanvasRenderingContext2D, fx: Fx): void {
    const palette = fx.side === "long" ? SHORT_PALETTE : LONG_PALETTE;
    blit(ctx, PLANE, xt(fx.x) - 5, fx.y, palette, fx.vx < 0);
  }

  private missile(ctx: CanvasRenderingContext2D, fx: Fx): void {
    const x = xt(fx.x);
    const y = Math.round(fx.y);
    ctx.fillStyle = "#f0c84a";
    ctx.fillRect(x, y, 2, 4);
    ctx.fillStyle = fx.side === "long" ? "#e4453a" : "#3ecf4a";
    ctx.fillRect(x, y - 2, 2, 2);
  }

  private burst(ctx: CanvasRenderingContext2D, fx: Fx): void {
    const frame = Math.min(3, Math.floor((1 - fx.life / fx.max) * 4));
    const x = xt(fx.x);
    const y = Math.round(fx.y);
    const big = fx.extra >= 2;
    const color = frame === 3 ? "#f0c84a" : "#f7f3ea";
    ctx.fillStyle = color;
    const r = (big ? 5 : 2) + frame * (big ? 3 : 2);
    if (frame < 3) {
      ctx.fillRect(x - r, y, r * 2 + 1, 1);
      ctx.fillRect(x, y - r, 1, r * 2 + 1);
      if (frame > 0) {
        ctx.fillRect(x - r + 1, y - 1, 1, 1);
        ctx.fillRect(x + r - 1, y + 1, 1, 1);
      }
    }
    ctx.fillStyle = fx.side === "long" ? "#3ecf4a" : "#e4453a";
    ctx.fillRect(x - 1, y, 3, 1);
    if (big && frame >= 1) {
      ctx.fillStyle = "#f0c84a";
      ctx.fillRect(x - 2, y - 6, 2, 2);
      ctx.fillRect(x + 3, y - 4, 2, 2);
    }
  }

  private spark(ctx: CanvasRenderingContext2D, fx: Fx): void {
    const x = xt(fx.x);
    const y = Math.round(fx.y);
    ctx.fillStyle = "#f7f3ea";
    ctx.fillRect(x - 2, y, 5, 1);
    ctx.fillRect(x, y - 2, 1, 5);
    ctx.fillStyle = fx.side === "long" ? "#3ecf4a" : "#e4453a";
    ctx.fillRect(x - 1, y - 1, 1, 1);
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }

  private pulse(ctx: CanvasRenderingContext2D, pulse: number): void {
    if (pulse < 0 || pulse > 1) return;
    ctx.fillStyle = "#6a6248";
    ctx.fillRect(xt(pulse), GROUND + 6, 2, 1);
  }

  private banner(ctx: CanvasRenderingContext2D, battle: Battle): void {
    if (!battle.banner) return;
    const text = battle.banner.text;
    const width = textWidth(text, 2);
    const x = Math.round((W - width) / 2);
    const slam = Math.min(1, battle.banner.age / 0.16);
    const eased = 1 - (1 - slam) * (1 - slam);
    const y = Math.round(-20 + eased * 78);
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(x - 8, y - 6, width + 16, 28);
    ctx.fillStyle = battle.banner.side === "long" ? "#3ecf4a" : "#e4453a";
    ctx.fillRect(x - 8, y - 6, width + 16, 2);
    ctx.fillRect(x - 8, y + 20, width + 16, 2);
    drawText(ctx, text, x, y, "#f3ead4", 2);
  }

  private hud(ctx: CanvasRenderingContext2D, battle: Battle): void {
    ctx.fillStyle = "#0c0e14";
    ctx.fillRect(0, 0, W, 16);
    const price = battle.price == null ? "----" : formatPrice(battle.price);
    drawText(ctx, price, 4, 2, "#f3ead4");
    let fund = "FUND ----";
    if (battle.funding != null) {
      const who =
        battle.funding > 0.0000005 ? " L PAY" : battle.funding < -0.0000005 ? " S PAY" : "";
      fund = `FUND ${formatFunding(battle.funding)}${who}`;
    }
    drawText(ctx, fund, 78, 2, "#f0c84a");
    const oi = battle.oiUsd == null ? "OI ----" : `OI ${formatUsd(battle.oiUsd)}`;
    drawText(ctx, oi, 250, 2, "#f3ead4");
    const status = battle.statusText();
    const statusColor =
      battle.link.state === "live"
        ? "#3ecf4a"
        : battle.link.state === "connecting"
          ? "#f0c84a"
          : "#e4453a";
    drawText(ctx, status, W - 4 - textWidth(status), 2, statusColor);
    const total = battle.pressureLong + battle.pressureShort;
    const share = total > 0 ? battle.pressureLong / total : 0.5;
    ctx.fillStyle = "#3ecf4a";
    ctx.fillRect(0, 14, Math.round(W * share), 2);
    ctx.fillStyle = "#e4453a";
    ctx.fillRect(Math.round(W * share), 14, W - Math.round(W * share), 2);
  }

  private footer(ctx: CanvasRenderingContext2D, battle: Battle): void {
    ctx.fillStyle = "#0c0e14";
    ctx.fillRect(0, 248, W, H - 248);
    ctx.fillStyle = "#3a3428";
    ctx.fillRect(0, 248, W, 1);
    const latest = battle.feed[0];
    if (latest) {
      const color = latest.tone === "long" ? "#3ecf4a" : latest.tone === "short" ? "#e4453a" : "#f0c84a";
      drawText(ctx, latest.text, 4, 252, color);
    } else {
      const note = battle.link.state === "live" ? "AWAITING FLOW" : "FIELD EMPTY UNTIL BYBIT CONNECTS";
      drawText(ctx, note, 4, 252, "#8d8678");
    }
    drawText(ctx, "PROXY: FLOW + BOOK + LIQS. NOT POSITIONS.", 4, 261, "#8d8678");
    drawText(ctx, "BURST 5K  ROCKET 25K  BOMB 25K+", 278, 261, "#8d8678");
  }
}
