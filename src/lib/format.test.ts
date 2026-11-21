import { describe, expect, it } from "vitest";
import { formatGrams, formatMinutes, parseDuration } from "./format";

describe("formatMinutes", () => {
  it("shows hours and minutes", () => expect(formatMinutes(95)).toBe("1h 35m"));
  it("shows minutes only under an hour", () => expect(formatMinutes(40)).toBe("40m"));
  it("shows whole hours", () => expect(formatMinutes(120)).toBe("2h"));
  it("shows a dash for unknown", () => expect(formatMinutes(null)).toBe("—"));
});

describe("parseDuration", () => {
  it("reads hours and minutes", () => expect(parseDuration("3h 20m")).toBe(200));
  it("reads hours or minutes alone", () => {
    expect(parseDuration("3h")).toBe(180);
    expect(parseDuration("45m")).toBe(45);
  });
  it("reads a clock time", () => expect(parseDuration("3:05")).toBe(185));
  it("reads decimal hours", () => expect(parseDuration("2.5h")).toBe(150));
  it("reads plain minutes", () => expect(parseDuration("95")).toBe(95));
  it("treats blank as unknown", () => expect(parseDuration(" ")).toBeNull());
  it("rejects nonsense", () => expect(parseDuration("soon")).toBeNaN());
});

describe("formatGrams", () => {
  it("switches to kilograms", () => expect(formatGrams(1250)).toBe("1.25 kg"));
  it("keeps grams below 1 kg", () => expect(formatGrams(80)).toBe("80 g"));
  it("shows a dash for unknown", () => expect(formatGrams(null)).toBe("—"));
});
