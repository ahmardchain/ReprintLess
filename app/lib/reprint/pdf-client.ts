/**
 * Browser-only PDF.js wrapper: parse a PDF into ReprintLess pages (text
 * lines + colour grid) and render pages to a canvas. Imported lazily so the
 * server bundle never loads PDF.js.
 */
import { appPath } from "@agent-native/core/client/api-path";

import { buildLines, colorLines, computeGrid, type TextItemIn } from "@shared/reprint/extract";
import { MAX_PAGES, type Page } from "@shared/reprint/types";

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function openPdf(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  // PDF.js transfers the buffer to its worker, so hand it a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    fontExtraProperties: true,
    standardFontDataUrl: appPath("/pdfjs-standard-fonts/"),
  });
  const doc = await task.promise;
  return Object.assign(doc, { close: () => task.destroy() });
}

export class PdfError extends Error {
  constructor(
    message: string,
    public code: "scanned" | "too_many_pages" | "unreadable",
  ) {
    super(message);
  }
}

/** Extracts every page: text lines with runs (pt, top-left) and the 12pt grid. */
export async function extractPdf(bytes: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Page[]> {
  let doc;
  try {
    doc = await openPdf(bytes);
  } catch {
    throw new PdfError("This file couldn't be read as a PDF.", "unreadable");
  }
  if (doc.numPages > MAX_PAGES) {
    throw new PdfError(`This PDF has ${doc.numPages} pages; ReprintLess handles up to ${MAX_PAGES}.`, "too_many_pages");
  }
  const pdfjs = await loadPdfjs();
  const pages: Page[] = [];
  let chars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    // Render at 1px per pt for the colour grid (this also loads the fonts).
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
    const content = await page.getTextContent();
    const items: TextItemIn[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const tx = pdfjs.Util.transform(viewport.transform, it.transform);
      const style = content.styles[it.fontName] as { fontFamily?: string } | undefined;
      let fontName = it.fontName;
      try {
        const font = page.commonObjs.get(it.fontName) as { name?: string } | undefined;
        if (font?.name) fontName = font.name;
      } catch {
        // Font not loaded; keep the PDF.js id.
      }
      items.push({
        str: it.str,
        x: tx[4],
        baseline: tx[5],
        fontSize: Math.hypot(tx[2], tx[3]),
        width: it.width * viewport.scale,
        fontName,
        cssFamily: style?.fontFamily ?? "",
      });
    }
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const grid = computeGrid(image.data, canvas.width, canvas.height, 12);
    const lines = colorLines(buildLines(items, i - 1), grid);
    chars += lines.reduce((n, l) => n + l.text.trim().length, 0);
    pages.push({ width: Math.round(viewport.width * 100) / 100, height: Math.round(viewport.height * 100) / 100, lines, grid });
    onProgress?.(i, doc.numPages);
    page.cleanup();
  }
  await doc.close();
  if (chars < 5) {
    throw new PdfError("This PDF has no text layer (it looks scanned). ReprintLess works with text-based PDFs only.", "scanned");
  }
  return pages;
}

/** Renders one page into `canvas` at `scale` device pixels per pt. */
export async function renderPage(bytes: Uint8Array, pageIndex: number, canvas: HTMLCanvasElement, scale: number, signal?: { cancelled: boolean }) {
  const doc = await openPdf(bytes);
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    if (signal?.cancelled) return;
    const off = document.createElement("canvas");
    off.width = Math.ceil(viewport.width);
    off.height = Math.ceil(viewport.height);
    const ctx = off.getContext("2d")!;
    await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
    if (signal?.cancelled) return;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext("2d")!.drawImage(off, 0, 0);
  } finally {
    await doc.close();
  }
}
