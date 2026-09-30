export interface Palette {
  h: string;
  d: string;
  w: string;
  n: string;
}

export const LONG_PALETTE: Palette = {
  h: "#3ecf4a",
  d: "#145c22",
  w: "#f4fff0",
  n: "#0c3a14",
};

export const SHORT_PALETTE: Palette = {
  h: "#e4453a",
  d: "#6e1612",
  w: "#fff4f0",
  n: "#3a0c0a",
};

export const BULL = [
  "h....h..",
  "hh..hh..",
  ".hhhhh..",
  "hhwwwhh.",
  ".hhhhhh.",
  "..hhhh..",
  "..h..h..",
  "..h..h..",
];

export const BEAR = [
  ".hh..hh.",
  "hhhhhhhh",
  "hhwwwwhh",
  ".hhhhnh.",
  "..hhhh..",
  "..h..h..",
  "..h..h..",
  "........",
];

export const TANK = [
  "........dddd....",
  "......ddhhhhdd..",
  "....ddhhhhhhhhdd",
  "ddddhhhhhhhhhhhh",
  "ddhhhhhhhhhhhhdd",
  "dddddddddddddddd",
  ".dd..dd....dd..d",
  ".dd..dd....dd..d",
];

export const ROCKET = [
  "..........d.",
  ".........dd.",
  "........dh..",
  "......ddhh..",
  "....ddhhhh..",
  "dddhhhhhhhdd",
  "dddddddddddd",
  ".dd......dd.",
  ".dd......dd.",
];

export const BULL_STEP = [
  "h....h..",
  "hh..hh..",
  ".hhhhh..",
  "hhwwwhh.",
  ".hhhhhh.",
  "..hhhh..",
  ".h....h.",
  "h......h",
];

export const BEAR_STEP = [
  ".hh..hh.",
  "hhhhhhhh",
  "hhwwwwhh",
  ".hhhhnh.",
  "..hhhh..",
  ".h....h.",
  "h......h",
  "........",
];

export const TANK_STEP = [
  "........dddd....",
  "......ddhhhhdd..",
  "....ddhhhhhhhhdd",
  "ddddhhhhhhhhhhhh",
  "ddhhhhhhhhhhhhdd",
  "dddddddddddddddd",
  "dd..dd....dd..dd",
  "dd..dd....dd..dd",
];

export const ROCKET_FIRE = [
  ".........d..",
  "........dd..",
  ".......dh...",
  ".....ddhh...",
  "...ddhhhh...",
  "ddhhhhhhdd..",
  "dddddddddd..",
  ".dd....dd...",
  ".dd....dd...",
];

export const BULL_CHEER = [
  "h.h..h.h",
  "h.h..h.h",
  ".hhhhh..",
  "hhwwwhh.",
  ".hhhhhh.",
  "..hhhh..",
  "..h..h..",
  "..h..h..",
];

export const BEAR_CHEER = [
  "h.hh.hh.",
  "hhhhhhhh",
  "hhwwwwhh",
  ".hhhhnh.",
  "..hhhh..",
  "..h..h..",
  "..h..h..",
  "........",
];

export const PLANE = [
  "....hh....",
  "..hhhhhh..",
  "hhhhhhhhhh",
  "..hhddhh..",
  "....dd....",
];

export function blit(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  palette: Palette,
  flip: boolean,
): void {
  const width = rows[0]?.length ?? 0;
  const left = Math.round(x);
  const top = Math.round(y);
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] ?? "";
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col];
      if (!ch || ch === ".") continue;
      const color = palette[ch as keyof Palette];
      if (!color) continue;
      const px = flip ? left + (width - 1 - col) : left + col;
      ctx.fillStyle = color;
      ctx.fillRect(px, top + row, 1, 1);
    }
  }
}
