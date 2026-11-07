import { describe, expect, it } from "vitest";

import { adjustPrice, comboParts, comboRelation, findPrices, formatPrice } from "./prices";

describe("prices", () => {
  it.each([
    ["₦2,300", "₦", 230000],
    ["N2,300", "N", 230000],
    ["$4.50", "$", 450],
    ["£10", "£", 1000],
    ["€1,000.00", "€", 100000],
    ["₦ 12,500", "₦", 1250000],
  ])("parses %s", (text, symbol, minor) => {
    const [p] = findPrices(text);
    expect(p.text).toBe(text);
    expect(p.symbol).toBe(symbol);
    expect(p.minor).toBe(minor);
  });

  it("does not read words or bare numbers as prices", () => {
    expect(findPrices("NOVEMBER 2026, Doors open 3:30")).toHaveLength(0);
  });

  it("raises 10% and rounds to the nearest ₦50 exactly", () => {
    expect(adjustPrice(230000, 10, 50)).toBe(255000);
    expect(adjustPrice(180000, 10, 50)).toBe(200000);
    expect(adjustPrice(410000, 10, 50)).toBe(450000);
    expect(adjustPrice(450, 10, 0.05)).toBe(495);
  });

  it("formats in the original style", () => {
    const [p] = findPrices("₦2,300");
    expect(formatPrice(255000, p)).toBe("₦2,550");
    const [d] = findPrices("$4.50");
    expect(formatPrice(495, d)).toBe("$4.95");
  });

  it("detects a combo that stops adding up", () => {
    expect(comboParts("Combo: Jollof Rice + Chicken")).toEqual(["Jollof Rice", "Chicken"]);
    const before = comboRelation(410000, [230000, 180000]);
    expect(before.relation).toBe("equal");
    const after = comboRelation(450000, [255000, 200000]);
    expect(after).toMatchObject({ relation: "cheaper", diff: -5000, sum: 455000 });
  });
});
