import type { Grid, Rect, Warning } from "./types";

export interface ColorMatch {
  bg: string;
  text: string | null;
  uniform: boolean;
  /** Share of covered cells whose dominant colour is `bg`, 0..1. */
  share: number;
}

function cellsIn(grid: Grid, rect: Rect): number[] {
  const c0 = Math.max(0, Math.floor(rect.x / grid.cell));
  const c1 = Math.min(grid.cols - 1, Math.floor((rect.x + rect.w - 0.01) / grid.cell));
  const r0 = Math.max(0, Math.floor(rect.y / grid.cell));
  const r1 = Math.min(grid.rows - 1, Math.floor((rect.y + rect.h - 0.01) / grid.cell));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * grid.cols + c);
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (x) => x + x) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Readable ink for a background: the darker or lighter extreme. */
export function contrastInk(bg: string): string {
  const [r, g, b] = hexToRgb(bg);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
}

/**
 * Matches the label background and text colour from the page grid.
 * Background: the most common dominant colour in the cells under the rect.
 * Uniform when one colour (within a small distance) covers ≥ 80% of cells.
 */
export function matchColors(grid: Grid | null | undefined, rect: Rect): ColorMatch {
  if (!grid || !grid.colors?.length) {
    return { bg: "#ffffff", text: null, uniform: false, share: 0 };
  }
  const idx = cellsIn(grid, rect);
  if (idx.length === 0) return { bg: "#ffffff", text: null, uniform: false, share: 0 };
  const counts = new Map<string, number>();
  for (const i of idx) {
    const c = grid.colors[i] ?? "#ffffff";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#ffffff";
  let near = 0;
  let uni = 0;
  const inks: [number, number, number][] = [];
  for (const i of idx) {
    if (colorDistance(grid.colors[i] ?? "#ffffff", bg) <= 24) near++;
    uni += grid.uniformity[i] ?? 0;
    const ink = grid.ink[i];
    if (ink && colorDistance(ink, bg) > 60) inks.push(hexToRgb(ink));
  }
  const share = near / idx.length;
  // Text inside the rect lowers per-cell uniformity, so only very busy
  // cells (photos, gradients, patterns) count against a flat background.
  const meanUniformity = uni / idx.length;
  const uniform = share >= 0.8 && meanUniformity >= 0.35;
  let text: string | null = null;
  if (inks.length) {
    const sum = inks.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]);
    text = rgbToHex(sum[0] / inks.length, sum[1] / inks.length, sum[2] / inks.length);
  }
  return { bg, text, uniform, share };
}

export interface LabelColors {
  bgColor: string;
  textColor: string;
  border: boolean;
  warnings: Warning[];
}

/** Final label colours with the non-uniform fallback (white + border). */
export function labelColors(
  grid: Grid | null | undefined,
  rect: Rect,
  lineColor: string | null,
): LabelColors {
  const m = matchColors(grid, rect);
  if (!m.uniform) {
    return {
      bgColor: "#ffffff",
      textColor: lineColor ?? m.text ?? "#111111",
      border: true,
      warnings: [
        {
          code: "bg_unmatched",
          level: "warn",
          message: grid
            ? "The background here isn't a flat colour, so this label is white with a thin border."
            : "No background colour data for this page, so this label is white with a thin border.",
        },
      ],
    };
  }
  let textColor = lineColor ?? m.text ?? contrastInk(m.bg);
  if (colorDistance(textColor, m.bg) < 60) textColor = contrastInk(m.bg);
  return { bgColor: m.bg, textColor, border: false, warnings: [] };
}
