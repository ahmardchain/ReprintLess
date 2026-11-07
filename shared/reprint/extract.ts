/**
 * Turns PDF.js text items into ReprintLess lines, and a 1pt/px RGBA render
 * into the 12pt colour grid. Pure: callers supply the PDF.js output.
 */
import { colorDistance, rgbToHex } from "./colors";
import { round2 } from "./geometry";
import { ASCENT_RATIO, type FontFamily, type Grid, type Line, type Run } from "./types";

export interface TextItemIn {
  str: string;
  /** Left of the run in page pt (top-left origin). */
  x: number;
  /** Baseline in page pt (top-left origin). */
  baseline: number;
  fontSize: number;
  width: number;
  fontName: string;
  /** CSS-ish family from PDF.js styles ("sans-serif", "serif", "monospace"). */
  cssFamily?: string;
}

export function classifyFont(fontName: string, cssFamily = ""): { family: FontFamily; bold: boolean } {
  const n = `${fontName} ${cssFamily}`.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(fontName.toLowerCase());
  const family: FontFamily = /mono|courier|consol|menlo/.test(n)
    ? "mono"
    : /sans/.test(n) || /helvetica|arial|verdana|inter|roboto/.test(n)
      ? "sans"
      : /serif|times|georgia|garamond|roman|book|minion|cambria/.test(n)
        ? "serif"
        : "sans";
  return { family, bold };
}

/** Groups runs on one baseline into lines; a gap wider than 0.35em starts a new line. */
export function buildLines(items: TextItemIn[], pageIndex: number): Line[] {
  const runs = items
    .filter((i) => i.str.trim().length > 0 && i.fontSize > 0.5)
    .map((i) => ({ ...i, ...classifyFont(i.fontName, i.cssFamily) }))
    .sort((a, b) => a.baseline - b.baseline || a.x - b.x);

  type Building = { runs: (typeof runs)[number][] };
  const groups: Building[] = [];
  for (const r of runs) {
    const g = groups.find((cand) => {
      const last = cand.runs[cand.runs.length - 1]!;
      const sameBase = Math.abs(last.baseline - r.baseline) <= 0.2 * r.fontSize;
      const sameSize = Math.abs(last.fontSize - r.fontSize) <= 0.5;
      const sameStyle = last.bold === r.bold && last.family === r.family;
      const gap = r.x - (last.x + last.width);
      return sameBase && sameSize && sameStyle && gap > -0.5 * r.fontSize && gap <= 0.35 * r.fontSize;
    });
    if (g) g.runs.push(r);
    else groups.push({ runs: [r] });
  }

  return groups.map((g, i) => {
    const first = g.runs[0]!;
    const out: Run[] = [];
    g.runs.forEach((r, k) => {
      const next = g.runs[k + 1];
      let text = r.str;
      if (next) {
        const gap = next.x - (r.x + r.width);
        if (gap > 0.15 * r.fontSize && !/\s$/.test(text) && !/^\s/.test(next.str)) text += " ";
      }
      out.push({ text, x: round2(r.x), w: round2(r.width) });
    });
    const last = g.runs[g.runs.length - 1]!;
    const fontSize = round2(first.fontSize);
    const text = out.map((r) => r.text).join("").replace(/\s+/g, " ");
    // Keep run text and line text aligned: collapse whitespace inside runs too.
    out.forEach((r) => (r.text = r.text.replace(/\s+/g, " ")));
    return {
      id: `p${pageIndex}-l${i}`,
      text,
      x: round2(first.x),
      y: round2(first.baseline - ASCENT_RATIO * first.fontSize),
      w: round2(last.x + last.width - first.x),
      h: fontSize,
      fontSize,
      fontFamily: first.family,
      bold: first.bold,
      color: "#111111",
      runs: out,
      fontName: first.fontName,
    };
  });
}

/** Builds the 12pt grid from an RGBA buffer rendered at 1px per pt. */
export function computeGrid(data: Uint8ClampedArray, width: number, height: number, cell = 12): Grid {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const colors: string[] = [];
  const ink: string[] = [];
  const uniformity: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
      const px: [number, number, number][] = [];
      for (let y = r * cell; y < Math.min(height, (r + 1) * cell); y++) {
        for (let x = c * cell; x < Math.min(width, (c + 1) * cell); x++) {
          const o = (y * width + x) * 4;
          const a = (data[o + 3] ?? 255) / 255;
          // Composite over white so transparent areas read as paper.
          const R = (data[o] ?? 255) * a + 255 * (1 - a);
          const G = (data[o + 1] ?? 255) * a + 255 * (1 - a);
          const B = (data[o + 2] ?? 255) * a + 255 * (1 - a);
          px.push([R, G, B]);
          const key = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4);
          const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          bucket.n++;
          bucket.r += R;
          bucket.g += G;
          bucket.b += B;
          buckets.set(key, bucket);
        }
      }
      let best = { n: 0, r: 255, g: 255, b: 255 };
      for (const b of buckets.values()) if (b.n > best.n) best = b;
      const dom = best.n ? rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n) : "#ffffff";
      // Ink: the most common colour among pixels far from the background.
      // A mode (not a mean) skips anti-aliased glyph edges, which would
      // otherwise wash the colour out towards the paper.
      const inkBuckets = new Map<number, { n: number; r: number; g: number; b: number; d: number }>();
      for (const p of px) {
        const d = colorDistance(rgbToHex(p[0], p[1], p[2]), dom);
        if (d <= 80) continue;
        const key = ((p[0] >> 5) << 6) | ((p[1] >> 5) << 3) | (p[2] >> 5);
        const bucket = inkBuckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, d: 0 };
        bucket.n++;
        bucket.r += p[0];
        bucket.g += p[1];
        bucket.b += p[2];
        bucket.d += d;
        inkBuckets.set(key, bucket);
      }
      let inkBest: { n: number; r: number; g: number; b: number; d: number } | null = null;
      for (const bk of inkBuckets.values()) {
        // Prefer frequent buckets, breaking near-ties towards stronger contrast.
        if (!inkBest || bk.n * (bk.d / bk.n) > inkBest.n * (inkBest.d / inkBest.n)) inkBest = bk;
      }
      colors.push(dom);
      ink.push(inkBest ? rgbToHex(inkBest.r / inkBest.n, inkBest.g / inkBest.n, inkBest.b / inkBest.n) : "");
      uniformity.push(px.length ? round2(best.n / px.length) : 1);
    }
  }
  return { cell, cols, rows, colors, ink, uniformity };
}

/** Ink colour for each line from the grid cells it covers. */
export function colorLines(lines: Line[], grid: Grid): Line[] {
  return lines.map((line) => {
    const c0 = Math.max(0, Math.floor(line.x / grid.cell));
    const c1 = Math.min(grid.cols - 1, Math.floor((line.x + line.w) / grid.cell));
    const r0 = Math.max(0, Math.floor(line.y / grid.cell));
    const r1 = Math.min(grid.rows - 1, Math.floor((line.y + line.h) / grid.cell));
    const counts = new Map<string, number>();
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const k = grid.ink[r * grid.cols + c];
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return best ? { ...line, color: best } : line;
  });
}
