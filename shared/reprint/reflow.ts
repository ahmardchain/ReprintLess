import { checkFit, layoutText, neededWidth, type FitContext } from "./fit";
import { overlaps, rectRound, right, round2, textObstacles } from "./geometry";
import { LINE_HEIGHT, MIN_FONT_SIZE, PAD_Y, type PatchGeometry, type Rect } from "./types";

export type CandidateKind =
  | "keep"
  | "trim"
  | "grow-right"
  | "grow-left"
  | "grow-both"
  | "grow-down";

export interface ReflowCandidate {
  kind: CandidateKind;
  rect: Rect;
  fontSize: number;
  lines: number;
  penalty: number;
  status: "ok" | "warn";
}

export interface ReflowResult {
  changed: boolean;
  explanation: string;
  rect: Rect;
  fontSize: number;
  candidate: ReflowCandidate | null;
  /** Every candidate that passed, best first (for transparency). */
  considered: ReflowCandidate[];
  rejected: { kind: CandidateKind; reason: string }[];
}

interface Obstacle {
  rect: Rect;
  label: string;
}

function obstaclesFor(patch: PatchGeometry, ctx: FitContext): Obstacle[] {
  return [
    ...ctx.locks.map((l) => ({ rect: l.rect, label: l.label || "locked area" })),
    ...textObstacles(ctx.lines, patch.target),
    ...ctx.patches.filter((p) => p.id !== patch.id).map((p) => ({ rect: p.rect, label: "another label" })),
  ];
}

/** Free horizontal span around the target within the rect's vertical band. */
function freeSpan(patch: PatchGeometry, band: Rect, obstacles: Obstacle[], pageW: number) {
  let left = 0;
  let rightLimit = pageW;
  let leftBy: string | null = null;
  let rightBy: string | null = null;
  const t = patch.target;
  for (const ob of obstacles) {
    const vy = Math.min(band.y + band.h, ob.rect.y + ob.rect.h) - Math.max(band.y, ob.rect.y);
    if (vy <= 0.75) continue;
    if (right(ob.rect) <= t.x + 0.5 && right(ob.rect) > left) {
      left = right(ob.rect);
      leftBy = ob.label;
    }
    if (ob.rect.x >= right(t) - 0.5 && ob.rect.x < rightLimit) {
      rightLimit = ob.rect.x;
      rightBy = ob.label;
    }
  }
  return { left: left + 0.5, right: rightLimit - 0.5, leftBy, rightBy };
}

function sizePenalty(size: number, original: number) {
  const r = size / original;
  if (r >= 0.999) return 0;
  if (r >= 0.85) return 2 + 40 * (1 - r);
  return 15 + 80 * (1 - r);
}

const quote = (s: string) => `"${s.length > 28 ? s.slice(0, 27) + "…" : s}"`;

/**
 * Finds the least intrusive way to make a patch fit: trim it off neighbours,
 * grow into free space, wrap to two lines, or shrink the text (slightly
 * first, then down to 6pt). Rejects anything that covers a lock, other text
 * or another label, and returns the lowest-penalty candidate.
 */
