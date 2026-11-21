import { describe, expect, it } from "vitest";
import { centsToInput, formatMoney, parseMoney } from "./money";

describe("parseMoney", () => {
  it("reads whole and decimal amounts", () => {
    expect(parseMoney("12")).toBe(1200);
    expect(parseMoney("12.5")).toBe(1250);
  });
  it("accepts a comma and a currency sign", () => expect(parseMoney("$12,50")).toBe(1250));
  it("treats blank as no price", () => expect(parseMoney("  ")).toBeNull());
  it("rejects nonsense and negatives", () => {
    expect(parseMoney("1.2.3")).toBeNaN();
    expect(parseMoney("-4")).toBeNaN();
  });
  it("rounds to the cent", () => expect(parseMoney("0.105")).toBe(11));
});

describe("formatMoney", () => {
  it("shows a dash for no price", () => expect(formatMoney(null)).toBe("—"));
  it("includes the amount", () => expect(formatMoney(1250, "USD")).toContain("12.50"));
});

describe("centsToInput", () => {
  it("prints two decimals", () => expect(centsToInput(1250)).toBe("12.50"));
  it("is empty for no price", () => expect(centsToInput(null)).toBe(""));
});
