import type { z } from "zod";

import type { lineSchema, lockSchema, patchSchema, suggestionSchema } from "../../../server/lib/reprint-schemas";

export type PatchView = z.infer<typeof patchSchema>;
export type LockView = z.infer<typeof lockSchema>;
export type SuggestionView = z.infer<typeof suggestionSchema>;
export type LineView = z.infer<typeof lineSchema>;
export type RectView = PatchView["rect"];

export interface DocView {
  id: string;
  name: string;
  pages: { index: number; width: number; height: number; lineCount: number; lines?: LineView[] }[];
  patches: PatchView[];
  locks: LockView[];
  suggestions: SuggestionView[];
}

/** Ascender of every DejaVu face we use, in em (1901/2048). */
export const DEJAVU_ASCENT = 0.928;

export const FONT_CSS: Record<PatchView["fontFamily"], string> = {
  sans: '"RL Sans", "DejaVu Sans", sans-serif',
  serif: '"RL Serif", "DejaVu Serif", serif',
  mono: '"RL Mono", "DejaVu Sans Mono", monospace',
};

export function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "errorCode" in error && typeof (error as { errorCode: unknown }).errorCode === "string"
    ? (error as { errorCode: string }).errorCode
    : undefined;
}

export function errorDetails(error: unknown): Record<string, unknown> | undefined {
  return error && typeof error === "object" && "details" in error ? ((error as { details: Record<string, unknown> }).details ?? undefined) : undefined;
}

/** L1, L2… in reading order, matching the exported sheet. */
export function labelNumbers(patches: PatchView[]): Map<string, string> {
  const sorted = [...patches].sort((a, b) => a.page - b.page || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  return new Map(sorted.map((p, i) => [p.id, `L${i + 1}`]));
}

/** Rough text under a rect from line runs, for prefilling the popover. */
export function textUnderRect(lines: LineView[] | undefined, r: RectView): string {
  if (!lines) return "";
  const parts: string[] = [];
  for (const line of lines) {
    const vy = Math.min(line.y + line.h, r.y + r.h) - Math.max(line.y, r.y);
    if (vy < line.h * 0.4) continue;
    const x0 = Math.max(line.x, r.x);
    const x1 = Math.min(line.x + line.w, r.x + r.w);
    if (x1 - x0 < 1) continue;
    const n = line.text.length;
    const a = Math.max(0, Math.round(((x0 - line.x) / line.w) * n));
    const b = Math.min(n, Math.round(((x1 - line.x) / line.w) * n));
    parts.push(line.text.slice(a, b).trim());
  }
  return parts.filter(Boolean).join(" ");
}
