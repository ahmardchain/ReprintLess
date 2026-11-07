import { describe, expect, it } from "vitest";

import { measureText as measure } from "../../server/lib/fonts";
import { checkDocument, planPriceEdits } from "./check";
import { findText } from "./find";
import { makeLine } from "./test-fixtures";

const today = { y: 2026, m: 11, d: 7 };

describe("check-document", () => {
  const flyer = {
    pages: [
      {
        width: 595,
        lines: [
          makeLine(measure, "date", "Saturday, 5 December 2026", 48, 200, 20, true),
          makeLine(measure, "doors", "Doors open 3:30 PM", 48, 228, 14),
          makeLine(measure, "foot", "See you on 5/12/2026! · Free entry", 48, 800, 11),
          makeLine(measure, "teaser", "Sat 5 Dec · Bring a friend", 48, 820, 11),
        ],
      },
    ],
  };
  const dateMatch = findText(flyer.pages, "Saturday, 5 December 2026", measure)[0]!;
  const patch = { page: 0, target: dateMatch.bbox, oldText: "Saturday, 5 December 2026", newText: "Saturday, 12 December 2026" };

  it("finds the old date in other formats and re-formats the new one", () => {
    const related = checkDocument(flyer, [patch], measure, today).filter((s) => s.kind === "related");
    expect(related.map((s) => [s.oldText, s.suggestedText])).toEqual([
      ["5/12/2026!", "12/12/2026!"],
      ["Sat 5 Dec", "Sat 12 Dec"],
    ]);
    const foot = related[0]!;
    const expectedX = 48 + measure("See you on ", "sans", false, 11);
    expect(foot.target.x).toBeCloseTo(expectedX, 1);
  });

  it("flags weekday mismatches and past dates", () => {
    const doc = { pages: [{ width: 595, lines: [makeLine(measure, "a", "Saturday, 14 December 2026", 40, 100, 12), makeLine(measure, "b", "Last show 3 March 2025", 40, 130, 12)] }] };
    const found = checkDocument(doc, [], measure, today);
    const wd = found.find((s) => s.kind === "weekday")!;
    expect(wd.message).toContain("Monday");
    expect(wd.message).toContain("Saturday, 12 December 2026");
    expect(found.some((s) => s.kind === "past_date" && s.oldText === "3 March 2025")).toBe(true);
  });

  const menu = {
    pages: [
      {
        width: 595,
        lines: [
          makeLine(measure, "n1", "Jollof Rice", 60, 200, 13),
          makeLine(measure, "p1", "₦2,300", 480, 200, 13),
          makeLine(measure, "n2", "Chicken", 60, 230, 13),
          makeLine(measure, "p2", "₦1,800", 480, 230, 13),
          makeLine(measure, "n3", "Combo: Jollof Rice + Chicken", 60, 260, 13, true),
          makeLine(measure, "p3", "₦4,100", 480, 260, 13, true),
          makeLine(measure, "n4", "Zobo", 60, 290, 13),
          makeLine(measure, "p4", "N500", 480, 290, 13),
        ],
      },
    ],
  };

  it("plans +10% to the nearest ₦50 and flags the broken combo", () => {
    const edits = planPriceEdits(menu, 10, 50, measure);
    expect(edits.map((e) => `${e.oldText}→${e.newText}:${e.align}`)).toEqual([
      "₦2,300→₦2,550:right",
      "₦1,800→₦2,000:right",
      "₦4,100→₦4,500:right",
      "N500→N550:right",
    ]);
    const combo = checkDocument(menu, edits, measure, today).find((s) => s.kind === "combo")!;
    expect(combo.suggestedText).toBe("₦4,550");
    expect(combo.message).toContain("₦4,500");
  });

  it("flags mixed currency symbols", () => {
    const cur = checkDocument(menu, [], measure, today).filter((s) => s.kind === "currency");
    expect(cur.map((s) => [s.oldText, s.suggestedText])).toEqual([["N500", "₦500"]]);
  });
});
