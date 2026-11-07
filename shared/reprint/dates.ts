/**
 * Date mentions in printed text: find them in any common format, compare
 * them, check weekdays, and re-format a new date in a mention's own format.
 * Numeric dates are read day-first (D/M/Y) by default.
 */

export interface YMD {
  y: number | null;
  m: number;
  d: number;
}

export type TextCase = "title" | "upper" | "lower";

export interface DateFormat {
  kind: "text-dmy" | "text-mdy" | "numeric";
  weekday: "none" | "long" | "short";
  weekdayDot: boolean;
  /** Between the weekday and the rest, e.g. ", " or " ". */
  weekdaySep: string;
  dayOrdinal: boolean;
  dayPad: boolean;
  month: "long" | "short" | "num";
  monthDot: boolean;
  monthPad: boolean;
  year: "none" | "4" | "2";
  /** Text: between day and month (" ", " of "); numeric: "/", ".", "-". */
  sep: string;
  /** Text formats: between the day/month part and the year (" ", ", "). */
  yearSep: string;
  order: "dmy" | "mdy" | "ymd";
  textCase: TextCase;
}

export interface DateMention {
  start: number;
  end: number;
  text: string;
  date: YMD;
  /** 0 = Sunday … 6 = Saturday, when the mention names a weekday. */
  weekday: number | null;
  format: DateFormat;
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WD_ALIASES: Record<string, number> = {};
WEEKDAYS.forEach((name, i) => {
  WD_ALIASES[name.toLowerCase()] = i;
  WD_ALIASES[name.slice(0, 3).toLowerCase()] = i;
});
Object.assign(WD_ALIASES, { tues: 2, weds: 3, thur: 4, thurs: 4 });

const MON_ALIASES: Record<string, number> = {};
MONTHS.forEach((name, i) => {
  MON_ALIASES[name.toLowerCase()] = i + 1;
  MON_ALIASES[name.slice(0, 3).toLowerCase()] = i + 1;
});
MON_ALIASES.sept = 9;

const WD = `(${Object.keys(WD_ALIASES)
  .sort((a, b) => b.length - a.length)
  .join("|")})`;
const MON = `(${Object.keys(MON_ALIASES)
  .sort((a, b) => b.length - a.length)
  .join("|")})`;

// Text, day first: "Saturday, 5 December 2026", "Sat 5 Dec", "5th December".
const RE_TEXT_DMY = new RegExp(
  `(?<![\\p{L}\\d])(?:${WD}(\\.?)(,?\\s+))?(\\d{1,2})(st|nd|rd|th)?(\\s+(?:of\\s+)?)${MON}(\\.?)(?:(,?\\s+)(\\d{4}))?(?![\\p{L}\\d])`,
  "giu",
);
// Text, month first: "December 5, 2026", "Sat, Dec 5".
const RE_TEXT_MDY = new RegExp(
  `(?<![\\p{L}\\d])(?:${WD}(\\.?)(,?\\s+))?${MON}(\\.?)(\\s+)(\\d{1,2})(st|nd|rd|th)?(?:(,?\\s+)(\\d{4}))?(?![\\p{L}\\d])`,
  "giu",
);
// Numeric, day first: "5/12/2026", "05.12.26", "5-12-2026".
const RE_NUM_DMY = new RegExp(
  `(?<![\\p{L}\\d/.\\-])(?:${WD}(\\.?)(,?\\s+))?(\\d{1,2})([./-])(\\d{1,2})\\5(\\d{4}|\\d{2})(?![\\d]|[./-]\\d)`,
  "giu",
);
// ISO: "2026-12-05".
const RE_ISO = new RegExp(
  `(?<![\\p{L}\\d/.\\-])(?:${WD}(\\.?)(,?\\s+))?(\\d{4})-(\\d{1,2})-(\\d{1,2})(?![\\d]|[./-]\\d)`,
  "giu",
);

export function daysInMonth(y: number | null, m: number): number {
  if (m === 2) {
    if (y === null) return 29;
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function valid(date: YMD): boolean {
  return (
    date.m >= 1 &&
    date.m <= 12 &&
    date.d >= 1 &&
    date.d <= daysInMonth(date.y, date.m)
  );
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function caseOf(token: string): TextCase {
  if (token.length > 1 && token === token.toUpperCase()) return "upper";
  if (token === token.toLowerCase()) return "lower";
  return "title";
}

function applyCase(word: string, c: TextCase): string {
  if (c === "upper") return word.toUpperCase();
  if (c === "lower") return word.toLowerCase();
  return word;
}

function isLongMonth(token: string): boolean {
  return MONTHS.some((n) => n.toLowerCase() === token.toLowerCase());
}

function isPadded(token: string): boolean {
  return token.length === 2 && token.startsWith("0");
}

function baseFormat(): DateFormat {
  return {
    kind: "numeric",
    weekday: "none",
    weekdayDot: false,
    weekdaySep: ", ",
    dayOrdinal: false,
    dayPad: false,
    month: "num",
    monthDot: false,
    monthPad: false,
    year: "none",
    sep: "/",
    yearSep: " ",
    order: "dmy",
    textCase: "title",
  };
}

function weekdayPart(fmt: DateFormat, wdToken?: string, dot?: string, sep?: string) {
  if (!wdToken) return null;
  fmt.weekday = wdToken.length > 4 ? "long" : "short";
  fmt.weekdayDot = !!dot;
  fmt.weekdaySep = sep ?? " ";
  fmt.textCase = caseOf(wdToken);
  return WD_ALIASES[wdToken.toLowerCase()];
}

/** Finds every date mention in `text`, left to right, without overlaps. */
export function findDates(text: string): DateMention[] {
  const found: DateMention[] = [];

  for (const m of text.matchAll(RE_TEXT_DMY)) {
    const [, wd, wdDot, wdSep, day = "", ord, sep = " ", mon = "", monDot, ySep, year] = m;
    const fmt = baseFormat();
    fmt.kind = "text-dmy";
    const weekday = weekdayPart(fmt, wd, wdDot, wdSep);
    fmt.dayOrdinal = !!ord;
    fmt.dayPad = isPadded(day);
    fmt.month = isLongMonth(mon) ? "long" : "short";
    fmt.monthDot = !!monDot;
    fmt.sep = sep;
    fmt.yearSep = ySep ?? " ";
    fmt.year = year ? "4" : "none";
    if (!wd) fmt.textCase = caseOf(mon);
    const date: YMD = {
      y: year ? Number(year) : null,
      m: MON_ALIASES[mon.toLowerCase()] ?? 0,
      d: Number(day),
    };
    if (valid(date)) push(found, m, date, weekday ?? null, fmt);
  }

  for (const m of text.matchAll(RE_TEXT_MDY)) {
    const [, wd, wdDot, wdSep, mon = "", monDot, sep = " ", day = "", ord, ySep, year] = m;
    const fmt = baseFormat();
    fmt.kind = "text-mdy";
    fmt.order = "mdy";
    const weekday = weekdayPart(fmt, wd, wdDot, wdSep);
    fmt.dayOrdinal = !!ord;
    fmt.dayPad = isPadded(day);
    fmt.month = isLongMonth(mon) ? "long" : "short";
    fmt.monthDot = !!monDot;
    fmt.sep = sep;
    fmt.yearSep = ySep ?? ", ";
    fmt.year = year ? "4" : "none";
    if (!wd) fmt.textCase = caseOf(mon);
    const date: YMD = {
      y: year ? Number(year) : null,
      m: MON_ALIASES[mon.toLowerCase()] ?? 0,
      d: Number(day),
    };
    if (valid(date)) push(found, m, date, weekday ?? null, fmt);
  }

  for (const m of text.matchAll(RE_NUM_DMY)) {
    const [, wd, wdDot, wdSep, day = "", sep = "/", mon = "", year = ""] = m;
    const fmt = baseFormat();
    const weekday = weekdayPart(fmt, wd, wdDot, wdSep);
    fmt.sep = sep;
    fmt.dayPad = isPadded(day);
    fmt.monthPad = isPadded(mon);
    // An unpadded day tells us the writer doesn't pad; mirror it on months >= 10.
    if (Number(mon) >= 10) fmt.monthPad = fmt.dayPad;
    if (Number(day) >= 10) fmt.dayPad = fmt.monthPad;
    fmt.year = year.length === 4 ? "4" : "2";
    const date: YMD = {
      y: year.length === 4 ? Number(year) : 2000 + Number(year),
      m: Number(mon),
      d: Number(day),
    };
    if (valid(date)) push(found, m, date, weekday ?? null, fmt);
  }

  for (const m of text.matchAll(RE_ISO)) {
    const [, wd, wdDot, wdSep, year = "", mon = "", day = ""] = m;
    const fmt = baseFormat();
    const weekday = weekdayPart(fmt, wd, wdDot, wdSep);
    fmt.order = "ymd";
    fmt.sep = "-";
    fmt.dayPad = day.length === 2;
    fmt.monthPad = mon.length === 2;
    fmt.year = "4";
    const date: YMD = { y: Number(year), m: Number(mon), d: Number(day) };
    if (valid(date)) push(found, m, date, weekday ?? null, fmt);
  }

  // Keep the longest match at each position; drop overlapping shorter ones.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: DateMention[] = [];
  for (const f of found) {
    const last = out[out.length - 1];
    if (last && f.start < last.end) continue;
    out.push(f);
  }
  return out;
}

function push(
  out: DateMention[],
  m: RegExpMatchArray,
  date: YMD,
  weekday: number | null,
  format: DateFormat,
) {
  const start = m.index ?? 0;
  out.push({
    start,
    end: start + m[0].length,
    text: m[0],
    date,
    weekday,
    format,
  });
}

export function ordinal(d: number): string {
  if (d % 100 >= 11 && d % 100 <= 13) return `${d}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[d % 10] ?? "th";
  return `${d}${suffix}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Renders `date` exactly in `fmt`; the year falls back to `date.y`. */
export function formatDate(date: YMD, fmt: DateFormat): string {
  const y = date.y;
  let out = "";
  if (fmt.weekday !== "none" && y !== null) {
    const name = WEEKDAYS[weekdayOf(y, date.m, date.d)]!;
    const wd = fmt.weekday === "long" ? name : name.slice(0, 3);
    out += applyCase(wd, fmt.textCase) + (fmt.weekdayDot ? "." : "") + fmt.weekdaySep;
  }
  const day = fmt.dayOrdinal
    ? ordinal(date.d)
    : fmt.dayPad
      ? pad2(date.d)
      : String(date.d);
  if (fmt.kind === "numeric") {
    const mon = fmt.monthPad ? pad2(date.m) : String(date.m);
    const yr = y === null ? "" : fmt.year === "2" ? pad2(y % 100) : String(y);
    if (fmt.order === "ymd") return out + [yr, mon, day].join(fmt.sep);
    return out + [day, mon, yr].join(fmt.sep);
  }
  const monName = MONTHS[date.m - 1]!;
  const mon =
    applyCase(fmt.month === "long" ? monName : monName.slice(0, 3), fmt.textCase) +
    (fmt.monthDot ? "." : "");
  const yearPart = fmt.year !== "none" && y !== null ? fmt.yearSep + y : "";
  if (fmt.kind === "text-mdy") return out + mon + fmt.sep + day + yearPart;
  return out + day + fmt.sep + mon + yearPart;
}

export function sameDate(a: YMD, b: YMD): boolean {
  return a.m === b.m && a.d === b.d && (a.y === null || b.y === null || a.y === b.y);
}

/** Fills a missing year from context. */
export function withYear(date: YMD, year: number): YMD {
  return date.y === null ? { ...date, y: year } : date;
}

export function toIsoDate(date: YMD): string {
  return `${date.y}-${pad2(date.m)}-${pad2(date.d)}`;
}

export function compareYmd(a: YMD, b: YMD): number {
  return (a.y ?? 0) - (b.y ?? 0) || a.m - b.m || a.d - b.d;
}

export function addDays(date: YMD, days: number): YMD {
  const t = new Date(Date.UTC(date.y ?? 2000, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export interface WeekdayMismatch {
  mention: DateMention;
  date: YMD;
  /** The weekday the text names. */
  statedWeekday: string;
  /** The weekday the date really falls on. */
  actualWeekday: string;
  /** Option 1: the nearest date that falls on the stated weekday. */
  nearestMatching: YMD;
  nearestMatchingText: string;
  /** Option 2: the same date with its correct weekday. */
  correctedWeekdayText: string;
}

/**
 * Checks every mention that names a weekday. Yearless mentions use
 * `assumeYear`. Returns one entry per mismatch.
 */
export function weekdayMismatches(
  text: string,
  assumeYear: number,
): WeekdayMismatch[] {
  const out: WeekdayMismatch[] = [];
  for (const mention of findDates(text)) {
    if (mention.weekday === null) continue;
    const date = withYear(mention.date, assumeYear);
    const actual = weekdayOf(date.y!, date.m, date.d);
    if (actual === mention.weekday) continue;
    const forward = (mention.weekday - actual + 7) % 7;
    const backward = 7 - forward;
    const nearest = addDays(date, forward <= backward ? forward : -backward);
    const keepYear = nearest;
    out.push({
      mention,
      date,
      statedWeekday: WEEKDAYS[mention.weekday]!,
      actualWeekday: WEEKDAYS[actual]!,
      nearestMatching: keepYear,
      nearestMatchingText: formatDate(keepYear, mention.format),
      correctedWeekdayText: formatDate(date, mention.format),
    });
  }
  return out;
}

/** Replaces the mention inside `text` with `replacement`. */
export function spliceMention(text: string, mention: DateMention, replacement: string) {
  return text.slice(0, mention.start) + replacement + text.slice(mention.end);
}
