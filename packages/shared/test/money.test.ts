import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addAmounts, Amount, compareAmounts, fromCents, NonNegativeAmount, toCents } from "../src/index";

describe("NonNegativeAmount", () => {
  it.each(["0", "0.00", "0.0", "0.01", "30", "30.00", "999999999999.99"])("accepts %s", (value) => {
    expect(NonNegativeAmount.safeParse(value).success).toBe(true);
  });

  it.each([
    ["a negative amount", "-0.01"],
    ["a number instead of a string", 0],
    ["scientific notation", "1e3"],
    ["a leading zero", "030.00"],
    ["three decimals", "0.001"],
    ["13 integer digits", "1000000000000"],
    ["an empty string", ""],
    ["a trailing dot", "30."],
  ])("rejects %s", (_label, value) => {
    expect(NonNegativeAmount.safeParse(value).success).toBe(false);
  });

  it("is the same format as Amount, plus zero", () => {
    expect(Amount.safeParse("0.00").success).toBe(false);
    expect(NonNegativeAmount.safeParse("0.00").success).toBe(true);
  });
});

describe("toCents and fromCents", () => {
  it.each([
    ["0.01", 1n, "0.01"],
    ["30", 3000n, "30.00"],
    ["30.00", 3000n, "30.00"],
    ["30.5", 3050n, "30.50"],
    ["0", 0n, "0.00"],
    ["49.99", 4999n, "49.99"],
    ["999999999999.99", 99999999999999n, "999999999999.99"],
    // Each of these is off by one cent if parsed through a float: 0.29 * 100 is 28.999999999999996.
    ["0.29", 29n, "0.29"],
    ["4.35", 435n, "4.35"],
    ["1.15", 115n, "1.15"],
    ["0.57", 57n, "0.57"],
  ])("%s is %d cents and comes back as %s", (amount, cents, canonical) => {
    expect(toCents(amount)).toBe(cents);
    expect(fromCents(cents)).toBe(canonical);
    expect(toCents(fromCents(cents))).toBe(cents);
  });

  it("returns a bigint, never a float", () => {
    expect(typeof toCents("0.10")).toBe("bigint");
  });

  it("round-trips every cent value near the edges", () => {
    for (const cents of [0n, 1n, 9n, 10n, 99n, 100n, 101n, 99999999999998n, 99999999999999n]) {
      expect(toCents(fromCents(cents))).toBe(cents);
      expect(NonNegativeAmount.safeParse(fromCents(cents)).success).toBe(true);
    }
  });

  it.each(["-1.00", "1e3", "30.001", " 30", "abc", "", "1000000000000"])("toCents refuses %j", (value) => {
    expect(() => toCents(value)).toThrow();
  });

  it("toCents refuses a number", () => {
    expect(() => toCents(30 as unknown as string)).toThrow();
  });

  it.each([-1n, 100000000000000n])("fromCents refuses %d cents (outside the 12-digit range)", (cents) => {
    expect(() => fromCents(cents)).toThrow();
  });

  it("fromCents refuses a number", () => {
    expect(() => fromCents(3000 as unknown as bigint)).toThrow(/expected a bigint/);
  });
});

describe("money.ts source", () => {
  it("never parses money through a float (no Number( or parseFloat)", () => {
    const source = readFileSync(new URL("../src/money.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bNumber\(|parseFloat|parseInt/);
  });
});

describe("compareAmounts and addAmounts", () => {
  it.each([
    ["30", "30.00", 0],
    ["30.01", "30", 1],
    ["9.99", "10", -1],
    ["100.00", "99.99", 1],
    ["0", "0.00", 0],
  ])("compareAmounts(%s, %s) is %d", (a, b, expected) => {
    expect(compareAmounts(a, b)).toBe(expected);
  });

  it("compares by value, not as strings", () => {
    // As strings "9.00" > "10.00"; as money it is less.
    expect(compareAmounts("9.00", "10.00")).toBe(-1);
  });

  it("adds without float error", () => {
    // 0.1 + 0.2 !== 0.3 in floating point.
    expect(addAmounts("0.10", "0.20")).toBe("0.30");
    expect(addAmounts("30", "0.5")).toBe("30.50");
    expect(addAmounts("0", "0")).toBe("0.00");
  });

  it("refuses a sum past the 12-digit maximum instead of returning an invalid amount", () => {
    expect(() => addAmounts("999999999999.99", "0.01")).toThrow();
  });

  it("refuses invalid input", () => {
    expect(() => addAmounts("30", "-1")).toThrow();
    expect(() => compareAmounts("1e3", "1")).toThrow();
  });
});
