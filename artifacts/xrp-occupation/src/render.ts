import type { Battle, Unit } from "./battle";
import { clamp, formatPrice } from "./format";

interface Streak {
  x: number;
  y: number;
  v: number;
  len: number;
}

function brightness(leverage: number | null): number {
  if (leverage == null || !(leverage > 0)) return 0.55;
  return clamp(0.3 + (Math.log2(leverage) / Math.log2(125)) * 0.7, 0.3, 1);
}

function unitRadius(unit: Unit): number {
  const mass = Math.max(unit.health, unit.state === "dying" ? unit.notional * 0.15 : 0);
  const t = Math.log10(Math.max(mass, 20));
  const base = 5 + t * 3.1;
  if (unit.state === "dying") return base * clamp(unit.die / 0.45, 0, 1);
  return base;
}

function makeGlow(rgb: string): HTMLCanvasElement {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgb);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function makeGrain(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(160, 160);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 180 + Math.random() * 75;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 36;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export class FieldView {
  private ctx: CanvasRenderingContext2D;
  private stain: HTMLCanvasElement;
  private stainCtx: CanvasRenderingContext2D;
  private grain = makeGrain();
  private longGlow = makeGlow("rgba(62, 224, 197, 0.9)");
  private shortGlow = makeGlow("rgba(255, 91, 61, 0.9)");
  private streaks: Streak[] = Array.from({ length: 46 }, () => ({
    x: Math.random(),
    y: Math.random(),
    v: 0.45 + Math.random() * 1.1,
    len: 0.55 + Math.random() * 1.5,
  }));
  private time = 0;
  private cssW = 1;
  private cssH = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas is not available");
    this.ctx = ctx;
    this.stain = document.createElement("canvas");
    const stainCtx = this.stain.getContext("2d");
    if (!stainCtx) throw new Error("Stain buffer is not available");
    this.stainCtx = stainCtx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.canvas.width = Math.floor(this.cssW * dpr);
    this.canvas.height = Math.floor(this.cssH * dpr);
    this.stain.width = this.canvas.width;
    this.stain.height = this.canvas.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.stainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(battle: Battle, dt: number): void {
    this.time += dt;
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    const shake = battle.punch;
    const sx = (Math.random() - 0.5) * shake * 22;
    const sy = (Math.random() - 0.5) * shake * 14;

    ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.paintBackdrop(w, h, battle);
    ctx.save();
    ctx.translate(sx, sy);
    this.paintStain(battle, dt, w, h);
    ctx.drawImage(this.stain, 0, 0, this.stain.width, this.stain.height, 0, 0, w, h);
    this.paintWind(battle, dt, w, h);
    this.paintUnits(battle, w, h);
    this.paintParticles(battle, w, h);
    this.paintShocks(battle, w, h);
    this.paintPulses(battle, w, h);
    this.paintFront(battle, w, h);
    ctx.restore();
    this.paintVignette(w, h, battle);
  }

  private paintBackdrop(w: number, h: number, battle: Battle): void {
    const ctx = this.ctx;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#05060a");
    sky.addColorStop(0.45, "#0b1018");
    sky.addColorStop(1, "#05060a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const fx = battle.frontX * w;
    const left = ctx.createLinearGradient(0, 0, Math.max(fx, 1), 0);
    left.addColorStop(0, "rgba(18, 92, 82, 0.28)");
    left.addColorStop(1, "rgba(18, 92, 82, 0)");
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, fx, h);
    const right = ctx.createLinearGradient(fx, 0, w, 0);
    right.addColorStop(0, "rgba(92, 28, 18, 0)");
    right.addColorStop(1, "rgba(120, 36, 22, 0.3)");
    ctx.fillStyle = right;
    ctx.fillRect(fx, 0, w - fx, h);

    ctx.save();
    ctx.globalAlpha = 0.055 + battle.thump * 0.08;
    ctx.strokeStyle = "#d5deee";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gap = 56;
    for (let x = gap; x < w; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = gap; y < h; y += gap) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = "#d7fff4";
    ctx.font = "600 92px Inter, 'Liberation Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LONG", w * 0.22, h * 0.46);
    ctx.fillStyle = "#ffd4cc";
    ctx.fillText("SHORT", w * 0.78, h * 0.46);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.22;
    const pattern = ctx.createPattern(this.grain, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  private paintStain(battle: Battle, dt: number, w: number, h: number): void {
    const ctx = this.stainCtx;
    ctx.save();
    ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.globalAlpha = 1;
    const keep = Math.exp(-dt / 1.4);
    ctx.fillStyle = `rgba(0,0,0,${keep})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    for (const unit of battle.units) {
      if (unit.state === "dead") continue;
      const fade = unit.state === "dying" ? clamp(unit.die / 0.45, 0, 1) : 1;
      const alpha = fade * brightness(unit.leverage) * 0.22;
      if (alpha <= 0.01) continue;
      const sprite = unit.side === "long" ? this.longGlow : this.shortGlow;
      const rad = unitRadius(unit) * 3.4;
      const x = unit.x * w;
      const y = unit.y * h;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  private paintWind(battle: Battle, dt: number, w: number, h: number): void {
    const mag = Math.abs(battle.wind);
    if (mag < 0.03) return;
    const ctx = this.ctx;
    const dir = battle.wind > 0 ? -1 : 1;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle =
      battle.wind > 0 ? "rgba(186, 214, 232, 0.85)" : "rgba(232, 196, 180, 0.85)";
    for (const streak of this.streaks) {
      streak.x += dir * (0.05 + mag * 0.42) * streak.v * dt;
      if (streak.x < -0.15) streak.x = 1.12;
      if (streak.x > 1.15) streak.x = -0.12;
      const head = streak.x * w;
      const tail = head - dir * (28 + mag * 90) * streak.len;
      const y = streak.y * h;
      ctx.globalAlpha = 0.08 + mag * 0.45;
      ctx.beginPath();
      ctx.moveTo(tail, y);
      ctx.lineTo(head, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintUnits(battle: Battle, w: number, h: number): void {
    const ctx = this.ctx;
    for (const unit of battle.units) {
      if (unit.state === "dead") continue;
      const fade = unit.state === "dying" ? clamp(unit.die / 0.45, 0, 1) : 1;
      const bright = brightness(unit.leverage) * fade;
      const r = unitRadius(unit);
      const bob = unit.state === "march" ? Math.sin(unit.phase) * 2.2 : 0;
      const x = unit.x * w;
      const y = unit.y * h + bob;
      const sprite = unit.side === "long" ? this.longGlow : this.shortGlow;
      ctx.save();
      ctx.globalAlpha = 0.35 + bright * 0.55;
      ctx.drawImage(sprite, x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
      ctx.translate(x, y);
      if (unit.side === "short") ctx.scale(-1, 1);
      ctx.globalAlpha = 0.45 + bright * 0.55;
      ctx.fillStyle = unit.side === "long" ? "#e9fff9" : "#fff1ec";
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.85, r * 0.62);
      ctx.lineTo(-r * 0.32, 0);
      ctx.lineTo(-r * 0.85, -r * 0.62);
      ctx.closePath();
      ctx.fill();
      if (r > 13) {
        ctx.globalAlpha = 0.35 + bright * 0.4;
        ctx.strokeStyle = unit.side === "long" ? "#3ee0c5" : "#ff5b3d";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-r * 0.15, r * 0.42);
        ctx.lineTo(r * 0.45, 0);
        ctx.lineTo(-r * 0.15, -r * 0.42);
        ctx.stroke();
      }
      if (unit.state === "hold") {
        ctx.globalAlpha = 0.7 * bright;
        ctx.strokeStyle = unit.side === "long" ? "#9ff7ea" : "#ffb2a4";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, r * 0.9);
        ctx.lineTo(r * 0.7, r * 0.9);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private paintParticles(battle: Battle, w: number, h: number): void {
    const ctx = this.ctx;
    for (const particle of battle.particles) {
      const alpha = particle.max > 0 ? particle.life / particle.max : 0;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${particle.r}, ${particle.g}, ${particle.b})`;
      ctx.fillRect(particle.x * w, particle.y * h, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }

  private paintShocks(battle: Battle, w: number, h: number): void {
    const ctx = this.ctx;
    const scale = Math.min(w, h);
    for (const shock of battle.shocks) {
      const alpha = shock.maxLife > 0 ? shock.life / shock.maxLife : 0;
      ctx.beginPath();
      ctx.arc(shock.x * w, shock.y * h, Math.max(1, shock.r * scale), 0, Math.PI * 2);
      ctx.strokeStyle =
        shock.side === "long"
          ? `rgba(210, 255, 246, ${alpha})`
          : `rgba(255, 214, 204, ${alpha})`;
      ctx.lineWidth = 2 + alpha * 3;
      ctx.stroke();
    }
  }

  private paintPulses(battle: Battle, w: number, h: number): void {
    const ctx = this.ctx;
    for (const pulse of battle.pulses) {
      const x = pulse.x * w;
      const band = ctx.createLinearGradient(x - 90, 0, x + 90, 0);
      band.addColorStop(0, "rgba(240, 226, 192, 0)");
      band.addColorStop(0.5, "rgba(240, 226, 192, 0.22)");
      band.addColorStop(1, "rgba(240, 226, 192, 0)");
      ctx.fillStyle = band;
      ctx.fillRect(x - 90, 0, 180, h);
      ctx.strokeStyle = "rgba(255, 248, 236, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }

  private paintFront(battle: Battle, w: number, h: number): void {
    const ctx = this.ctx;
    const fx = battle.frontX * w;
    const glow = ctx.createLinearGradient(fx - 36, 0, fx + 36, 0);
    glow.addColorStop(0, "rgba(255, 244, 220, 0)");
    glow.addColorStop(0.5, "rgba(255, 244, 220, 0.34)");
    glow.addColorStop(1, "rgba(255, 244, 220, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(fx - 36, 0, 72, h);

    ctx.beginPath();
    for (let y = 0; y <= h; y += 7) {
      const j = Math.sin(y * 0.035 + this.time * 1.4) * 1.5 + Math.sin(y * 0.12) * 0.7;
      if (y === 0) ctx.moveTo(fx + j, y);
      else ctx.lineTo(fx + j, y);
    }
    ctx.strokeStyle = "rgba(255, 250, 242, 0.95)";
    ctx.lineWidth = 1.7;
    ctx.stroke();

    const label = battle.price == null ? "AWAITING MARK" : `$${formatPrice(battle.price)}`;
    ctx.font = "600 16px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    const bw = tw + 22;
    const bh = 36;
    let bx = fx - bw / 2;
    bx = clamp(bx, 16, w - bw - 16);
    const by = h * 0.34;
    ctx.fillStyle = "rgba(6, 7, 10, 0.82)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(235, 230, 220, 0.78)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = "#f4efe6";
    ctx.fillText(label, bx + bw / 2, by + 15);
    ctx.font = "500 9px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "#b7b1a6";
    ctx.fillText("MARK", bx + bw / 2, by + 28);
  }

  private paintVignette(w: number, h: number, battle: Battle): void {
    const ctx = this.ctx;
    const vignette = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.28,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    if (battle.punch > 0.02) {
      ctx.fillStyle = `rgba(255, 244, 230, ${battle.punch * 0.28})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (battle.thump > 0.02) {
      ctx.fillStyle = `rgba(255, 244, 220, ${battle.thump * 0.08})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
