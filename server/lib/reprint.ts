import { fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { labelColors } from "../../shared/reprint/colors.js";
import { documentYear } from "../../shared/reprint/check.js";
import { spliceMention, weekdayMismatches, withYear, formatDate } from "../../shared/reprint/dates.js";
import { checkFit, neededWidth, type FitContext } from "../../shared/reprint/fit.js";
import { findText, linesUnder, textUnder } from "../../shared/reprint/find.js";
import { inflate, intersection, area, rectRound } from "../../shared/reprint/geometry.js";
import {
  BLEED,
  type Align,
  type Line,
  type LockGeometry,
  type Measure,
  type Page,
  type PatchGeometry,
  type Rect,
  type Warning,
} from "../../shared/reprint/types.js";
import { getDb, schema } from "../db/index.js";
import { FONT_LABELS, measureText } from "./fonts.js";

export type PatchRow = typeof schema.patches.$inferSelect;
export type LockRow = typeof schema.locks.$inferSelect;
export type SuggestionRow = typeof schema.suggestions.$inferSelect;
export type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Db = ReturnType<typeof getDb> | Tx;

export interface DocRow {
  id: string;
  name: string;
  pages: Page[];
  pageCount: number;
  ownerEmail: string;
  orgId: string | null;
  createdAt: string;
}

export function requireUser(ctx: { userEmail?: string | undefined; orgId?: string | null | undefined } | undefined) {
  const email = ctx?.userEmail ?? fail("Sign in first.", { statusCode: 401, errorCode: "unauthorized" });
  return { email, orgId: ctx?.orgId ?? null };
}

/** Loads a document after checking the caller's role on it. */
export async function requireDoc(id: string, role: "viewer" | "editor" | "owner"): Promise<DocRow> {
  try {
    const access = await assertAccess("reprint-document", id, role);
    const doc = access.resource as DocRow;
    if (!doc || !Array.isArray(doc.pages)) throw new Error("missing");
    return doc;
  } catch {
    return fail("Document not found or you can't edit it.", { errorCode: "not_found", statusCode: 404 });
  }
}

export function requirePage(doc: DocRow, page: number): Page {
  const p = doc.pages[page];
  if (!p) return fail(`Page ${page} doesn't exist; this document has ${doc.pages.length} page(s), numbered from 0.`, { errorCode: "invalid_page", statusCode: 400 });
  return p;
}

export function patchOut(row: PatchRow) {
  return {
    id: row.id,
    documentId: row.documentId,
    page: row.page,
    rect: row.rect,
    target: row.target,
    oldText: row.oldText,
    newText: row.newText,
    fontFamily: row.fontFamily,
    bold: row.bold,
    fontSize: row.fontSize,
    originalFontSize: row.originalFontSize,
    align: row.align,
    textColor: row.textColor,
    bgColor: row.bgColor,
    border: row.border,
    layout: row.layout,
    status: row.status,
    warnings: row.warnings,
    source: row.source,
  };
}

export function lockOut(row: LockRow) {
  return { id: row.id, documentId: row.documentId, page: row.page, rect: row.rect, label: row.label };
}

export function suggestionOut(row: SuggestionRow) {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    severity: row.severity,
    page: row.page,
    target: row.target,
    oldText: row.oldText,
    suggestedText: row.suggestedText,
    message: row.message,
    status: row.status,
  };
}

export async function pageChildren(db: Db, documentId: string, page: number) {
  const [patchRows, lockRows] = await Promise.all([
    db.select().from(schema.patches).where(and(eq(schema.patches.documentId, documentId), eq(schema.patches.page, page))).limit(500),
    db.select().from(schema.locks).where(and(eq(schema.locks.documentId, documentId), eq(schema.locks.page, page))).limit(500),
  ]);
  return { patchRows, lockRows };
}

export function geometryOf(row: Pick<PatchRow, "id" | "page" | "rect" | "target" | "newText" | "fontFamily" | "bold" | "fontSize" | "originalFontSize" | "align">): PatchGeometry {
  return {
    id: row.id,
    page: row.page,
    rect: row.rect,
    target: row.target,
    newText: row.newText,
    fontFamily: row.fontFamily,
    bold: row.bold,
    fontSize: row.fontSize,
    originalFontSize: row.originalFontSize,
    align: row.align,
  };
}

export function lockGeometry(row: LockRow): LockGeometry {
  return { id: row.id, page: row.page, rect: row.rect, label: row.label };
}

/** The printed line the target mostly covers (for font and colour). */
export function primaryLine(page: Page, target: Rect): Line | null {
  let best: Line | null = null;
  let bestArea = 0;
  for (const line of linesUnder(page.lines, target)) {
    const hit = intersection(line, target);
    const a = hit ? area(hit) : 0;
    if (a > bestArea) {
      best = line;
      bestArea = a;
    }
  }
  return best;
}

