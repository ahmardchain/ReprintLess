import {
  compareYmd,
  findDates,
  formatDate,
  sameDate,
  toIsoDate,
  weekdayMismatches,
  withYear,
  type YMD,
} from "./dates";
import { subLineRect } from "./find";
import { overlaps, round2 } from "./geometry";
import {
  adjustPrice,
  comboParts,
  comboRelation,
  findPrices,
  formatPrice,
  normalizeName,
  type PriceMention,
} from "./prices";
import type { Line, Measure, Rect } from "./types";

export type SuggestionKind = "related" | "weekday" | "past_date" | "combo" | "currency";
export type Severity = "error" | "warn" | "info";

export interface SuggestionDraft {
  kind: SuggestionKind;
  severity: Severity;
  page: number;
  target: Rect;
  oldText: string;
  suggestedText: string;
  message: string;
}

export interface PatchLike {
  page: number;
  target: Rect;
  oldText: string;
  newText: string;
}

interface Doc {
  pages: { lines: Line[] }[];
}

function underPatch(patches: PatchLike[], page: number, rect: Rect) {
  return patches.some((p) => p.page === page && overlaps(p.target, rect, 0.5));
}

/** The year most dates in the document use, else `fallback`. */
export function documentYear(doc: Doc, fallback: number): number {
  const counts = new Map<number, number>();
  for (const page of doc.pages)
    for (const line of page.lines)
      for (const m of findDates(line.text))
        if (m.date.y) counts.set(m.date.y, (counts.get(m.date.y) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : fallback;
}

const fmtHuman = (d: YMD) =>
  formatDate(d, {
    kind: "text-dmy",
    weekday: "long",
    weekdayDot: false,
    weekdaySep: " ",
    dayOrdinal: false,
    dayPad: false,
    month: "long",
    monthDot: false,
    monthPad: false,
    year: "4",
    sep: " ",
    yearSep: " ",
    order: "dmy",
    textCase: "title",
  });

/** Widens [start, end) over punctuation glued to the mention ("5/12/2026!"). */
export function withAttachedPunctuation(text: string, start: number, end: number) {
  let s = start;
  let e = end;
  while (s > 0 && /[("'“‘\[]/.test(text[s - 1] ?? "")) s--;
  while (e < text.length && /[!?.,;:)"'”’\]]/.test(text[e] ?? "")) e++;
  return { start: s, end: e, before: text.slice(s, start), after: text.slice(end, e) };
}

export function relatedSuggestions(doc: Doc, patches: PatchLike[], measure: Measure, year: number): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  for (const patch of patches) {
    const oldDates = findDates(patch.oldText);
    const newDates = findDates(patch.newText);
    if (oldDates.length === 1 && newDates.length === 1) {
      const od = oldDates[0]!.date;
      const nd = newDates[0]!.date;
      const newDate: YMD = { y: nd.y ?? od.y ?? year, m: nd.m, d: nd.d };
      doc.pages.forEach((page, pageIndex) => {
        for (const line of page.lines) {
          for (const mention of findDates(line.text)) {
            if (!sameDate(mention.date, withYear(od, od.y ?? year))) continue;
            const span = withAttachedPunctuation(line.text, mention.start, mention.end);
            const bbox = subLineRect(line, span.start, span.end, measure);
            if (underPatch(patches, pageIndex, bbox)) continue;
            const suggested = formatDate(newDate, mention.format);
            if (suggested === mention.text) continue;
            out.push({
              kind: "related",
              severity: "error",
              page: pageIndex,
              target: bbox,
              oldText: span.before + mention.text + span.after,
              suggestedText: span.before + suggested + span.after,
              message: `"${line.text}" still has the old date ${mention.text}. In this line's format the new date is ${suggested}.`,
            });
          }
        }
      });
      continue;
    }
    const old = patch.oldText.trim();
    if (old.length < 3 || old === patch.newText.trim()) continue;
    doc.pages.forEach((page, pageIndex) => {
      for (const line of page.lines) {
        let from = 0;
        for (;;) {
          const at = line.text.indexOf(old, from);
          if (at < 0) break;
          from = at + old.length;
          const bbox = subLineRect(line, at, at + old.length, measure);
          if (underPatch(patches, pageIndex, bbox)) continue;
          out.push({
            kind: "related",
            severity: "warn",
            page: pageIndex,
            target: bbox,
            oldText: old,
            suggestedText: patch.newText.trim(),
            message: `"${line.text}" also says "${old}", which you corrected elsewhere.`,
          });
        }
      }
    });
  }
  return dedupe(out);
}

export function weekdaySuggestions(doc: Doc, patches: PatchLike[], measure: Measure, year: number): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  doc.pages.forEach((page, pageIndex) => {
    for (const line of page.lines) {
      for (const mm of weekdayMismatches(line.text, year)) {
        const bbox = subLineRect(line, mm.mention.start, mm.mention.end, measure);
        if (underPatch(patches, pageIndex, bbox)) continue;
        out.push({
          kind: "weekday",
          severity: "error",
          page: pageIndex,
          target: bbox,
          oldText: mm.mention.text,
          suggestedText: mm.correctedWeekdayText,
          message: `${mm.mention.text} doesn't add up: ${fmtHuman(mm.date).replace(/^\w+ /, "")} is a ${mm.actualWeekday}. Either "${mm.correctedWeekdayText}" or "${mm.nearestMatchingText}".`,
        });
      }
    }
  });
  return out;
}

export function pastDateSuggestions(doc: Doc, patches: PatchLike[], measure: Measure, year: number, today: YMD): SuggestionDraft[] {
  const out: SuggestionDraft[] = [];
  const check = (text: string, page: number, rect: Rect | null, line?: Line) => {
    for (const m of findDates(text)) {
      const d = withYear(m.date, year);
      if (compareYmd(d, today) >= 0) continue;
      const target = rect ?? subLineRect(line!, m.start, m.end, measure);
      if (!rect && underPatch(patches, page, target)) continue;
      out.push({
        kind: "past_date",
        severity: "warn",
        page,
        target,
        oldText: m.text,
        suggestedText: "",
        message: `${m.text} is in the past (today is ${toIsoDate(today)}). Is that intended?`,
      });
    }
  };
  doc.pages.forEach((page, pageIndex) => {
    for (const line of page.lines) check(line.text, pageIndex, null, line);
  });
  for (const p of patches) check(p.newText, p.page, p.target);
  return out;
}

interface RowItem {
  name: string;
  page: number;
  price: PriceMention;
  bbox: Rect;
  now: number;
}

/** Menu-like rows: a name and a price on the same baseline. */
export function menuRows(doc: Doc, patches: PatchLike[], measure: Measure): RowItem[] {
  const rows: RowItem[] = [];
  doc.pages.forEach((page, pageIndex) => {
    const lines = [...page.lines].sort((a, b) => a.y - b.y || a.x - b.x);
    const used = new Set<string>();
    for (const line of lines) {
      if (used.has(line.id)) continue;
      const mid = line.y + line.h / 2;
      const row = lines.filter((l) => Math.abs(l.y + l.h / 2 - mid) <= Math.max(2, l.h * 0.3));
      row.forEach((l) => used.add(l.id));
      row.sort((a, b) => a.x - b.x);
      let priceLine: Line | null = null;
      let price: PriceMention | null = null;
      for (const l of row) {
        const ps = findPrices(l.text);
        if (ps.length) {
          priceLine = l;
          price = ps[ps.length - 1] ?? null;
        }
      }
      if (!priceLine || !price) continue;
      const nameText = row
        .map((l) => (l === priceLine ? l.text.slice(0, price!.start) : l.text))
        .join(" ")
        .replace(/[.\s·…]+$/, "")
        .trim();
      if (!nameText) continue;
      const bbox = subLineRect(priceLine, price.start, price.end, measure);
      const patched = patches.find((p) => p.page === pageIndex && overlaps(p.target, bbox, 0.5));
      const newPrice = patched ? findPrices(patched.newText)[0] : undefined;
      rows.push({ name: nameText, page: pageIndex, price, bbox, now: newPrice ? newPrice.minor : price.minor });
    }
  });
  return rows;
}

export function comboSuggestions(doc: Doc, patches: PatchLike[], measure: Measure): SuggestionDraft[] {
  const rows = menuRows(doc, patches, measure);
  const byName = new Map(rows.map((r) => [normalizeName(r.name), r]));
  const out: SuggestionDraft[] = [];
  for (const row of rows) {
    const parts = comboParts(row.name);
    if (!parts) continue;
    const items = parts.map((p) => byName.get(normalizeName(p)));
    if (items.some((i) => !i)) continue;
    const found = items as RowItem[];
    const before = comboRelation(row.price.minor, found.map((i) => i.price.minor));
    const after = comboRelation(row.now, found.map((i) => i.now));
    if (before.relation === after.relation) continue;
    const suggestedMinor = after.sum + before.diff;
    const fmt = (n: number) => formatPrice(n, row.price);
    const names = found.map((i) => i.name).join(" + ");
    const was =
      before.relation === "equal"
        ? `used to equal ${names} (${found.map((i) => fmt(i.price.minor)).join(" + ")} = ${fmt(before.sum)})`
        : `used to be ${fmt(Math.abs(before.diff))} ${before.relation === "cheaper" ? "cheaper" : "dearer"} than ${names}`;
    const patchedCombo = row.now !== row.price.minor;
    out.push({
      kind: "combo",
      severity: "warn",
      page: row.page,
      target: row.bbox,
      oldText: patchedCombo ? fmt(row.now) : row.price.text,
      suggestedText: fmt(suggestedMinor),
      message: `"${row.name}" ${was}. Now ${found.map((i) => fmt(i.now)).join(" + ")} = ${fmt(after.sum)}, but the combo is ${fmt(row.now)}.`,
    });
  }
  return out;
}

export function currencySuggestions(doc: Doc, patches: PatchLike[], measure: Measure): SuggestionDraft[] {
  const all: { page: number; line: Line; m: PriceMention }[] = [];
  doc.pages.forEach((page, pageIndex) => {
    for (const line of page.lines) for (const m of findPrices(line.text)) all.push({ page: pageIndex, line, m });
  });
  const counts = new Map<string, number>();
  for (const a of all) counts.set(a.m.symbol, (counts.get(a.m.symbol) ?? 0) + 1);
  if (counts.size < 2) return [];
  const major = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "₦";
  const style = all.find((a) => a.m.symbol === major)!.m;
  const out: SuggestionDraft[] = [];
  for (const a of all) {
    if (a.m.symbol === major) continue;
    const bbox = subLineRect(a.line, a.m.start, a.m.end, measure);
    if (underPatch(patches, a.page, bbox)) continue;
    const sameCurrency = (a.m.symbol === "N" && major === "₦") || (a.m.symbol === "₦" && major === "N");
    out.push({
      kind: "currency",
      severity: sameCurrency ? "warn" : "info",
      page: a.page,
      target: bbox,
      oldText: a.m.text,
      suggestedText: formatPrice(a.m.minor, { ...a.m, symbol: major as PriceMention["symbol"], gap: style.gap }),
      message: `"${a.m.text}" uses ${a.m.symbol} but most prices use ${major}.`,
    });
  }
  return out;
}

function dedupe(list: SuggestionDraft[]): SuggestionDraft[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const key = `${s.kind}:${s.page}:${round2(s.target.x)}:${round2(s.target.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function checkDocument(doc: Doc, patches: PatchLike[], measure: Measure, today: YMD): SuggestionDraft[] {
  const year = documentYear(doc, today.y ?? 2026);
  return [
    ...relatedSuggestions(doc, patches, measure, year),
    ...weekdaySuggestions(doc, patches, measure, year),
    ...pastDateSuggestions(doc, patches, measure, year, today),
    ...comboSuggestions(doc, patches, measure),
    ...currencySuggestions(doc, patches, measure),
  ];
}

export interface PriceEdit {
  page: number;
  target: Rect;
  oldText: string;
  newText: string;
  align: "left" | "right";
  lineId: string;
}

/** Plans a percentage change for every price in the document. */
export function planPriceEdits(
  doc: { pages: { lines: Line[]; width: number }[] },
  percent: number,
  roundTo: number,
  measure: Measure,
): PriceEdit[] {
  const out: PriceEdit[] = [];
  doc.pages.forEach((page, pageIndex) => {
    const maxRight = Math.max(0, ...page.lines.map((l) => l.x + l.w));
    for (const line of page.lines) {
      for (const m of findPrices(line.text)) {
        const next = adjustPrice(m.minor, percent, roundTo);
        if (next === m.minor) continue;
        const target = subLineRect(line, m.start, m.end, measure);
        const atLineEnd = line.text.slice(m.end).trim() === "";
        const atRightEdge = maxRight - (line.x + line.w) <= 6 || line.x > page.width / 2;
        out.push({
          page: pageIndex,
          target,
          oldText: m.text,
          newText: formatPrice(next, m),
          align: atLineEnd && atRightEdge ? "right" : "left",
          lineId: line.id,
        });
      }
    }
  });
  return out;
}
