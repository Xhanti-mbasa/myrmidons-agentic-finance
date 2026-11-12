import { describe, expect, it } from "vitest";
import { Amount } from "../src/index";

describe("Amount", () => {
  it.each(["30", "30.00", "0.01", "49.99", "1000000"])("accepts the decimal string %s", (value) => {
    expect(Amount.safeParse(value).success).toBe(true);
  });

  it.each([
    ["a number instead of a string", 30],
    ["scientific notation", "1e3"],
    ["a negative amount", "-5.00"],
    ["zero", "0"],
    ["zero with decimals", "0.00"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["leading whitespace", " 30.00"],
    ["a currency symbol", "$30.00"],
    ["a thousands separator", "1,000.00"],
    ["more than two decimal places", "30.001"],
    ["hex", "0x1E"],
    ["an empty string", ""],
    ["an absurdly large amount", "1000000000000000"],
  ])("rejects %s", (_label, value) => {
    expect(Amount.safeParse(value).success).toBe(false);
  });
});
