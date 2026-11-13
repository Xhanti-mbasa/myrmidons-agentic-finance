import { z } from "zod";
import { AccountId, TransferId } from "./transfers";
import { Sha256Hex } from "./policy";

const MICRO = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/;
/** Six decimal places; distinct from the existing two-decimal transfer contract. */
export const MicroAmount = z.string().regex(MICRO);
export const PositiveMicroAmount = MicroAmount.refine(value => /[1-9]/.test(value));
export function toMicros(value: string): bigint {
  MicroAmount.parse(value);
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
export function fromMicros(value: bigint): string {
  if (value < 0n || value > 999_999_999_999_999_999n) throw new RangeError("micro amount range");
  return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, "0")}`;
}
export const PurchaseCategory = z.strictObject({
  perPurchaseZar: PositiveMicroAmount, periodBudgetZar: PositiveMicroAmount, period: z.enum(["daily", "weekly", "monthly"]),
  merchantIds: z.array(AccountId).min(1).max(100), autoPurchase: z.boolean(),
});
export const PurchaseBudgetPolicy = z.strictObject({
  enabled: z.boolean(), timezone: z.literal("Africa/Johannesburg").default("Africa/Johannesburg"),
  /** Dedicated purchase-wallet mandate; independent of the invoice-transfer treasury. */
  aggregateRlusd: z.strictObject({ perPurchase: PositiveMicroAmount, lifetimeBudget: PositiveMicroAmount }).optional(),
  categories: z.record(AccountId, PurchaseCategory),
});
export type PurchaseBudgetPolicy = z.infer<typeof PurchaseBudgetPolicy>;
/** Resolved by a trusted quote adapter, never accepted as a model-provided exchange rate. */
export const TrustedPurchaseQuote = z.strictObject({
  id: AccountId, source: z.string().min(1).max(200),
  zarPerRlusd: PositiveMicroAmount, issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
});
export type TrustedPurchaseQuote = z.infer<typeof TrustedPurchaseQuote>;
export const PurchaseBudgetRequest = z.strictObject({
  purchaseId: TransferId, merchantId: AccountId, categoryId: AccountId,
  resourceHash: Sha256Hex, amountRlusd: PositiveMicroAmount, feeRlusd: MicroAmount, quoteId: AccountId,
});
export type PurchaseBudgetRequest = z.infer<typeof PurchaseBudgetRequest>;
export type PurchaseReservation = PurchaseBudgetRequest & {
  ownerId: string; policyVersion: number; periodStart: string; period: "daily" | "weekly" | "monthly"; chargedZar: string;
  quote: TrustedPurchaseQuote; settledAt?: string; settledPeriodStart?: string; settledPeriod?: "daily" | "weekly" | "monthly"; budgetDigest: string; state: "reserved" | "unknown" | "settled" | "rejected";
  rejectedFeeRlusd?: string;
};
