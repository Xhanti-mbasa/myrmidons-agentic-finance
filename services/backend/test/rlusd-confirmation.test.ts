import { describe, expect, it } from "vitest";
import { RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER } from "@shucamoxa/shared";
import { isConfirmedRlusdPayment } from "../src/rlusd-confirmation";

describe("RLUSD ledger confirmation", () => {
  const amount = { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, value: "1" };
  const expected = { hash: "hash", sender: "sender", recipient: "recipient" };
  const tx = { TransactionType: "Payment", Account: "sender", Destination: "recipient", DeliverMax: amount };
  const record = { hash: "hash", validated: true, tx_json: tx, meta: { TransactionResult: "tesSUCCESS", delivered_amount: amount } };
  it("requires the exact validated direct RLUSD payment", () => {
    expect(isConfirmedRlusdPayment(record, expected)).toBe(true);
    for (const bad of [
      { ...record, validated: false }, { ...record, hash: "other" },
      { ...record, meta: { ...record.meta, TransactionResult: "tecPATH_DRY" } },
      { ...record, meta: { ...record.meta, delivered_amount: { ...amount, value: "0.5" } } },
      { ...record, meta: { ...record.meta, delivered_amount: { ...amount, issuer: "other" } } },
      { ...record, tx_json: { ...tx, Destination: "other" } },
      { ...record, tx_json: { ...tx, Flags: 0x00020000 } },
      { ...record, tx_json: { ...tx, Paths: [] } },
      { ...record, tx_json: { ...tx, SendMax: amount } },
    ]) expect(isConfirmedRlusdPayment(bad, expected)).toBe(false);
  });
});