export function reflowPatch(patch: PatchGeometry, ctx: FitContext): ReflowResult {
  const fitCtx: FitContext = { ...ctx, extraWarnings: [] };
  const current = checkFit(patch, fitCtx);
  if (current.status !== "error") {
    return {
      changed: false,
      explanation: "This label already fits; nothing to change.",
      rect: patch.rect,
      fontSize: patch.fontSize,
      candidate: null,
      considered: [],
      rejected: [],
    };
  }

  const obstacles = obstaclesFor(patch, ctx);
  const band = { ...patch.rect };
  const span = freeSpan(patch, band, obstacles, ctx.page.width);
  const t = patch.target;
  const r = patch.rect;
  const size = patch.fontSize;
  const need = neededWidth(patch.newText, size, patch.fontFamily, patch.bold, ctx.measure);

  const minX = Math.min(t.x, Math.max(r.x, span.left));
  const maxR = Math.max(right(t), Math.min(right(r), span.right));
  const trimmed: Rect = { x: minX, y: r.y, w: maxR - minX, h: r.h };

  const shapes: { kind: CandidateKind; rect: Rect; shape: number }[] = [
    { kind: "keep", rect: r, shape: 0 },
  ];
  if (Math.abs(trimmed.x - r.x) > 0.25 || Math.abs(trimmed.w - r.w) > 0.25) {
    shapes.push({ kind: "trim", rect: trimmed, shape: 1 });
  }
  const base = shapes[shapes.length - 1].rect;
  if (need > base.w) {
    const growR = Math.min(span.right, base.x + need) - base.x;
    if (growR > base.w + 0.25)
      shapes.push({ kind: "grow-right", rect: { ...base, w: growR }, shape: 3 + 0.02 * (growR - base.w) });
    const newX = Math.max(span.left, right(base) - need);
    if (newX < base.x - 0.25) {
      const shift = patch.align === "left" ? base.x - newX : 0;
      shapes.push({
        kind: "grow-left",
        rect: { ...base, x: newX, w: right(base) - newX },
        shape: 3 + 0.02 * (base.x - newX) + 0.15 * shift,
      });
    }
    const half = (need - base.w) / 2;
    const bx = Math.max(span.left, base.x - half);
    const br = Math.min(span.right, right(base) + half);
    if (bx < base.x - 0.25 && br > right(base) + 0.25) {
      shapes.push({
        kind: "grow-both",
        rect: { ...base, x: bx, w: br - bx },
        shape: 4 + 0.02 * (br - bx - base.w) + (patch.align !== "center" ? 0.15 * (base.x - bx) : 0),
      });
    }
  }
  const twoLineH = size * 0.95 + size * LINE_HEIGHT + 2 * PAD_Y;
  if (twoLineH > base.h + 0.25) {
    shapes.push({
      kind: "grow-down",
      rect: { ...base, h: twoLineH },
      shape: 5 + 0.1 * (twoLineH - base.h),
    });
  }

  const considered: ReflowCandidate[] = [];
  const rejected: { kind: CandidateKind; reason: string }[] = [];
  for (const s of shapes) {
    const rect = rectRound(s.rect);
    const blocked = obstacles.find((o) => overlaps(rect, o.rect));
    if (blocked) {
      rejected.push({ kind: s.kind, reason: `would cover ${quote(blocked.label)}` });
      continue;
    }
    if (rect.x < -0.01 || rect.y < -0.01 || right(rect) > ctx.page.width + 0.01 || rect.y + rect.h > ctx.page.height + 0.01) {
      rejected.push({ kind: s.kind, reason: "would run off the page" });
      continue;
    }
    let found = false;
    for (let fs = size; fs >= MIN_FONT_SIZE - 1e-9; fs = round2(fs - 0.25)) {
      const res = layoutText(patch.newText, rect, fs, patch.fontFamily, patch.bold, patch.align, ctx.measure);
      if (!res.fits) continue;
      const check = checkFit({ ...patch, rect, fontSize: fs }, fitCtx);
      if (check.status === "error") continue;
      considered.push({
        kind: s.kind,
        rect,
        fontSize: round2(fs),
        lines: res.layout.lines.length,
        penalty: round2(s.shape + sizePenalty(fs, patch.originalFontSize) + (res.layout.lines.length > 1 ? 6 : 0)),
        status: check.status,
      });
      found = true;
      break;
    }
    if (!found) rejected.push({ kind: s.kind, reason: `text doesn't fit even at ${MIN_FONT_SIZE}pt` });
  }

  considered.sort((a, b) => a.penalty - b.penalty);
  const best = considered[0];
  if (!best) {
    return {
      changed: false,
      explanation: `No layout fits without covering something: ${rejected.map((x) => `${x.kind} ${x.reason}`).join("; ")}. Make room, unlock an area, or shorten the label.`,
      rect: patch.rect,
      fontSize: patch.fontSize,
      candidate: null,
      considered,
      rejected,
    };
  }
  return {
    changed: true,
    explanation: explain(patch, best, span),
    rect: best.rect,
    fontSize: best.fontSize,
    candidate: best,
    considered,
    rejected,
  };
}

function explain(
  patch: PatchGeometry,
  c: ReflowCandidate,
  span: { leftBy: string | null; rightBy: string | null },
): string {
  const parts: string[] = [];
  const dw = round2(c.rect.w - patch.rect.w);
  if (c.kind === "trim") {
    const by = span.rightBy && right(patch.rect) > right(c.rect) ? span.rightBy : span.leftBy;
    parts.push(by ? `pulled the label back off ${quote(by)}` : "trimmed the label to the free space");
  } else if (c.kind === "grow-right") parts.push(`widened the label ${Math.abs(dw)}pt to the right into free space`);
  else if (c.kind === "grow-left") parts.push(`widened the label ${Math.abs(dw)}pt to the left into free space`);
  else if (c.kind === "grow-both") parts.push(`widened the label ${Math.abs(dw)}pt on both sides`);
  else if (c.kind === "grow-down") parts.push(`grew the label ${round2(c.rect.h - patch.rect.h)}pt downward`);
  if (c.lines > 1) parts.push(`wrapped the text onto ${c.lines} lines`);
  if (c.fontSize < patch.fontSize - 0.001) {
    const pct = Math.round((c.fontSize / patch.originalFontSize) * 100);
    parts.push(`shrank the text from ${round2(patch.fontSize)}pt to ${c.fontSize}pt (${pct}% of the original)`);
  }
  if (parts.length === 0) parts.push("kept the layout");
  const s = parts.join(", ").replace(/, ([^,]*)$/, " and $1");
  const tail = c.status === "warn" ? " It fits, with a warning to review." : " It now fits cleanly.";
  return s.charAt(0).toUpperCase() + s.slice(1) + "." + tail;
}
