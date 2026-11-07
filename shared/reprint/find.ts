import { round2 } from "./geometry";
import type { Line, Measure, Rect } from "./types";

export interface TextMatch {
  page: number;
  lineId: string;
  lineText: string;
  text: string;
  start: number;
  end: number;
  bbox: Rect;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * x position (pt) of a character offset in a line. Offsets inside a run are
 * placed proportionally to the measured advance, scaled to the run's real
 * printed width, so a substituted font still lands on the printed glyphs.
 * `side` picks the run that ends at the offset ("end") or starts at it.
 */
export function charX(
  line: Line,
  offset: number,
  measure: Measure,
  side: "start" | "end",
): number {
  let pos = 0;
  for (let i = 0; i < line.runs.length; i++) {
    const run = line.runs[i];
    const len = run.text.length;
    const inside = side === "end" ? offset > pos && offset <= pos + len : offset >= pos && offset < pos + len;
    if (inside) {
      const printed = run.text.replace(/\s+$/, "");
      const local = Math.min(offset - pos, printed.length);
      const full = measure(printed, line.fontFamily, line.bold, line.fontSize);
      if (full <= 0) return run.x;
      const part = measure(printed.slice(0, local), line.fontFamily, line.bold, line.fontSize);
      return run.x + run.w * (part / full);
    }
    pos += len;
  }
  return side === "end" ? line.x + line.w : line.x;
}

export function subLineRect(
  line: Line,
  start: number,
  end: number,
  measure: Measure,
): Rect {
  if (line.runs.length === 0) return { x: line.x, y: line.y, w: line.w, h: line.h };
  const x0 = charX(line, start, measure, "start");
  const x1 = charX(line, end, measure, "end");
  return {
    x: round2(x0),
    y: round2(line.y),
    w: round2(Math.max(1, x1 - x0)),
    h: round2(line.h),
  };
}

/** Case-insensitive, whitespace-tolerant search over the page lines. */
export function findText(
  pages: { lines: Line[] }[],
  query: string,
  measure: Measure,
  onlyPage?: number,
): TextMatch[] {
  const q = query.trim();
  if (!q) return [];
  const re = new RegExp(escapeRegex(q).replace(/\s+/g, "\\s+"), "gi");
  const out: TextMatch[] = [];
  pages.forEach((page, pageIndex) => {
    if (onlyPage !== undefined && onlyPage !== pageIndex) return;
    for (const line of page.lines) {
      for (const m of line.text.matchAll(re)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        out.push({
          page: pageIndex,
          lineId: line.id,
          lineText: line.text,
          text: m[0],
          start,
          end,
          bbox: subLineRect(line, start, end, measure),
        });
      }
    }
  });
  return out;
}

/** Lines that the rect covers for at least 40% of their height. */
export function linesUnder(lines: Line[], rect: Rect): Line[] {
  return lines.filter((l) => {
    const x = Math.max(l.x, rect.x);
    const y = Math.max(l.y, rect.y);
    const r = Math.min(l.x + l.w, rect.x + rect.w);
    const b = Math.min(l.y + l.h, rect.y + rect.h);
    return r - x > 1 && b - y >= l.h * 0.4;
  });
}

/** The text of `line` under the rect's horizontal span (approximate). */
export function textUnder(line: Line, rect: Rect, measure: Measure): string {
  const text = line.text;
  let start = 0;
  let end = text.length;
  for (let i = 0; i <= text.length; i++) {
    if (charX(line, i, measure, "start") + 0.5 < rect.x) start = i + 1;
  }
  for (let i = text.length; i >= 0; i--) {
    if (charX(line, i, measure, "end") - 0.5 > rect.x + rect.w) end = i - 1;
  }
  start = Math.min(start, text.length);
  end = Math.max(end, start);
  return text.slice(start, end).trim();
}
