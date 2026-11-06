import { describe, expect, it } from "vitest";
import { formatMinutes } from "./format";

describe("formatMinutes", () => {
  it("shows hours and minutes", () => expect(formatMinutes(95)).toBe("1h 35m"));
  it("shows minutes only under an hour", () => expect(formatMinutes(40)).toBe("40m"));
  it("shows whole hours", () => expect(formatMinutes(120)).toBe("2h"));
  it("shows a dash for unknown", () => expect(formatMinutes(null)).toBe("—"));
});
