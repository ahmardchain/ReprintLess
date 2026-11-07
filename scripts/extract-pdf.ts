/**
 * Node-side text extraction for CLI smoke tests (no colour grid):
 *   pnpm exec tsx scripts/extract-pdf.ts public/samples/flyer.pdf > /tmp/flyer.json
 */
import { readFileSync } from "node:fs";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { buildLines, type TextItemIn } from "../shared/reprint/extract.js";

const file = process.argv[2];
if (!file) throw new Error("usage: extract-pdf.ts <file.pdf>");
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  fontExtraProperties: true,
  standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/",
}).promise;
function realFontName(page: { commonObjs: { get(id: string): unknown } }, id: string): string {
  try {
    const font = page.commonObjs.get(id) as { name?: string } | undefined;
    return font?.name ?? id;
  } catch {
    return id;
  }
}

const pages = [];
for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
  const page = await doc.getPage(i);
  const viewport = page.getViewport({ scale: 1 });
  await page.getOperatorList(); // loads fonts so their real names are known
  const content = await page.getTextContent();
  const items: TextItemIn[] = [];
  for (const it of content.items) {
    if (!("str" in it)) continue;
    const tx = pdfjs.Util.transform(viewport.transform, it.transform);
    const style = content.styles[it.fontName];
    items.push({
      str: it.str,
      x: tx[4],
      baseline: tx[5],
      fontSize: Math.hypot(tx[2], tx[3]),
      width: it.width * viewport.scale,
      fontName: realFontName(page, it.fontName),
      cssFamily: (style as { fontFamily?: string } | undefined)?.fontFamily ?? "",
    });
  }
  pages.push({ width: viewport.width, height: viewport.height, lines: buildLines(items, i - 1), grid: null });
}
process.stdout.write(JSON.stringify({ name: file.split("/").pop(), pages }));
