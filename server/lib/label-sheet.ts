import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { hexToRgb } from "../../shared/reprint/colors.js";
import { planSheet } from "../../shared/reprint/labels.js";
import { CROP_MARGIN, HEADER_HEIGHT, SHEET_MARGIN, type Paper } from "../../shared/reprint/packing.js";
import {
  ASCENT_RATIO,
  type FontFamily,
  type Line,
  type PatchLayout,
  type Rect,
} from "../../shared/reprint/types.js";
import { fontBytes } from "./fonts.js";

export interface SheetPatch {
  id: string;
  page: number;
  rect: Rect;
  layout: PatchLayout;
  fontFamily: FontFamily;
  bold: boolean;
  bgColor: string;
  textColor: string;
  border: boolean;
}

export interface SheetInput {
  documentName: string;
  pages: { width: number; height: number; lines: Line[] }[];
  patches: SheetPatch[];
  paper: Paper;
  gapMm: number;
}

const color = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
};

/** Builds the printable label sheet plus one placement map per source page. */
export async function buildLabelSheet(input: SheetInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`ReprintLess labels: ${input.documentName}`);
  pdf.setCreator("ReprintLess");
  const fonts = new Map<string, PDFFont>();
  const font = async (family: FontFamily, bold: boolean) => {
    const key = `${family}:${bold}`;
    let f = fonts.get(key);
    if (!f) {
      f = await pdf.embedFont(fontBytes(family, bold), { subset: true });
      fonts.set(key, f);
    }
    return f;
  };
  const ui = await font("sans", false);
  const uiBold = await font("sans", true);

  const { ordered, pack } = planSheet(input.patches, input.paper, input.gapMm);
  const byId = new Map(input.patches.map((p) => [p.id, p]));
  const labelOf = new Map(ordered.map((p) => [p.id, p.label]));
  const { width: W, height: H } = pack.paper;
  const sheets: PDFPage[] = [];
  for (let i = 0; i < pack.sheets; i++) sheets.push(pdf.addPage([W, H]));

  // Header on sheet 1: title, instructions and a calibration square.
  const s0 = sheets[0];
  const top = (y: number) => H - y;
  s0.drawText("ReprintLess label sheet", { x: SHEET_MARGIN, y: top(SHEET_MARGIN + 16), size: 15, font: uiBold, color: rgb(0.1, 0.1, 0.1) });
  s0.drawText(input.documentName.slice(0, 70), { x: SHEET_MARGIN, y: top(SHEET_MARGIN + 34), size: 10, font: ui, color: rgb(0.3, 0.3, 0.3) });
  const lines = [
    `${input.patches.length} label${input.patches.length === 1 ? "" : "s"} at actual size. Print on sticker paper at 100% (no "fit to page").`,
    "Check the square measures exactly 1 inch, cut on the crop marks,",
    "and stick each label where the placement map shows.",
  ];
  lines.forEach((t, i) => s0.drawText(t, { x: SHEET_MARGIN, y: top(SHEET_MARGIN + 54 + i * 12), size: 8.5, font: ui, color: rgb(0.25, 0.25, 0.25) }));
  const sq = { x: W - SHEET_MARGIN - 72, y: SHEET_MARGIN + 4 };
  s0.drawRectangle({ x: sq.x, y: top(sq.y + 72), width: 72, height: 72, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
  s0.drawText("1 inch", { x: sq.x + 20, y: top(sq.y + 34), size: 10, font: uiBold });
  s0.drawText("print at 100%", { x: sq.x + 9, y: top(sq.y + 47), size: 8, font: ui });
  s0.drawText("Actual size", { x: sq.x + 14, y: top(sq.y + 86), size: 8, font: ui, color: rgb(0.3, 0.3, 0.3) });
  s0.drawLine({ start: { x: SHEET_MARGIN, y: top(SHEET_MARGIN + HEADER_HEIGHT - 8) }, end: { x: W - SHEET_MARGIN, y: top(SHEET_MARGIN + HEADER_HEIGHT - 8) }, thickness: 0.3, color: rgb(0.75, 0.75, 0.75) });

  for (const place of pack.placements) {
    const patch = byId.get(place.id)!;
    const page = sheets[place.sheet];
    const { x, y, w, h } = place;
    page.drawRectangle({
      x,
      y: top(y + h),
      width: w,
      height: h,
      color: color(patch.bgColor),
      ...(patch.border ? { borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.4 } : {}),
    });
    const f = await font(patch.fontFamily, patch.bold);
    for (const ln of patch.layout.lines) {
      page.drawText(ln.text, {
        x: x + ln.x,
        y: top(y + ln.baseline),
        size: patch.layout.fontSize,
        font: f,
        color: color(patch.textColor),
      });
    }
    // Crop marks at each corner, outside the cut line.
    const gap = 2;
    const len = CROP_MARGIN - gap - 1;
    const mark = { thickness: 0.3, color: rgb(0, 0, 0) };
    for (const [cx, cy, dx, dy] of [
      [x, y, -1, -1],
      [x + w, y, 1, -1],
      [x, y + h, -1, 1],
      [x + w, y + h, 1, 1],
    ] as const) {
      page.drawLine({ start: { x: cx + dx * gap, y: top(cy) }, end: { x: cx + dx * (gap + len), y: top(cy) }, ...mark });
      page.drawLine({ start: { x: cx, y: top(cy + dy * gap) }, end: { x: cx, y: top(cy + dy * (gap + len)) }, ...mark });
    }
    page.drawText(labelOf.get(place.id) ?? "", { x, y: top(y + h + CROP_MARGIN + 7), size: 7, font: uiBold, color: rgb(0.35, 0.35, 0.35) });
  }

  // Placement maps.
  const pagesWithLabels = [...new Set(ordered.map((p) => p.page))].sort((a, b) => a - b);
  for (const pageIndex of pagesWithLabels) {
    const src = input.pages[pageIndex];
    if (!src) continue;
    const map = pdf.addPage([W, H]);
    const headerH = 30;
    const scale = Math.min((W - 2 * SHEET_MARGIN) / src.width, (H - 2 * SHEET_MARGIN - headerH) / src.height);
    const ox = (W - src.width * scale) / 2;
    const oy = SHEET_MARGIN + headerH;
    map.drawText(`Placement map: page ${pageIndex + 1}`, { x: SHEET_MARGIN, y: top(SHEET_MARGIN + 14), size: 12, font: uiBold });
    map.drawText(input.documentName.slice(0, 60), { x: SHEET_MARGIN, y: top(SHEET_MARGIN + 26), size: 8, font: ui, color: rgb(0.4, 0.4, 0.4) });
    map.drawRectangle({ x: ox, y: top(oy + src.height * scale), width: src.width * scale, height: src.height * scale, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.6 });
    for (const line of src.lines) {
      const size = line.fontSize * scale;
      if (size < 1) continue;
      const f = await font(line.fontFamily, line.bold);
      map.drawText(line.text, {
        x: ox + line.x * scale,
        y: top(oy + (line.y + ASCENT_RATIO * line.fontSize) * scale),
        size,
        font: f,
        color: rgb(0.74, 0.74, 0.74),
      });
    }
    for (const p of ordered.filter((o) => o.page === pageIndex)) {
      const r = p.rect;
      const rx = ox + r.x * scale;
      const ry = oy + r.y * scale;
      map.drawRectangle({ x: rx, y: top(ry + r.h * scale), width: r.w * scale, height: r.h * scale, borderColor: rgb(0.85, 0.1, 0.1), borderWidth: 1.2 });
      const tagY = ry - 3 > oy + 8 ? ry - 3 : ry + r.h * scale + 9;
      map.drawText(p.label, { x: rx, y: top(tagY), size: 8, font: uiBold, color: rgb(0.85, 0.1, 0.1) });
    }
  }

  return pdf.save();
}
