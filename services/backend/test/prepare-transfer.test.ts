import { describe, expect, it } from "vitest";
import { LAST_LEDGER_WINDOW, MEMO_TYPE, RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS, toHex } from "@shucamoxa/shared";
import type { PreparedTransfer } from "../../payments/src/payment";
import { prepareTransfer } from "../src/prepare-transfer";

const payment: PreparedTransfer = {
  intentId: "intent", ownerId: "owner", sourceAccountId: "source", recipientId: "recipient", recipientKind: "vendor",
  sourceAddress: "rhc2izJbaYTjnb8VqCqyycVXNoBa2XQu8t", destination: "rK7BdDvFdAz8xNtteEX3raqoqYqmPrF29m",
  amount: "5.25", reference: "invoice", network: XRPL_TESTNET_WSS, currency: RLUSD_CURRENCY_HEX,
  issuer: RLUSD_TESTNET_ISSUER, policyVersion: 1, auditHash: "a".repeat(64),
};
describe("prepareTransfer", () => {
  it("binds the approved amount, destination, audit hash and bounded ledger fields", () => {
    const tx = prepareTransfer({ ...payment, destinationTag: 9 }, 10, 200);
    expect(tx).toMatchObject({ Account: payment.sourceAddress, Destination: payment.destination, DestinationTag: 9,
      Amount: { currency: RLUSD_CURRENCY_HEX, issuer: RLUSD_TESTNET_ISSUER, value: "5.25" }, Fee: "100",
      Sequence: 10, LastLedgerSequence: 200 + LAST_LEDGER_WINDOW,
      Memos: [{ Memo: { MemoType: toHex(MEMO_TYPE), MemoData: toHex(payment.auditHash) } }] });
    expect(tx.Paths).toBeUndefined(); expect(tx.SendMax).toBeUndefined(); expect(tx.Flags).toBeUndefined();
  });
  it("rejects unsupported networks, assets and malformed ledger values", () => {
    for (const change of [{ network: "mainnet" }, { issuer: payment.sourceAddress }, { currency: "USD" }, { amount: "0.001" }, { auditHash: "invalid" }])
      expect(() => prepareTransfer({ ...payment, ...change } as PreparedTransfer, 10, 200)).toThrow();
    expect(() => prepareTransfer(payment, 0, 200)).toThrow();
    expect(() => prepareTransfer(payment, 1, 0xffffffff)).toThrow();
  });
});
