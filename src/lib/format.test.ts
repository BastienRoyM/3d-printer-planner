import { describe, expect, it } from "vitest";
import { formatGrams, formatMinutes } from "./format";

describe("formatMinutes", () => {
  it("shows hours and minutes", () => expect(formatMinutes(95)).toBe("1h 35m"));
  it("shows minutes only under an hour", () => expect(formatMinutes(40)).toBe("40m"));
  it("shows whole hours", () => expect(formatMinutes(120)).toBe("2h"));
  it("shows a dash for unknown", () => expect(formatMinutes(null)).toBe("—"));
});

describe("formatGrams", () => {
  it("switches to kilograms", () => expect(formatGrams(1250)).toBe("1.25 kg"));
  it("keeps grams below 1 kg", () => expect(formatGrams(80)).toBe("80 g"));
  it("shows a dash for unknown", () => expect(formatGrams(null)).toBe("—"));
});
