import type { Battle, Bit, BookColumn, Strike, Unit } from "./battle";
import { formatFunding, formatPrice, formatUsd } from "./format";
import { drawText, textWidth } from "./font";
import {
  BEAR,
  BULL,
  LONG_PALETTE,
  ROCKET,
  SHORT_PALETTE,
  TANK,
  blit,
  type Palette,
} from "./sprites";

const W = 480;
const H = 270;

function xt(t: number): number {
  return Math.round(48 + t * (432 - 48));
}

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function toneColor(tone: Bit["tone"]): string {
  if (tone === "long") return "#3ecf4a";
  if (tone === "short") return "#e4453a";
  if (tone === "gold") return "#f0c84a";
  return "#f3ead4";
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
    const mag = battle.shake > 0.25 ? 2 : battle.shake > 0.04 ? 1 : 0;
    const phase = Math.floor(this.time * 30);
    const ox = mag === 0 ? 0 : (phase % 2 === 0 ? mag : -mag);
    const oy = mag > 1 && phase % 3 === 0 ? 1 : 0;
    ctx.save();
    ctx.translate(ox, oy);
    this.sky(ctx);
    this.zones(ctx, battle);
    this.ground(ctx);
    this.ranks(ctx, battle.columns);
    this.units(ctx, battle.units);
    this.strikes(ctx, battle.strikes);
    this.bits(ctx, battle.bits);
    this.pulse(ctx, battle.pulse);
    this.front(ctx, battle);
    ctx.restore();
    this.hud(ctx, battle);
    this.panel(ctx, battle);
    this.banner(ctx, battle);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = "#05060a";
    this.ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.ctx.drawImage(this.buf, 0, 0, this.cssW, this.cssH);
  }

  private sky(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#10141f";
    ctx.fillRect(0, 36, W, 70);
    ctx.fillStyle = "#171d2c";
    ctx.fillRect(0, 106, W, 62);
    for (let i = 0; i < 26; i += 1) {
      const x = (hash(i * 17) % 450) + 12;
      const y = (hash(i * 29) % 100) + 42;
      ctx.fillStyle = i % 5 === 0 ? "#d5dbed" : "#3c4662";
      ctx.fillRect(x, y, 1, 1);
    }
  }

  private zones(ctx: CanvasRenderingContext2D, battle: Battle): void {
    const front = battle.frontT();
    ctx.fillStyle = front < 0.08 ? "#1e3a28" : "#122018";
    ctx.fillRect(8, 40, 40, 128);
    ctx.fillStyle = front > 0.92 ? "#4a201c" : "#241212";
    ctx.fillRect(432, 40, 40, 128);
    drawText(ctx, "LONGS", 10, 48, "#3ecf4a");
    drawText(ctx, "WIN", 16, 58, "#3ecf4a");
    const shorts = "SHORTS";
    drawText(ctx, shorts, 470 - textWidth(shorts), 48, "#e4453a");
    drawText(ctx, "WIN", 452, 58, "#e4453a");
    if (battle.round) {
      const high = formatPrice(battle.round.high);
      const low = formatPrice(battle.round.low);
      drawText(ctx, high, 8, 180, "#8d8678");
      drawText(ctx, low, 472 - textWidth(low), 180, "#8d8678");
    }
  }

  private ground(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#1c140e";
    ctx.fillRect(0, 168, W, 30);
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(0, 168, W, 1);
    for (let x = 4; x < W; x += 5) {
      const y = 172 + (hash(x) % 18);
      if ((hash(x + 3) & 3) === 0) {
        ctx.fillStyle = "#2c1e14";
        ctx.fillRect(x, y, 2, 1);
      }
    }
  }

  private ranks(ctx: CanvasRenderingContext2D, columns: readonly BookColumn[]): void {
    for (const column of columns) {
      const count = 1 + Math.round(column.weight * 6);
      const x = xt(column.t) - 1;
      const wall = column.weight > 0.82;
      ctx.fillStyle =
        column.side === "long" ? (wall ? "#9dff96" : "#1f7a32") : wall ? "#ffb0a4" : "#9a2a24";
      for (let i = 0; i < count; i += 1) {
        ctx.fillRect(x, 164 - i * 4, 3, 3);
      }
    }
  }

  private units(ctx: CanvasRenderingContext2D, units: readonly Unit[]): void {
    const ordered = [...units].sort((a, b) => a.lane - b.lane);
    for (const unit of ordered) {
      if (unit.state === "dying" && unit.die < 0.08) continue;
      const rows = unit.kind === "tank" ? TANK : unit.kind === "artillery" ? ROCKET : unit.side === "long" ? BULL : BEAR;
      const base = unit.side === "long" ? LONG_PALETTE : SHORT_PALETTE;
      const palette: Palette =
        unit.flash > 0.08
          ? { h: "#f7f3ea", d: base.d, w: "#ffffff", n: base.n }
          : base;
      const flip = unit.side === "short";
      const height = rows.length;
      const y = 176 - height - Math.round(unit.lane * 5);
      blit(ctx, rows, xt(unit.x) - Math.floor((rows[0]?.length ?? 0) / 2), y, palette, flip);
    }
  }

  private strikes(ctx: CanvasRenderingContext2D, strikes: readonly Strike[]): void {
    for (const strike of strikes) {
      const k = strike.max > 0 ? strike.life / strike.max : 0;
      const radius = (strike.tier === "bomb" ? 16 : strike.tier === "strike" ? 9 : 4) * (0.45 + k);
      const x = xt(strike.x);
      const y = 158;
      this.ring(ctx, x, y, radius, strike.tier === "burst" ? "#f0c84a" : "#f7f3ea");
      if (strike.tier !== "burst") {
        this.ring(ctx, x, y, Math.max(2, radius * 0.45), strike.side === "long" ? "#3ecf4a" : "#e4453a");
      }
      if (strike.tier === "bomb") this.ring(ctx, x, y - 6, radius * 0.7, "#f0c84a");
    }
  }

  private ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
    const r = Math.max(1, Math.round(radius));
    ctx.fillStyle = color;
    for (let iy = -r; iy <= r; iy += 1) {
      for (let ix = -r; ix <= r; ix += 1) {
        const d2 = ix * ix + iy * iy;
        if (d2 <= r * r && d2 >= (r - 1) * (r - 1)) ctx.fillRect(x + ix, y + iy, 1, 1);
      }
    }
  }

  private bits(ctx: CanvasRenderingContext2D, bits: readonly Bit[]): void {
    for (const bit of bits) {
      ctx.fillStyle = toneColor(bit.tone);
      ctx.fillRect(xt(bit.x), Math.round(bit.y * H), 2, 2);
    }
  }

  private pulse(ctx: CanvasRenderingContext2D, pulse: number): void {
    if (pulse < 0 || pulse > 1) return;
    ctx.fillStyle = "#6a6248";
    ctx.fillRect(xt(pulse), 174, 2, 1);
  }

  private front(ctx: CanvasRenderingContext2D, battle: Battle): void {
    const x = xt(battle.frontT());
    ctx.fillStyle = "#1a120c";
    ctx.fillRect(x - 1, 78, 3, 90);
    ctx.fillStyle = "#f3ead4";
    ctx.fillRect(x, 78, 1, 90);
    ctx.fillStyle = "#f0c84a";
    ctx.fillRect(x - 2, 78, 5, 3);
    const label = battle.price == null ? "----" : formatPrice(battle.price);
    const width = textWidth(label, 2);
    let lx = x - Math.round(width / 2);
    lx = Math.max(52, Math.min(lx, 428 - width));
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(lx - 3, 60, width + 6, 16);
    drawText(ctx, label, lx, 62, "#f3ead4", 2);
    if (battle.round) {
      for (const mark of [0, 0.25, 0.5, 0.75, 1]) {
        const mx = xt(mark);
        ctx.fillStyle = "#8d8678";
        ctx.fillRect(mx, 166, 1, 4);
      }
    }
  }

  private hud(ctx: CanvasRenderingContext2D, battle: Battle): void {
    ctx.fillStyle = "#0c0e14";
    ctx.fillRect(0, 0, W, 36);
    ctx.fillStyle = "#3a3428";
    ctx.fillRect(0, 35, W, 1);
    drawText(ctx, "OCCUPATION", 6, 4, "#f3ead4");
    const status = battle.statusText();
    const statusColor =
      battle.link.state === "live"
        ? "#3ecf4a"
        : battle.link.state === "connecting"
          ? "#f0c84a"
          : "#e4453a";
    drawText(ctx, status, W - 6 - textWidth(status), 4, statusColor);
    const price = battle.price == null ? "PRICE ----" : `PRICE ${formatPrice(battle.price)}`;
    drawText(ctx, price, 6, 14, "#f3ead4");
    let fund = "FUND ----";
    if (battle.funding != null) {
      const who =
        battle.funding > 0.0000005 ? " LONGS PAY" : battle.funding < -0.0000005 ? " SHORTS PAY" : "";
      fund = `FUND ${formatFunding(battle.funding)}${who}`;
    }
    drawText(ctx, fund, 132, 14, "#f0c84a");
    const oi = battle.oiUsd == null ? "OI ----" : `OI ${formatUsd(battle.oiUsd)}`;
    drawText(ctx, oi, 330, 14, "#f3ead4");
    const longText = battle.sawFlow ? formatUsd(battle.pressureLong) : "----";
    const shortText = battle.sawFlow ? formatUsd(battle.pressureShort) : "----";
    drawText(ctx, longText, 6, 24, "#3ecf4a");
    drawText(ctx, shortText, W - 6 - textWidth(shortText), 24, "#e4453a");
    const barX = 78;
    const barW = 324;
    const total = battle.pressureLong + battle.pressureShort;
    const share = total > 0 ? battle.pressureLong / total : 0.5;
    ctx.fillStyle = "#241812";
    ctx.fillRect(barX, 26, barW, 5);
    ctx.fillStyle = "#3ecf4a";
    ctx.fillRect(barX, 26, Math.round(barW * share), 5);
    ctx.fillStyle = "#e4453a";
    ctx.fillRect(barX + Math.round(barW * share), 26, barW - Math.round(barW * share), 5);
  }

  private panel(ctx: CanvasRenderingContext2D, battle: Battle): void {
    ctx.fillStyle = "#0c0e14";
    ctx.fillRect(0, 198, W, H - 198);
    ctx.fillStyle = "#3a3428";
    ctx.fillRect(0, 198, W, 1);
    drawText(ctx, "FEED", 6, 202, "#8d8678");
    if (!battle.sawFlow && battle.units.length === 0) {
      const note =
        battle.link.state === "live"
          ? "AWAITING FLOW"
          : "FIELD EMPTY UNTIL BYBIT CONNECTS";
      drawText(ctx, note, 42, 202, "#f3ead4");
    }
    battle.feed.forEach((line, index) => {
      const color = line.tone === "long" ? "#3ecf4a" : line.tone === "short" ? "#e4453a" : "#f0c84a";
      drawText(ctx, line.text, 6, 212 + index * 8, color);
    });
    drawText(ctx, "INF FLOW   TANK HEAVY   ROCKET VOL/LIQ", 6, 246, "#8d8678");
    drawText(ctx, "LONGS", 292, 246, "#3ecf4a");
    drawText(ctx, "SHORTS", 470 - textWidth("SHORTS"), 246, "#e4453a");
    drawText(ctx, "BURST UNDER 5K   STRIKE UNDER 25K   BOMB OVER 25K", 6, 254, "#8d8678");
    drawText(
      ctx,
      "VISUAL PROXY: FLOW + BOOK DEPTH + LIQUIDATIONS. NOT ACCOUNT POSITIONS.",
      6,
      262,
      "#f3ead4",
    );
  }

  private banner(ctx: CanvasRenderingContext2D, battle: Battle): void {
    if (!battle.banner) return;
    const text = battle.banner.text;
    const width = textWidth(text, 2);
    const x = Math.round((W - width) / 2);
    const y = 86;
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(x - 8, y - 6, width + 16, 28);
    ctx.fillStyle = battle.banner.side === "long" ? "#3ecf4a" : "#e4453a";
    ctx.fillRect(x - 8, y - 6, width + 16, 2);
    ctx.fillRect(x - 8, y + 20, width + 16, 2);
    drawText(ctx, text, x, y, "#f3ead4", 2);
  }
}
