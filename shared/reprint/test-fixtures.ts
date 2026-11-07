import { ASCENT_RATIO, type FontFamily, type Line, type Measure } from "./types";

/** Builds a single-run line the way the browser extractor does. */
export function makeLine(
  measure: Measure,
  id: string,
  text: string,
  x: number,
  baseline: number,
  fontSize: number,
  bold = false,
  fontFamily: FontFamily = "sans",
): Line {
  const w = measure(text, fontFamily, bold, fontSize);
  return {
    id,
    text,
    x,
    y: baseline - ASCENT_RATIO * fontSize,
    w,
    h: fontSize,
    fontSize,
    fontFamily,
    bold,
    color: "#1f2a1f",
    runs: [{ text, x, w }],
  };
}
