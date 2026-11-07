import { contains, intersection, overlaps, round2, textObstacles } from "./geometry";
import {
  LINE_HEIGHT,
  MIN_FONT_SIZE,
  PAD_X,
  PAD_Y,
  type Align,
  type FontFamily,
  type Line,
  type LockGeometry,
  type Measure,
  type PatchGeometry,
  type PatchLayout,
  type PatchStatus,
  type Rect,
  type Warning,
} from "./types";

export interface LayoutResult {
  layout: PatchLayout;
  /** True when every line fits inside the rect at this size. */
  fits: boolean;
  /** Widest laid-out line, pt. */
  maxWidth: number;
  /** Height the lines need including padding, pt. */
  neededHeight: number;
}

/** Greedy word wrap of `text` into lines no wider than `maxW`. */
export function wrapWords(
  text: string,
  maxW: number,
  width: (s: string) => number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = words[0];
  for (const word of words.slice(1)) {
    const next = `${cur} ${word}`;
    if (width(next) <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * Lays `text` out inside `rect` at `fontSize`: one line when it fits,
 * otherwise word-wrapped into as many lines as the rect height allows.
 * Lines are vertically centred in the rect.
 */
export function layoutText(
  text: string,
  rect: Rect,
  fontSize: number,
  family: FontFamily,
  bold: boolean,
  align: Align,
  measure: Measure,
  maxLines = 3,
): LayoutResult {
  const width = (s: string) => measure(s, family, bold, fontSize);
  const innerW = rect.w - 2 * PAD_X;
  const lineH = fontSize * LINE_HEIGHT;
  const single = width(text);
  let lines = [text];
  if (single > innerW) {
    const capacity = Math.max(
      1,
      Math.min(maxLines, Math.floor((rect.h - 2 * PAD_Y) / lineH + 0.02)),
    );
    if (capacity > 1) {
      const wrapped = wrapWords(text, innerW, width);
      if (wrapped.length <= capacity) lines = wrapped;
    }
  }
  const widths = lines.map(width);
  const maxWidth = Math.max(...widths);
  // Visual block: cap-height-ish ascent above the first baseline and a
  // small descent below the last.
  const blockH = fontSize * 0.95 + (lines.length - 1) * lineH;
  const neededHeight = blockH + 2 * PAD_Y;
  const top = (rect.h - blockH) / 2;
  const laid = lines.map((t, i) => {
    const w = widths[i];
    const x =
      align === "right"
        ? rect.w - PAD_X - w
        : align === "center"
          ? (rect.w - w) / 2
          : PAD_X;
    return {
      text: t,
      x: round2(x),
      baseline: round2(top + fontSize * 0.74 + i * lineH),
      w: round2(w),
    };
  });
  const fits = maxWidth <= innerW + 0.01 && neededHeight <= rect.h + 0.01;
  return {
    layout: { lines: laid, fontSize: round2(fontSize) },
    fits,
    maxWidth,
    neededHeight,
  };
}

export interface FitContext {
  /** All text lines on the page. */
  lines: Line[];
  locks: LockGeometry[];
  /** Other patches on the same page. */
  patches: Pick<PatchGeometry, "id" | "rect">[];
  page: { width: number; height: number };
  measure: Measure;
  /** Extra context-derived warnings (background, font substitution). */
  extraWarnings?: Warning[];
}

export interface FitResult {
  status: PatchStatus;
  warnings: Warning[];
  layout: PatchLayout;
  fits: boolean;
}

export interface Collision {
  kind: "lock" | "text" | "patch" | "page";
  rect: Rect;
  label: string;
  id?: string;
}

/** Everything `rect` would cover that it must not. */
export function collisions(
  rect: Rect,
  target: Rect,
  patchId: string,
  ctx: Omit<FitContext, "measure">,
): Collision[] {
  const out: Collision[] = [];
  if (!contains({ x: 0, y: 0, w: ctx.page.width, h: ctx.page.height }, rect, 0.5)) {
    out.push({ kind: "page", rect, label: "page edge" });
  }
  for (const lock of ctx.locks) {
    if (overlaps(rect, lock.rect))
      out.push({ kind: "lock", rect: lock.rect, label: lock.label || "locked area", id: lock.id });
  }
  for (const ob of textObstacles(ctx.lines, target)) {
    if (overlaps(rect, ob.rect))
      out.push({ kind: "text", rect: ob.rect, label: ob.label });
  }
  for (const p of ctx.patches) {
    if (p.id !== patchId && overlaps(rect, p.rect))
      out.push({ kind: "patch", rect: p.rect, label: "another label", id: p.id });
  }
  return out;
}

function quote(s: string, max = 32) {
  const t = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  return `"${t}"`;
}

export function describeCollision(c: Collision): string {
  switch (c.kind) {
    case "lock":
      return `Covers the locked area ${quote(c.label)}.`;
    case "text":
      return `Covers printed text ${quote(c.label)}.`;
    case "patch":
      return "Overlaps another label.";
    case "page":
      return "Runs off the edge of the page.";
  }
}

/** The single fit check used by every patch write. */
export function checkFit(patch: PatchGeometry, ctx: FitContext): FitResult {
  const { rect } = patch;
  const result = layoutText(
    patch.newText,
    rect,
    patch.fontSize,
    patch.fontFamily,
    patch.bold,
    patch.align,
    ctx.measure,
  );
  const warnings: Warning[] = [];

  if (!result.fits) {
    const atMin = layoutText(
      patch.newText,
      rect,
      MIN_FONT_SIZE,
      patch.fontFamily,
      patch.bold,
      patch.align,
      ctx.measure,
    );
    warnings.push({
      code: atMin.fits ? "overflow" : "no_fit_at_min",
      level: "error",
      message: atMin.fits
        ? `Text doesn't fit at ${round2(patch.fontSize)}pt; it needs ${round2(result.maxWidth + 2 * PAD_X)}pt of width.`
        : `Text doesn't fit even at ${MIN_FONT_SIZE}pt; make the label bigger.`,
    });
  }

  for (const c of collisions(rect, patch.target, patch.id, ctx)) {
    warnings.push({ code: `covers_${c.kind}`, level: "error", message: describeCollision(c) });
  }

  if (!intersection(rect, patch.target)) {
    warnings.push({
      code: "misses_target",
      level: "error",
      message: "The label no longer covers the mistake.",
    });
  } else if (!contains(rect, patch.target, 0.5)) {
    warnings.push({
      code: "partial_cover",
      level: "warn",
      message: "The label only partly covers the original text.",
    });
  }

  if (patch.fontSize < patch.originalFontSize * 0.85 - 0.01) {
    warnings.push({
      code: "shrunk",
      level: "warn",
      message: `Text shrunk to ${round2(patch.fontSize)}pt (${Math.round((patch.fontSize / patch.originalFontSize) * 100)}% of the original ${round2(patch.originalFontSize)}pt).`,
    });
  }

  warnings.push(...(ctx.extraWarnings ?? []));
  const status: PatchStatus = warnings.some((w) => w.level === "error")
    ? "error"
    : warnings.some((w) => w.level === "warn")
      ? "warn"
      : "ok";
  return { status, warnings, layout: result.layout, fits: result.fits };
}

/** Width needed to print `text` on one line at `size`, including padding. */
export function neededWidth(
  text: string,
  size: number,
  family: FontFamily,
  bold: boolean,
  measure: Measure,
) {
  return measure(text, family, bold, size) + 2 * PAD_X;
}
