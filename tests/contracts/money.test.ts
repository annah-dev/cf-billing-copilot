import { describe, expect, it } from "vitest";
import {
  formatUsd,
  money,
  MoneySchema,
  CentsSchema
} from "../../src/contracts";

describe("formatUsd", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [41287, "$412.87"],
    [100000, "$1,000.00"],
    [123456789, "$1,234,567.89"],
    [-1999, "-$19.99"]
  ])("formats %i cents as %s", (cents, expected) => {
    expect(formatUsd(cents)).toBe(expected);
  });

  it("refuses non-integer cents", () => {
    expect(() => formatUsd(12.5)).toThrow(TypeError);
    expect(() => formatUsd(Number.NaN)).toThrow(TypeError);
  });
});

describe("MoneySchema", () => {
  it("accepts money() output", () => {
    expect(MoneySchema.parse(money(41287))).toEqual({
      cents: 41287,
      display: "$412.87"
    });
  });

  it("rejects a display string that does not match the cents", () => {
    expect(
      MoneySchema.safeParse({ cents: 41287, display: "$412.88" }).success
    ).toBe(false);
  });

  it("rejects fractional and unsafe cents", () => {
    expect(CentsSchema.safeParse(0.1).success).toBe(false);
    expect(CentsSchema.safeParse(2 ** 53).success).toBe(false);
  });
});
