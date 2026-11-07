import { describe, expect, it } from "vitest";

import { colorDistance } from "./colors";
import { buildLines, computeGrid } from "./extract";

describe("extraction", () => {
  it("splits runs separated by a wide gap into separate lines", () => {
    const lines = buildLines(
      [
        { str: "Saturday, 5 December 2026", x: 48, baseline: 222, fontSize: 20, width: 260, fontName: "Helvetica-Bold" },
        { str: "UDUS Main Auditorium", x: 318, baseline: 222, fontSize: 20, width: 206, fontName: "Helvetica" },
        { str: "Doors", x: 48, baseline: 252, fontSize: 15, width: 40, fontName: "Helvetica" },
        { str: "open", x: 91, baseline: 252, fontSize: 15, width: 33, fontName: "Helvetica" },
      ],
      0,
    );
    expect(lines.map((l) => l.text)).toEqual(["Saturday, 5 December 2026", "UDUS Main Auditorium", "Doors open"]);
    expect(lines[0]!.bold).toBe(true);
    expect(lines[2]!.runs.map((r) => r.text).join("")).toBe("Doors open");
  });

  it("finds the paper colour and the solid ink colour of a cell", () => {
    const w = 12;
    const h = 12;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      // 3 columns of solid ink, 1 column of anti-aliased edge, rest paper.
      const [r, g, b] = x < 3 ? [31, 42, 31] : x === 3 ? [140, 140, 130] : [255, 247, 232];
      data.set([r, g, b, 255], i * 4);
    }
    const grid = computeGrid(data, w, h, 12);
    expect(colorDistance(grid.colors[0]!, "#fff7e8")).toBeLessThan(4);
    expect(colorDistance(grid.ink[0]!, "#1f2a1f")).toBeLessThan(6);
  });
});