function fontWarning(line: Line | null, bold: boolean, family: keyof typeof FONT_LABELS): Warning[] {
  const name = line?.fontName;
  if (!name || /dejavu/i.test(name)) return [];
  return [
    {
      code: "font_substituted",
      level: "info",
      message: `Printed in ${FONT_LABELS[family]}${bold ? " Bold" : ""}, scaled to the width of the original ${name.replace(/^[A-Z]{6}\+/, "")}.`,
    },
  ];
}

/**
 * Width ratio between the PDF's printed text and DejaVu for the same
 * string, so substituted labels keep the original's set width.
 */
export function widthScale(line: Line | null): number {
  if (!line || !line.text.trim()) return 1;
  const measured = measureText(line.text, line.fontFamily, line.bold, line.fontSize);
  if (measured <= 0) return 1;
  const ratio = line.w / measured;
  if (Math.abs(ratio - 1) < 0.02) return 1;
  return Math.min(1.1, Math.max(0.75, ratio));
}

export function scaledMeasure(scaleX: number): Measure {
  return scaleX === 1 ? measureText : (t, f, b, s) => measureText(t, f, b, s) * scaleX;
}

/** Recomputes colours, layout, status and warnings for a patch in place. */
export function evaluatePatch(
  page: Page,
  patch: PatchGeometry,
  others: { id: string; rect: Rect }[],
  locks: LockGeometry[],
) {
  const line = primaryLine(page, patch.target);
  const colors = labelColors(page.grid, patch.rect, line?.color ?? null);
  const scaleX = widthScale(line);
  const ctx: FitContext = {
    lines: page.lines,
    locks,
    patches: others,
    page: { width: page.width, height: page.height },
    measure: scaledMeasure(scaleX),
    scaleX,
    extraWarnings: [...colors.warnings, ...fontWarning(line, patch.bold, patch.fontFamily)],
  };
  const fit = checkFit(patch, ctx);
  return { ...fit, bgColor: colors.bgColor, textColor: colors.textColor, border: colors.border };
}

export function fitContext(page: Page, patch: { id: string; target: Rect }, others: { id: string; rect: Rect }[], locks: LockGeometry[]): FitContext {
  const scaleX = widthScale(primaryLine(page, patch.target));
  return {
    lines: page.lines,
    locks,
    patches: others.filter((p) => p.id !== patch.id),
    page: { width: page.width, height: page.height },
    measure: scaledMeasure(scaleX),
    scaleX,
  };
}

/**
 * Re-runs the fit check for every patch on a page (moving one label can
 * clear or cause an overlap on another) and saves rows that changed.
 */
export async function recheckPage(db: Db, doc: DocRow, pageIndex: number): Promise<PatchRow[]> {
  const page = requirePage(doc, pageIndex);
  const { patchRows, lockRows } = await pageChildren(db, doc.id, pageIndex);
  const locks = lockRows.map(lockGeometry);
  const out: PatchRow[] = [];
  for (const row of patchRows) {
    const others = patchRows.filter((p) => p.id !== row.id).map((p) => ({ id: p.id, rect: p.rect }));
    const ev = evaluatePatch(page, geometryOf(row), others, locks);
    const next = {
      status: ev.status,
      warnings: ev.warnings,
      layout: ev.layout,
      bgColor: ev.bgColor,
      textColor: ev.textColor,
      border: ev.border,
    };
    if (JSON.stringify(next) !== JSON.stringify({ status: row.status, warnings: row.warnings, layout: row.layout, bgColor: row.bgColor, textColor: row.textColor, border: row.border })) {
      await db.update(schema.patches).set({ ...next, updatedAt: new Date().toISOString() }).where(eq(schema.patches.id, row.id));
      out.push({ ...row, ...next });
    } else out.push(row);
  }
  return out;
}

export interface TargetInput {
  target?: Rect | undefined;
  findText?: string | undefined;
  occurrence?: number | undefined;
}

/** Resolves a target bbox from an explicit rect or a text search. */
export function resolveTarget(doc: DocRow, page: number | undefined, input: TargetInput): { page: number; target: Rect; oldText?: string } {
  if (input.target) {
    if (page === undefined) fail("page is required with target.", { errorCode: "invalid_input" });
    requirePage(doc, page);
    return { page, target: rectRound(input.target) };
  }
  if (!input.findText) fail("Pass either target or findText.", { errorCode: "invalid_input" });
  const matches = findText(doc.pages, input.findText, measureText, page);
  if (matches.length === 0) {
    fail(`"${input.findText}" isn't on ${page === undefined ? "any page" : `page ${page}`}. Use find-text with a shorter query.`, { errorCode: "text_not_found", statusCode: 404 });
  }
  if (matches.length > 1 && input.occurrence === undefined) {
    fail(`"${input.findText}" appears ${matches.length} times; pass occurrence (0-based) to pick one.`, {
      errorCode: "ambiguous_match",
      details: { matches: matches.slice(0, 10).map((m, i) => ({ occurrence: i, page: m.page, line: m.lineText })) },
    });
  }
  const m = matches[input.occurrence ?? 0] ?? fail(`occurrence ${input.occurrence} is out of range (0-${matches.length - 1}).`, { errorCode: "invalid_input" });
  return { page: m.page, target: m.bbox, oldText: m.text };
}

