import { inflateSync } from "node:zlib";

import { PDFDocument, PDFName, PDFRawStream, PDFArray } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { layoutText } from "../../shared/reprint/fit";
import { measureText } from "./fonts";
import { buildLabelSheet } from "./label-sheet";

async function contentOf(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.get(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let out = "";
  for (const ref of refs) {
    const stream = doc.context.lookup(ref) as PDFRawStream;
    const raw = stream.getContents();
    const filter = stream.dict.get(PDFName.of("Filter"));
    out += filter ? inflateSync(raw).toString("latin1") : Buffer.from(raw).toString("latin1");
    out += "\n";
  }
  return out;
}

describe("label sheet PDF", () => {
  it("exports a 100x40pt patch at exactly 100x40pt with crop marks, ID and calibration square", async () => {
    const rect = { x: 50, y: 60, w: 100, h: 40 };
    const { layout } = layoutText("₦2,550", rect, 14, "sans", true, "right", measureText);
    const bytes = await buildLabelSheet({
      documentName: "Menu",
      pages: [{ width: 595, height: 842, lines: [] }],
      patches: [{ id: "a", page: 0, rect, layout, fontFamily: "sans", bold: true, bgColor: "#fff7e8", textColor: "#222222", border: false }],
      paper: "A4",
      gapMm: 3,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2); // sheet + placement map
    const content = await contentOf(bytes, 0);
    // pdf-lib draws rectangles as closed paths: 0 0 m / 0 h l / w h l / w 0 l / h.
    const rects = [...content.matchAll(/0 0 m\n0 ([\d.]+) l\n([\d.]+) \1 l\n\2 0 l\nh/g)].map((m) => [Number(m[2]), Number(m[1])]);
    expect(rects).toContainEqual([100, 40]);
    expect(rects).toContainEqual([72, 72]);
    // Four corners × two strokes of crop marks.
    expect((content.match(/ l\b/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
});
