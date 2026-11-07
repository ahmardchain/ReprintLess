import { packLabels, type PackResult, type Paper } from "./packing";
import type { Rect } from "./types";

export interface LabelSource {
  id: string;
  page: number;
  rect: Rect;
}

/** Stable label ids: L1, L2… in reading order (page, then top, then left). */
export function labelIds<T extends LabelSource>(patches: T[]): (T & { label: string })[] {
  return [...patches]
    .sort((a, b) => a.page - b.page || a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .map((p, i) => ({ ...p, label: `L${i + 1}` }));
}

export function planSheet(patches: LabelSource[], paper: Paper, gapMm: number) {
  const ordered = labelIds(patches);
  const pack: PackResult = packLabels(
    ordered.map((p) => ({ id: p.id, w: p.rect.w, h: p.rect.h })),
    paper,
    gapMm,
  );
  return { ordered, pack };
}
