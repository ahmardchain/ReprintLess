import { describe, expect, it } from "vitest";

import { measureText as measure } from "../../server/lib/fonts";
import { checkFit, type FitContext } from "./fit";
import { findText } from "./find";
import { inflate, overlaps } from "./geometry";
import { reflowPatch } from "./reflow";
import { makeLine } from "./test-fixtures";
import type { LockGeometry, PatchGeometry } from "./types";

const date = makeLine(measure, "date", "Saturday, 5 December 2026", 48, 200, 20, true);
const venue = makeLine(measure, "venue", "UDUS Main Auditorium", date.x + date.w + 10, 200, 20, true);
const doors = makeLine(measure, "doors", "Doors open 3:30 PM", 48, 228, 14);
const lines = [date, venue, doors];
const page = { width: 595, height: 842 };

function patchFor(newText: string, widen = true): PatchGeometry {
  const target = { x: date.x, y: date.y, w: date.w, h: date.h };
  const rect = inflate(target, 2);
  if (widen) rect.w = Math.max(rect.w, measure(newText, "sans", true, 20) + 3 + 4);
  return { id: "p1", page: 0, rect, target, newText, fontFamily: "sans", bold: true, fontSize: 20, originalFontSize: 20, align: "left" };
}

const ctx = (locks: LockGeometry[] = []): FitContext => ({ lines, locks, patches: [], page, measure });

describe("find-text", () => {
  it("returns a sub-line bbox from runs and font measurement", () => {
    const [m] = findText([{ lines }], "December 2026", measure);
    expect(m.lineId).toBe("date");
    const expectedX = date.x + measure("Saturday, 5 ", "sans", true, 20);
    expect(m.bbox.x).toBeCloseTo(expectedX, 1);
    expect(m.bbox.w).toBeCloseTo(measure("December 2026", "sans", true, 20), 1);
  });
});

describe("fit check", () => {
  it("flags a widened date label that covers the venue", () => {
    const res = checkFit(patchFor("Saturday, 12 December 2026"), ctx());
    expect(res.status).toBe("error");
    expect(res.warnings.map((w) => w.code)).toContain("covers_text");
  });

  it("is ok when the text fits and nothing is covered", () => {
    const res = checkFit(patchFor("Saturday, 5 December 2026"), ctx());
    expect(res.status).toBe("ok");
    expect(res.layout.lines).toHaveLength(1);
  });

  it("warns when the font is shrunk below 85%", () => {
    const res = checkFit({ ...patchFor("Sat 12 Dec"), fontSize: 15 }, ctx());
    expect(res.status).toBe("warn");
    expect(res.warnings.map((w) => w.code)).toContain("shrunk");
  });
});

describe("reflow", () => {
  it("avoids the locked venue and picks a slight shrink", () => {
    const lock: LockGeometry = { id: "l1", page: 0, rect: inflate({ x: venue.x, y: venue.y, w: venue.w, h: venue.h }, 1), label: "Venue" };
    const patch = patchFor("Saturday, 12 December 2026");
    const res = reflowPatch(patch, ctx([lock]));
    expect(res.changed).toBe(true);
    expect(overlaps(res.rect, lock.rect)).toBe(false);
    expect(overlaps(res.rect, { x: venue.x, y: venue.y, w: venue.w, h: venue.h })).toBe(false);
    expect(res.fontSize).toBeLessThan(20);
    expect(res.fontSize).toBeGreaterThanOrEqual(17);
    const after = checkFit({ ...patch, rect: res.rect, fontSize: res.fontSize }, ctx([lock]));
    expect(after.status).toBe("ok");
    expect(res.explanation).toMatch(/shrank the text/i);
  });

  it("grows into free space when there is room", () => {
    const open: FitContext = { ...ctx(), lines: [date, doors] };
    const patch = { ...patchFor("Saturday, 12 December 2026", false) };
    const res = reflowPatch(patch, open);
    expect(res.changed).toBe(true);
    expect(res.candidate?.kind).toBe("grow-right");
    expect(res.fontSize).toBe(20);
  });

  it("reports when nothing fits", () => {
    const boxed: FitContext = {
      ...ctx(),
      locks: [
        { id: "a", page: 0, rect: { x: 0, y: 0, w: date.x - 2.5, h: 842 }, label: "left" },
        { id: "b", page: 0, rect: { x: date.x + 30, y: 0, w: 500, h: 842 }, label: "right" },
      ],
    };
    const patch = patchFor("Saturday, 12 December 2026");
    const res = reflowPatch(patch, boxed);
    expect(res.changed).toBe(false);
  });
});
