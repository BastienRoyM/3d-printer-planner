import { describe, expect, it } from "vitest";
import { percent, platesRemaining } from "./progress";

describe("percent", () => {
  it("is 0 when nothing is planned", () => expect(percent(0, 0)).toBe(0));
  it("rounds to an integer", () => expect(percent(1, 3)).toBe(33));
  it("caps at 100", () => expect(percent(5, 4)).toBe(100));
});

describe("platesRemaining", () => {
  it("rounds partial plates up", () =>
    expect(platesRemaining({ qtyTotal: 5, qtyDone: 0, copiesPerPlate: 2 })).toBe(3));
  it("is 0 when complete", () =>
    expect(platesRemaining({ qtyTotal: 4, qtyDone: 4, copiesPerPlate: 1 })).toBe(0));
});
