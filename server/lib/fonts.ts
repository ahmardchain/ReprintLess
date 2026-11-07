import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";

import type { FontFamily, Measure } from "../../shared/reprint/types.js";

/** DejaVu files used for both print (pdf-lib) and measurement (fontkit). */
export const FONT_FILES: Record<FontFamily, { regular: string; bold: string }> = {
  sans: { regular: "DejaVuSans.ttf", bold: "DejaVuSans-Bold.ttf" },
  serif: { regular: "DejaVuSerif.ttf", bold: "DejaVuSerif-Bold.ttf" },
  mono: { regular: "DejaVuSansMono.ttf", bold: "DejaVuSansMono-Bold.ttf" },
};

export const FONT_LABELS: Record<FontFamily, string> = {
  sans: "DejaVu Sans",
  serif: "DejaVu Serif",
  mono: "DejaVu Sans Mono",
};

const bytesCache = new Map<string, Uint8Array>();
type FkFont = ReturnType<typeof fontkit.create>;
const fontCache = new Map<string, FkFont>();
const widthCache = new Map<string, number>();

function candidates(file: string): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "public", "fonts", file),
    path.join(cwd, "build", "client", "fonts", file),
    path.join(cwd, "node_modules", "dejavu-fonts-ttf", "ttf", file),
  ];
}

export function fontBytes(family: FontFamily, bold: boolean): Uint8Array {
  const file = FONT_FILES[family][bold ? "bold" : "regular"];
  const cached = bytesCache.get(file);
  if (cached) return cached;
  const found = candidates(file).find((p) => existsSync(p));
  if (!found) throw new Error(`Font file ${file} not found (looked in public/fonts and node_modules).`);
  const bytes = new Uint8Array(readFileSync(found));
  bytesCache.set(file, bytes);
  return bytes;
}

function fkFont(family: FontFamily, bold: boolean): FkFont {
  const key = `${family}:${bold}`;
  let font = fontCache.get(key);
  if (!font) {
    font = fontkit.create(fontBytes(family, bold));
    fontCache.set(key, font);
  }
  return font;
}

/** Advance width in pt, measured with the same DejaVu files the PDF embeds. */
export const measureText: Measure = (text, family, bold, size) => {
  if (!text) return 0;
  const key = `${family}:${bold}:${text}`;
  let em = widthCache.get(key);
  if (em === undefined) {
    const font = fkFont(family, bold);
    em = font.layout(text).advanceWidth / font.unitsPerEm;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, em);
  }
  return em * size;
};
