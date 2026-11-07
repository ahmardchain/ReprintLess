/**
 * Prices in printed text: parse, compute with integer minor units, round,
 * and format back in the original style.
 */

export type CurrencySymbol = "₦" | "N" | "$" | "£" | "€";

export interface PriceMention {
  start: number;
  end: number;
  text: string;
  symbol: CurrencySymbol;
  /** Amount in minor units (kobo, cents). */
  minor: number;
  decimals: 0 | 2;
  commas: boolean;
  /** Whitespace between the symbol and the digits ("" or " "). */
  gap: string;
}

// "N" only counts as Naira when directly followed by digits (N2,300).
const RE_PRICE =
  /(?<![\p{L}\d])(₦|\$|£|€|N(?=\s?\d))(\s?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?![\d,]*\d)/gu;

export function findPrices(text: string): PriceMention[] {
  const out: PriceMention[] = [];
  for (const m of text.matchAll(RE_PRICE)) {
    const [whole, symbol, gap, digits, cents] = m;
    const units = Number(digits.replace(/,/g, ""));
    out.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + whole.length,
      text: whole,
      symbol: symbol as CurrencySymbol,
      minor: units * 100 + (cents ? Number(cents) : 0),
      decimals: cents ? 2 : 0,
      commas: digits.includes(","),
      gap,
    });
  }
  return out;
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats `minor` like `style` (symbol, spacing, commas, decimals). */
export function formatPrice(
  minor: number,
  style: Pick<PriceMention, "symbol" | "gap" | "commas" | "decimals">,
): string {
  const units = Math.floor(Math.abs(minor) / 100);
  const cents = Math.abs(minor) % 100;
  const commas = style.commas || units >= 10000;
  let s = commas ? groupThousands(units) : String(units);
  if (style.decimals === 2) s += "." + String(cents).padStart(2, "0");
  return (minor < 0 ? "-" : "") + style.symbol + style.gap + s;
}

/**
 * Applies a percentage change and rounds to the nearest `roundTo` major
 * units (e.g. 50 → nearest ₦50). Exact integer arithmetic on minor units.
 */
export function adjustPrice(minor: number, percent: number, roundTo: number): number {
  // percent may have up to 2 decimals; scale to avoid floating error.
  const pct = Math.round(percent * 100); // basis points * 1
  const raised = (minor * (10000 + pct)) / 10000;
  const step = Math.max(1, Math.round(roundTo * 100));
  return Math.round(raised / step) * step;
}

export interface ComboRelation {
  combo: number;
  sum: number;
  /** combo - sum, in minor units. */
  diff: number;
  relation: "equal" | "cheaper" | "dearer";
}

export function comboRelation(combo: number, parts: number[]): ComboRelation {
  const sum = parts.reduce((a, b) => a + b, 0);
  const diff = combo - sum;
  return {
    combo,
    sum,
    diff,
    relation: diff === 0 ? "equal" : diff < 0 ? "cheaper" : "dearer",
  };
}

/** Splits "Combo: Jollof Rice + Chicken" into its item names. */
export function comboParts(name: string): string[] | null {
  const m = name.match(/^\s*(?:combo|meal deal|set|bundle)\b\s*[:\-–]?\s*(.+)$/i);
  if (!m) return null;
  const parts = m[1]
    .split(/\s*(?:\+|&|\band\b|\bwith\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.·…:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
