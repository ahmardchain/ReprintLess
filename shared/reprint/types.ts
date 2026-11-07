/**
 * ReprintLess shared types. All coordinates are PDF points (1/72 inch) with
 * the origin at the top-left corner of the page, y growing downward.
 */

export type FontFamily = "sans" | "serif" | "mono";
export type Align = "left" | "right" | "center";
export type PatchStatus = "ok" | "warn" | "error";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Run {
  text: string;
  /** Left edge of the run, pt. */
  x: number;
  /** Advance width of the run as printed, pt. */
  w: number;
}

export interface Line {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  /** Ink colour as #rrggbb. */
  color: string;
  runs: Run[];
  /** Font name reported by the PDF (e.g. "Helvetica-Bold"), if known. */
  fontName?: string;
}

export interface Grid {
  /** Cell size in pt (12). */
  cell: number;
  cols: number;
  rows: number;
  /** Dominant quantized colour per cell, row-major, #rrggbb. */
  colors: string[];
  /** Mean colour of pixels far from the dominant one ("" when none). */
  ink: string[];
  /** Share of pixels equal to the dominant colour, 0..1. */
  uniformity: number[];
}

export interface Page {
  width: number;
  height: number;
  lines: Line[];
  grid?: Grid | null;
}

export interface LayoutLine {
  text: string;
  /** Left of the text relative to the patch rect, pt. */
  x: number;
  /** Baseline relative to the patch rect top, pt. */
  baseline: number;
  w: number;
}

export interface PatchLayout {
  lines: LayoutLine[];
  fontSize: number;
  /**
   * Horizontal text scale (1 = none). When the printed font is substituted
   * with DejaVu, glyphs are scaled so the label keeps the original's width.
   */
  scaleX?: number;
}

export interface Warning {
  code: string;
  level: "warn" | "error" | "info";
  message: string;
}

export interface PatchGeometry {
  id: string;
  page: number;
  rect: Rect;
  target: Rect;
  newText: string;
  fontFamily: FontFamily;
  bold: boolean;
  fontSize: number;
  originalFontSize: number;
  align: Align;
}

export interface LockGeometry {
  id: string;
  page: number;
  rect: Rect;
  label: string;
}

/** Measures the advance width of `text` in pt. */
export type Measure = (
  text: string,
  family: FontFamily,
  bold: boolean,
  size: number,
) => number;

export const MAX_PAGES = 20;
export const BLEED = 2;
export const MIN_FONT_SIZE = 6;
export const LINE_HEIGHT = 1.15;
/** Horizontal text padding inside a label, pt. */
export const PAD_X = 1.5;
/** Vertical text padding inside a label, pt. */
export const PAD_Y = 1;

/** Line boxes span from baseline - ASCENT·size to baseline + (1 - ASCENT)·size. */
export const ASCENT_RATIO = 0.78;
