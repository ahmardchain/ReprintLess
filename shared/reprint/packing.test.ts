import { describe, expect, it } from "vitest";

import { labelIds } from "./labels";
import { CROP_MARGIN, HEADER_HEIGHT, packLabels, PAPER, SHEET_MARGIN } from "./packing";

describe("packLabels", () => {
  it("places labels on shelves without overlap, inside the sheet", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, w: 60 + (i % 5) * 30, h: 20 + (i % 3) * 15 }));
    const res = packLabels(items, "A4", 3);
    expect(res.placements).toHaveLength(30);
    for (const a of res.placements) {
      expect(a.x - CROP_MARGIN).toBeGreaterThanOrEqual(SHEET_MARGIN - 0.01);
      expect(a.x + a.w + CROP_MARGIN).toBeLessThanOrEqual(PAPER.A4.width - SHEET_MARGIN + 0.01);
      expect(a.y + a.h).toBeLessThanOrEqual(PAPER.A4.height - SHEET_MARGIN);
      if (a.sheet === 0) expect(a.y).toBeGreaterThanOrEqual(SHEET_MARGIN + HEADER_HEIGHT);
      for (const b of res.placements) {
        if (a === b || a.sheet !== b.sheet) continue;
        const sep = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(sep).toBe(true);
      }
    }
  });

  it("keeps exact label sizes", () => {
    const res = packLabels([{ id: "a", w: 100, h: 40 }], "Letter", 2);
    expect(res.placements[0]).toMatchObject({ w: 100, h: 40, sheet: 0 });
  });

  it("spills to a second sheet", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, w: 250, h: 60 }));
    expect(packLabels(items, "A4", 3).sheets).toBeGreaterThan(1);
  });

  it("numbers labels in reading order", () => {
    const ids = labelIds([
      { id: "b", page: 0, rect: { x: 10, y: 300, w: 5, h: 5 } },
      { id: "c", page: 1, rect: { x: 10, y: 10, w: 5, h: 5 } },
      { id: "a", page: 0, rect: { x: 10, y: 100, w: 5, h: 5 } },
    ]);
    expect(ids.map((p) => `${p.id}:${p.label}`)).toEqual(["a:L1", "b:L2", "c:L3"]);
  });
});
