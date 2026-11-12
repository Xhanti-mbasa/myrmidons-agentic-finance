import { describe, expect, it } from "vitest";
import { PayResult, RuleCode, ruleExplanation } from "../src/index";

describe("rule codes and explanations", () => {
  it("explains an over-cap block in plain words", () => {
    expect(ruleExplanation("OVER_PER_PAYMENT_CAP")).toBe(
      "Blocked: the amount is above the owner's per-payment cap.",
    );
  });

  it("explains a revoked agent in plain words", () => {
    expect(ruleExplanation("KILL_SWITCH_ON")).toBe(
      "Blocked: the owner has revoked the agent's payment authority.",
    );
  });

  it("has a distinct, non-empty explanation for every rule code", () => {
    const sentences = RuleCode.options.map((code) => ruleExplanation(code));
    expect(sentences.every((s) => s.length > 10)).toBe(true);
    expect(new Set(sentences).size).toBe(RuleCode.options.length);
  });

  it("covers the 13 rule codes agreed in the spec", () => {
    expect([...RuleCode.options].sort()).toEqual(
      [
        "OK", "KILL_SWITCH_ON", "SUPPLIER_NOT_APPROVED", "DESTINATION_MISMATCH", "WRONG_ASSET",
        "OVER_PER_PAYMENT_CAP", "OVER_BUDGET", "DUPLICATE_INVOICE", "FORBIDDEN_TX_FIELDS",
        "STALE_TX", "MEMO_MISMATCH", "RATE_LIMITED", "LEDGER_REJECTED",
      ].sort(),
    );
  });
});

describe("PayResult", () => {
  it("accepts a settled payment with a tx hash", () => {
    expect(PayResult.safeParse({ status: "settled", ruleCode: "OK", txHash: "ABC123", logId: "log_1" }).success).toBe(true);
  });

  it("rejects a settled payment with no tx hash", () => {
    expect(PayResult.safeParse({ status: "settled", ruleCode: "OK", logId: "log_1" }).success).toBe(false);
  });

  it("rejects a rule code nobody agreed on", () => {
    expect(PayResult.safeParse({ status: "blocked", ruleCode: "TOTALLY_FINE", logId: "log_1" }).success).toBe(false);
  });

  it("rejects a blocked result that claims the OK rule code", () => {
    expect(PayResult.safeParse({ status: "blocked", ruleCode: "OK", logId: "log_1" }).success).toBe(false);
  });
});
