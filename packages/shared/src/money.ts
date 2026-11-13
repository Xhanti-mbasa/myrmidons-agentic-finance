import { z } from "zod";

/** Up to 12 integer digits, up to 2 decimals, no sign, no exponent, no leading zeros. */
const DECIMAL = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

/** 999999999999.99, the largest value the decimal format can write. */
const MAX_CENTS = 99_999_999_999_999n;

/**
 * A positive USD/RLUSD amount as a decimal string: up to 12 integer digits, up to 2 decimals.
 * Strings only, so no float rounding and no "1e3"-style surprises reach the payment service.
 */
export const Amount = z
  .string()
  .regex(DECIMAL, "amount must be a decimal string like \"30.00\"")
  .refine((value) => /[1-9]/.test(value), "amount must be greater than zero");
export type Amount = z.infer<typeof Amount>;

/** Same format as Amount, but zero is allowed. For spent, reserved and remaining budget. */
export const NonNegativeAmount = z.string().regex(DECIMAL, "amount must be a decimal string like \"0.00\"");
export type NonNegativeAmount = z.infer<typeof NonNegativeAmount>;

/** Parses a decimal amount string ("30", "30.5", "30.00") into integer cents. Throws on anything else. */
export function toCents(amount: string): bigint {
  if (typeof amount !== "string" || !DECIMAL.test(amount)) {
    throw new TypeError("toCents: expected a decimal amount string like \"30.00\"");
  }
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

/** Writes integer cents as a canonical two-decimal string ("30.00"). Throws outside 0..999999999999.99. */
export function fromCents(cents: bigint): string {
  if (typeof cents !== "bigint") throw new TypeError("fromCents: expected a bigint number of cents");
  if (cents < 0n || cents > MAX_CENTS) throw new RangeError("fromCents: cents outside the 12-digit amount range");
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** -1, 0 or 1, comparing by value in cents. "30" and "30.00" are equal. */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const x = toCents(a);
  const y = toCents(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Exact sum as a canonical two-decimal string. Throws if the sum would not fit the 12-digit format. */
export function addAmounts(a: string, b: string): string {
  return fromCents(toCents(a) + toCents(b));
}
