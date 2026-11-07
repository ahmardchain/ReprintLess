import type { Line, Rect } from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function rectRound(r: Rect): Rect {
  return { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function right(r: Rect) {
  return r.x + r.w;
}
export function bottom(r: Rect) {
  return r.y + r.h;
}

/** Intersection rectangle, or null when the two don't overlap. */
export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(right(a), right(b));
  const btm = Math.min(bottom(a), bottom(b));
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

/**
 * True when two rects overlap by more than `tolerance` pt in both
 * directions. The tolerance absorbs hairline contact at shared edges.
 */
export function overlaps(a: Rect, b: Rect, tolerance = 0.75): boolean {
  const i = intersection(a, b);
  return !!i && i.w > tolerance && i.h > tolerance;
}

export function area(r: Rect) {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function contains(outer: Rect, inner: Rect, tolerance = 0.01): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    right(inner) <= right(outer) + tolerance &&
    bottom(inner) <= bottom(outer) + tolerance
  );
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(right(a), right(b)) - x,
    h: Math.max(bottom(a), bottom(b)) - y,
  };
}

export function lineRect(line: Line): Rect {
  return { x: line.x, y: line.y, w: line.w, h: line.h };
}

/**
 * Text that remains visible on the page around a patch target: whole lines
 * that don't touch the target, plus the parts of a touched line left and
 * right of the target (e.g. the "!" after a date in a footer).
 */
export function textObstacles(
  lines: Line[],
  target: Rect,
): { rect: Rect; label: string }[] {
  const out: { rect: Rect; label: string }[] = [];
  for (const line of lines) {
    const lr = lineRect(line);
    const hit = intersection(lr, target);
    // A line counts as "targeted" when the target covers a real part of its height.
    if (!hit || hit.h < line.h * 0.4 || hit.w < 1) {
      out.push({ rect: lr, label: line.text });
      continue;
    }
    const leftW = target.x - line.x;
    if (leftW > 1.5) {
      out.push({
        rect: { x: line.x, y: line.y, w: leftW, h: line.h },
        label: line.text,
      });
    }
    const rightW = right(lr) - right(target);
    if (rightW > 1.5) {
      out.push({
        rect: { x: right(target), y: line.y, w: rightW, h: line.h },
        label: line.text,
      });
    }
  }
  return out;
}