/**
 * Rejects text whose weekday contradicts its date and offers both fixes.
 * Never guesses which one the user meant.
 */
export function assertWeekdayMatches(doc: DocRow, newText: string) {
  const year = documentYear(doc, new Date().getFullYear());
  const [mm] = weekdayMismatches(newText, year);
  if (!mm) return;
  const keepWeekday = spliceMention(newText, mm.mention, mm.nearestMatchingText);
  const keepDate = spliceMention(newText, mm.mention, mm.correctedWeekdayText);
  const human = formatDate(withYear(mm.date, year), { ...mm.mention.format, weekday: "none", kind: "text-dmy", month: "long", year: "4", sep: " ", yearSep: " ", dayOrdinal: false, dayPad: false, monthDot: false, textCase: "title" });
  fail(`${human} is a ${mm.actualWeekday}, not a ${mm.statedWeekday}. Ask which one they mean: "${keepWeekday}" or "${keepDate}".`, {
    errorCode: "weekday_mismatch",
    statusCode: 422,
    details: {
      stated: mm.statedWeekday,
      actual: mm.actualWeekday,
      options: [
        { text: keepWeekday, keeps: "weekday" },
        { text: keepDate, keeps: "date" },
      ],
    },
  });
}

export interface PlannedPatch {
  page: number;
  rect: Rect;
  target: Rect;
  oldText: string;
  newText: string;
  fontFamily: PatchRow["fontFamily"];
  bold: boolean;
  fontSize: number;
  originalFontSize: number;
  align: Align;
}

/** Sizes a new label: target + bleed, widened to fit newText at the original size. */
export function planPatch(doc: DocRow, pageIndex: number, target: Rect, newText: string, opts: { oldText?: string | undefined; align?: Align | undefined } = {}): PlannedPatch {
  const page = requirePage(doc, pageIndex);
  const line = primaryLine(page, target);
  const fontSize = line ? line.fontSize : Math.max(6, Math.round(target.h * 0.7 * 4) / 4);
  const family = line?.fontFamily ?? "sans";
  const bold = line?.bold ?? false;
  const atLineEnd = line ? Math.abs(line.x + line.w - (target.x + target.w)) < 1.5 : false;
  const maxRight = Math.max(0, ...page.lines.map((l) => l.x + l.w));
  const rightish = line ? maxRight - (line.x + line.w) <= 6 && line.x > page.width * 0.45 : false;
  const align: Align = opts.align ?? (atLineEnd && rightish ? "right" : "left");
  const rect = inflate(target, BLEED);
  const need = neededWidth(newText, fontSize, family, bold, scaledMeasure(widthScale(line))) + 2 * BLEED;
  if (need > rect.w) {
    const extra = need - rect.w;
    if (align === "right") rect.x -= extra;
    else if (align === "center") rect.x -= extra / 2;
    rect.w = need;
  }
  const oldText = opts.oldText ?? (line ? textUnder(line, target, measureText) : "");
  return {
    page: pageIndex,
    rect: rectRound(rect),
    target: rectRound(target),
    oldText,
    newText,
    fontFamily: family,
    bold,
    fontSize,
    originalFontSize: fontSize,
    align,
  };
}

/** Inserts a planned patch and re-checks its page. Use inside a transaction. */
export async function insertPatch(db: Db, doc: DocRow, plan: PlannedPatch, who: { email: string; orgId: string | null }, source: "user" | "agent"): Promise<PatchRow> {
  const id = crypto.randomUUID();
  const page = requirePage(doc, plan.page);
  const ev = evaluatePatch(page, { id, ...plan }, [], []);
  await db.insert(schema.patches).values({
    id,
    documentId: doc.id,
    ...plan,
    textColor: ev.textColor,
    bgColor: ev.bgColor,
    border: ev.border,
    layout: ev.layout,
    status: ev.status,
    warnings: ev.warnings,
    source,
    ownerEmail: who.email,
    orgId: doc.orgId ?? who.orgId,
  });
  const rows = await recheckPage(db, doc, plan.page);
  return rows.find((r) => r.id === id)!;
}

export function summarize(row: Pick<PatchRow, "status" | "warnings">) {
  return {
    status: row.status,
    warnings: row.warnings.filter((w) => w.level !== "info").map((w) => w.message),
  };
}
