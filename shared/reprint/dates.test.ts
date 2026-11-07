import { describe, expect, it } from "vitest";

import { findDates, formatDate, weekdayMismatches, weekdayOf } from "./dates";

const one = (s: string) => {
  const found = findDates(s);
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("findDates", () => {
  it.each([
    ["Saturday, 5 December 2026", { y: 2026, m: 12, d: 5 }, 6],
    ["Sat 5 Dec", { y: null, m: 12, d: 5 }, 6],
    ["5/12/2026", { y: 2026, m: 12, d: 5 }, null],
    ["05.12.26", { y: 2026, m: 12, d: 5 }, null],
    ["2026-12-05", { y: 2026, m: 12, d: 5 }, null],
    ["5th December", { y: null, m: 12, d: 5 }, null],
    ["December 5, 2026", { y: 2026, m: 12, d: 5 }, null],
  ])("parses %s", (text, date, weekday) => {
    const m = one(text);
    expect(m.text).toBe(text);
    expect(m.date).toEqual(date);
    expect(m.weekday).toBe(weekday);
  });

  it("finds dates inside sentences with offsets", () => {
    const text = "See you on 5/12/2026! · Free entry";
    const m = findDates(text)[0]!;
    expect(text.slice(m.start, m.end)).toBe("5/12/2026");
  });

  it("ignores times and prices", () => {
    expect(findDates("Doors open 3:30 PM · ₦2,300")).toHaveLength(0);
  });

  it("rejects impossible dates", () => {
    expect(findDates("31/02/2026")).toHaveLength(0);
  });
});

describe("formatDate re-formats in the mention's own format", () => {
  const next = { y: 2026, m: 12, d: 12 };
  it.each([
    ["Saturday, 5 December 2026", "Saturday, 12 December 2026"],
    ["Sat 5 Dec", "Sat 12 Dec"],
    ["5/12/2026", "12/12/2026"],
    ["05.12.26", "12.12.26"],
    ["2026-12-05", "2026-12-12"],
    ["5th December", "12th December"],
    ["December 5, 2026", "December 12, 2026"],
    ["SAT 5 DEC", "SAT 12 DEC"],
  ])("%s → %s", (source, expected) => {
    expect(formatDate(next, one(source).format)).toBe(expected);
  });

  it("pads like the source", () => {
    expect(formatDate({ y: 2027, m: 1, d: 3 }, one("05.12.26").format)).toBe("03.01.27");
    expect(formatDate({ y: 2027, m: 1, d: 3 }, one("5/12/2026").format)).toBe("3/1/2027");
  });

  it("uses correct ordinals", () => {
    const fmt = one("5th December").format;
    expect([1, 2, 3, 11, 12, 13, 21, 22, 23, 31].map((d) => formatDate({ y: 2026, m: 12, d }, fmt))).toEqual([
      "1st December",
      "2nd December",
      "3rd December",
      "11th December",
      "12th December",
      "13th December",
      "21st December",
      "22nd December",
      "23rd December",
      "31st December",
    ]);
  });
});

describe("weekday checker", () => {
  it("knows 14 December 2026 is a Monday and 5 December 2026 a Saturday", () => {
    expect(weekdayOf(2026, 12, 14)).toBe(1);
    expect(weekdayOf(2026, 12, 5)).toBe(6);
  });

  it("offers the nearest matching date and the corrected weekday", () => {
    const mm = weekdayMismatches("Saturday, 14 December 2026", 2026)[0]!;
    expect(mm.actualWeekday).toBe("Monday");
    expect(mm.statedWeekday).toBe("Saturday");
    expect(mm.nearestMatchingText).toBe("Saturday, 12 December 2026");
    expect(mm.correctedWeekdayText).toBe("Monday, 14 December 2026");
  });

  it("accepts correct weekdays and yearless mentions in context", () => {
    expect(weekdayMismatches("Saturday, 12 December 2026", 2026)).toHaveLength(0);
    expect(weekdayMismatches("Sat 5 Dec", 2026)).toHaveLength(0);
    expect(weekdayMismatches("Fri 5 Dec", 2026)).toHaveLength(1);
  });
});
