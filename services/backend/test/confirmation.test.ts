import { describe, expect, it } from "vitest";
import { isConfirmedPayment } from "../src/confirmation";

describe("ledger confirmation", () => {
  const expected = { hash: "hash", sender: "sender", recipient: "recipient" };
  const valid = { hash: "hash", validated: true, meta: { TransactionResult: "tesSUCCESS", delivered_amount: "1000000" },
    tx_json: { TransactionType: "Payment", Account: "sender", Destination: "recipient", DeliverMax: "1000000" } };
  it("accepts only the expected validated success", () => {
    expect(isConfirmedPayment(valid, expected)).toBe(true);
    for (const result of [
      { ...valid, validated: false }, { ...valid, hash: "other" },
      { ...valid, meta: { TransactionResult: "tecFAILED" } },
      { ...valid, tx_json: { ...valid.tx_json, Account: "other" } },
      { ...valid, tx_json: { ...valid.tx_json, Destination: "other" } },
      { ...valid, tx_json: { ...valid.tx_json, DeliverMax: "999999" } },
      { ...valid, meta: { ...valid.meta, delivered_amount: "999999" } },
      { ...valid, meta: undefined },
    ]) expect(isConfirmedPayment(result, expected)).toBe(false);
  });
});
