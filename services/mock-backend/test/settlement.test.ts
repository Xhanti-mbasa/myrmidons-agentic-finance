import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyChain, type PayRequest, type PayResult } from "@shucamoxa/shared";
import { DEMO_SEED, MockStore, mockSettler, type Settler, type SettlerContext } from "../src/index";

const approvals = () => join(mkdtempSync(join(tmpdir(), "settle-")), "approvals.jsonl");
const pay = (invoiceNumber: string, amount: string, supplierId = "sup_karoo"): PayRequest => ({ invoiceNumber, amount, supplierId, reason: "test" });

/** A settler that records what it was asked and answers with the given outcome. */
function fakeSettler(outcome: (ctx: SettlerContext, request: PayRequest) => Promise<PayResult>) {
  const calls: { request: PayRequest; address: string | undefined }[] = [];
  const make = (ctx: SettlerContext): Settler => ({
    mode: "xrpl-testnet",
    async settle(request) {
      calls.push({ request, address: ctx.supplier(request.supplierId)?.address });
      return outcome(ctx, request);
    },
  });
  return { make, calls };
}

const settled = async (ctx: SettlerContext, request: PayRequest): Promise<PayResult> => {
  const entry = await ctx.append({ actor: "payment", event: "payment_settled", invoiceNumber: request.invoiceNumber, supplierId: request.supplierId,
    amount: request.amount, ruleCode: "OK", explanation: "Paid.", txHash: "A".repeat(64), ledgerResult: "tesSUCCESS" });
  return { status: "settled", ruleCode: "OK", txHash: "A".repeat(64), logId: String(entry.seq) };
};

describe("MockStore settlement seam", () => {
  it("defaults to the mock settler", () => {
    const store = new MockStore(DEMO_SEED, approvals());
    expect(store.settlementMode).toBe("mock");
    expect(mockSettler({ append: vi.fn(), supplier: () => null }).mode).toBe("mock");
  });

  it("hands an allowed payment and the supplier's approved address to the settler, and counts it as spent once settled", async () => {
    const fake = fakeSettler(settled);
    const store = new MockStore(DEMO_SEED, approvals(), fake.make);
    const result = await store.pay(pay("INV-1", "30.00"));
    expect(result).toMatchObject({ status: "settled", txHash: "A".repeat(64) });
    expect(fake.calls).toEqual([{ request: pay("INV-1", "30.00"), address: DEMO_SEED.suppliers[0]!.address }]);
    expect(store.rules()).toMatchObject({ spent: "30.00", reserved: "0.00" });
    expect(store.settlementMode).toBe("xrpl-testnet");
  });

  it("never calls the settler when the backend's own checks block the payment", async () => {
    const fake = fakeSettler(settled);
    const store = new MockStore(DEMO_SEED, approvals(), fake.make);
    expect(await store.pay(pay("INV-2", "75.00"))).toMatchObject({ status: "blocked", ruleCode: "OVER_PER_PAYMENT_CAP" });
    expect(await store.pay(pay("INV-3", "10.00", "sup_unknown"))).toMatchObject({ status: "blocked", ruleCode: "SUPPLIER_NOT_APPROVED" });
    expect(fake.calls).toHaveLength(0);
  });

  it("passes a policy refusal through without spending", async () => {
    const fake = fakeSettler(async (ctx, request) => {
      const entry = await ctx.append({ actor: "policy", event: "policy_blocked", invoiceNumber: request.invoiceNumber, supplierId: request.supplierId,
        amount: request.amount, ruleCode: "DESTINATION_MISMATCH", explanation: "Blocked.", txHash: null, ledgerResult: null });
      return { status: "blocked", ruleCode: "DESTINATION_MISMATCH", logId: String(entry.seq) };
    });
    const store = new MockStore(DEMO_SEED, approvals(), fake.make);
    expect(await store.pay(pay("INV-4", "30.00"))).toMatchObject({ status: "blocked", ruleCode: "DESTINATION_MISMATCH" });
    expect(store.rules().spent).toBe("0.00");
  });

  it("fails closed when settlement errors: logs payment_failed, holds the amount as reserved and never resubmits", async () => {
    const fake = fakeSettler(async () => { throw new Error("policy service unreachable"); });
    const store = new MockStore(DEMO_SEED, approvals(), fake.make);
    await expect(store.pay(pay("INV-5", "30.00"))).rejects.toThrow(/outcome unknown/i);
    await expect(store.pay(pay("INV-5", "30.00"))).rejects.toThrow(/outcome unknown/i);
    expect(fake.calls).toHaveLength(1);
    expect(store.rules()).toMatchObject({ spent: "0.00", reserved: "30.00", remaining: "170.00" });
    const [entry] = store.queryLog({});
    expect(entry).toMatchObject({ event: "payment_failed", invoiceNumber: "INV-5", ruleCode: null });
  });

  it("blocks a repeat of a settled invoice as DUPLICATE_INVOICE carrying the original hash, logs it, and settles nothing", async () => {
    const fake = fakeSettler(settled);
    const store = new MockStore(DEMO_SEED, approvals(), fake.make);
    await store.pay(pay("INV-6", "30.00"));
    const again = await store.pay(pay("INV-6", "30.00"));
    expect(again).toMatchObject({ status: "blocked", ruleCode: "DUPLICATE_INVOICE", txHash: "A".repeat(64) });
    expect(fake.calls).toHaveLength(1);
    expect(store.rules().spent).toBe("30.00");
    const log = store.queryLog({});
    expect(log[0]).toMatchObject({ event: "policy_blocked", ruleCode: "DUPLICATE_INVOICE" });
    expect(await verifyChain([...log].reverse())).toBeNull();
  });
});
