/** Shelf packing of labels onto printable sheets. Units: pt. */

export const PAPER = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const;
export type Paper = keyof typeof PAPER;

export const MM = 72 / 25.4;
/** Space around each label for crop marks, pt. */
export const CROP_MARGIN = 10;
/** Space under each label for its ID, pt. */
export const ID_SPACE = 10;
export const SHEET_MARGIN = 28;
/** Height reserved on sheet 1 for the title and calibration square, pt. */
export const HEADER_HEIGHT = 112;

export interface PackItem {
  id: string;
  w: number;
  h: number;
}

export interface Placement {
  id: string;
  sheet: number;
  /** Top-left of the label itself (cut line), pt. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackResult {
  sheets: number;
  placements: Placement[];
  paper: { width: number; height: number };
}

/**
 * Next-fit decreasing-height shelf packing. Each label occupies its own size
 * plus the crop-mark margin on every side, the ID band below, and `gap`
 * between cells. Labels too large for a sheet are scaled down never; they
 * get a sheet of their own and overflow is reported by the caller.
 */
export function packLabels(items: PackItem[], paper: Paper, gapMm: number): PackResult {
  const { width, height } = PAPER[paper];
  const gap = Math.max(0, gapMm) * MM;
  const usableW = width - 2 * SHEET_MARGIN;
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const placements: Placement[] = [];
  let sheet = 0;
  let shelfY = SHEET_MARGIN + HEADER_HEIGHT;
  let shelfH = 0;
  let cursorX = SHEET_MARGIN;
  for (const item of sorted) {
    const cellW = item.w + 2 * CROP_MARGIN;
    const cellH = item.h + 2 * CROP_MARGIN + ID_SPACE;
    if (cursorX + cellW > SHEET_MARGIN + usableW + 0.01 && cursorX > SHEET_MARGIN) {
      shelfY += shelfH + gap;
      shelfH = 0;
      cursorX = SHEET_MARGIN;
    }
    if (shelfY + cellH > height - SHEET_MARGIN + 0.01 && shelfY > SHEET_MARGIN) {
      sheet += 1;
      shelfY = SHEET_MARGIN;
      shelfH = 0;
      cursorX = SHEET_MARGIN;
    }
    placements.push({
      id: item.id,
      sheet,
      x: cursorX + CROP_MARGIN,
      y: shelfY + CROP_MARGIN,
      w: item.w,
      h: item.h,
    });
    cursorX += cellW + gap;
    shelfH = Math.max(shelfH, cellH);
  }
  return { sheets: items.length ? sheet + 1 : 1, placements, paper: { width, height } };
}
