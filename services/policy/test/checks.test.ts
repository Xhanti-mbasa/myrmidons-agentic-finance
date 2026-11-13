import { describe, expect, it } from "vitest";
import {
  MEMO_TYPE,
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  toHex,
  type CosignRequest,
  type Rules,
} from "@shucamoxa/shared";
import {
  checkApprovedSupplier,
  checkAssetAndAmount,
  checkDestination,
  checkMemoStructure,
  checkPaymentFromTreasury,
  checkPerPaymentCap,
  checkTransactionFieldsAndFee,
  DEFAULT_POLICY_CHECKS,
  MAX_FEE_DROPS,
  runPolicyChecks,
  TF_FULLY_CANONICAL_SIG,
  type PolicyCheckContext,
  type PolicySupplier,
} from "../src/checks";

const TREASURY_ACCOUNT = "rTreasury111111111111111111111111111";
const AGENT_ACCOUNT = "rAgent111111111111111111111111111111";
const APPROVED_SUPPLIER_ADDRESS = "rSupplier11111111111111111111111111";
const OTHER_ADDRESS = "rOtherAddress11111111111111111111111";
const LOG_ENTRY_HASH = "a".repeat(64);

const DEFAULT_SUPPLIER: PolicySupplier = {
  id: "sup_karoo",
  name: "Karoo Textiles",
  address: APPROVED_SUPPLIER_ADDRESS,
  status: "approved",
};

const BASE_RULES: Rules & { suppliers: PolicySupplier[] } = {
  perPaymentCap: "50.00",
  totalBudget: "1000.00",
  spent: "0.00",
  reserved: "0.00",
  remaining: "1000.00",
  periodStart: "2026-11-01",
  killSwitch: false,
  suppliers: [DEFAULT_SUPPLIER],
};

function createValidTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    TransactionType: "Payment",
    Account: TREASURY_ACCOUNT,
    Destination: APPROVED_SUPPLIER_ADDRESS,
    Amount: {
      currency: RLUSD_CURRENCY_HEX,
      issuer: RLUSD_TESTNET_ISSUER,
      value: "30.00",
    },
    Fee: "20",
    Sequence: 1,
    SigningPubKey: "",
    Flags: TF_FULLY_CANONICAL_SIG,
    Memos: [
      {
        Memo: {
          MemoType: toHex(MEMO_TYPE),
          MemoData: LOG_ENTRY_HASH,
        },
      },
    ],
    ...overrides,
  };
}

function createValidCosignRequest(overrides: Partial<CosignRequest["request"]> = {}): CosignRequest {
  return {
    txJson: {},
    agentSignedBlob: "00",
    request: {
      supplierId: "sup_karoo",
      amount: "30.00",
      invoiceNumber: "INV-1001",
      logEntryHash: LOG_ENTRY_HASH,
      ...overrides,
    },
  };
}

function createContext(
  txOverrides: Record<string, unknown> = {},
  requestOverrides: Partial<CosignRequest["request"]> = {},
  rulesOverrides: Partial<typeof BASE_RULES> = {}
): PolicyCheckContext {
  const decodedTx = createValidTx(txOverrides);
  const request = createValidCosignRequest(requestOverrides);
  const rules = {
    ...BASE_RULES,
    ...rulesOverrides,
    suppliers: rulesOverrides.suppliers ?? BASE_RULES.suppliers,
  };

  return {
    decodedTx,
    request,
    rules,
    treasuryAccount: TREASURY_ACCOUNT,
    agentAccount: AGENT_ACCOUNT,
  };
}

describe("Policy Checks (T21)", () => {
  describe("Valid payment requests", () => {
    it("valid 30.00 payment passes all default policy checks", () => {
      const ctx = createContext();
      const failure = runPolicyChecks(ctx);
      expect(failure).toBeNull();
    });

    it("valid payment with RLUSD value '30' and request.amount '30.00' passes", () => {
      const ctx = createContext(
        {
          Amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "30",
          },
        },
        { amount: "30.00" }
      );
      expect(runPolicyChecks(ctx)).toBeNull();
    });

    it("valid payment with Flags: 0 passes", () => {
      const ctx = createContext({ Flags: 0 });
      expect(runPolicyChecks(ctx)).toBeNull();
    });

    it("valid payment with Flags omitted passes", () => {
      const tx = createValidTx();
      delete tx.Flags;
      const ctx = createContext(tx);
      expect(runPolicyChecks(ctx)).toBeNull();
    });

    it("exactly 50.00 cap passes", () => {
      const ctx = createContext(
        {
          Amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "50.00",
          },
        },
        { amount: "50.00" }
      );
      expect(runPolicyChecks(ctx)).toBeNull();
    });
  });

  describe("Check 3: SUPPLIER_NOT_APPROVED", () => {
    it("rejects unknown supplierId", () => {
      const ctx = createContext({}, { supplierId: "sup_unknown" });
      expect(checkApprovedSupplier(ctx)).toBe("SUPPLIER_NOT_APPROVED");
      expect(runPolicyChecks(ctx)).toBe("SUPPLIER_NOT_APPROVED");
    });

    it("rejects supplier with status 'pending'", () => {
      const ctx = createContext(
        {},
        { supplierId: "sup_pending" },
        {
          suppliers: [
            {
              id: "sup_pending",
              name: "Pending Supplier",
              address: APPROVED_SUPPLIER_ADDRESS,
              status: "pending",
            },
          ],
        }
      );
      expect(checkApprovedSupplier(ctx)).toBe("SUPPLIER_NOT_APPROVED");
      expect(runPolicyChecks(ctx)).toBe("SUPPLIER_NOT_APPROVED");
    });

    it("rejects supplier with status 'removed'", () => {
      const ctx = createContext(
        {},
        { supplierId: "sup_removed" },
        {
          suppliers: [
            {
              id: "sup_removed",
              name: "Removed Supplier",
              address: APPROVED_SUPPLIER_ADDRESS,
              status: "removed",
            },
          ],
        }
      );
      expect(checkApprovedSupplier(ctx)).toBe("SUPPLIER_NOT_APPROVED");
      expect(runPolicyChecks(ctx)).toBe("SUPPLIER_NOT_APPROVED");
    });
  });

  describe("Check 4: DESTINATION_MISMATCH", () => {
    it("rejects payment to other address", () => {
      const ctx = createContext({ Destination: OTHER_ADDRESS });
      expect(checkDestination(ctx)).toBe("DESTINATION_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("DESTINATION_MISMATCH");
    });

    it("rejects when supplier has tag 7, tx has none", () => {
      const ctx = createContext(
        {}, // tx has no DestinationTag
        {},
        {
          suppliers: [
            {
              ...DEFAULT_SUPPLIER,
              destinationTag: 7,
            },
          ],
        }
      );
      expect(checkDestination(ctx)).toBe("DESTINATION_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("DESTINATION_MISMATCH");
    });

    it("rejects when supplier has none, tx has tag 7", () => {
      const ctx = createContext(
        { DestinationTag: 7 }, // tx has DestinationTag 7
        {},
        {
          suppliers: [
            {
              ...DEFAULT_SUPPLIER,
              destinationTag: null, // supplier has none
            },
          ],
        }
      );
      expect(checkDestination(ctx)).toBe("DESTINATION_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("DESTINATION_MISMATCH");
    });

    it("rejects when tags differ (supplier 7, tx 8)", () => {
      const ctx = createContext(
        { DestinationTag: 8 },
        {},
        {
          suppliers: [
            {
              ...DEFAULT_SUPPLIER,
              destinationTag: 7,
            },
          ],
        }
      );
      expect(checkDestination(ctx)).toBe("DESTINATION_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("DESTINATION_MISMATCH");
    });

    it("accepts matching tags (supplier 7, tx 7)", () => {
      const ctx = createContext(
        { DestinationTag: 7 },
        {},
        {
          suppliers: [
            {
              ...DEFAULT_SUPPLIER,
              destinationTag: 7,
            },
          ],
        }
      );
      expect(checkDestination(ctx)).toBeNull();
      expect(runPolicyChecks(ctx)).toBeNull();
    });

    it("accepts matching destination_tag via snake_case property", () => {
      const ctx = createContext(
        { DestinationTag: 42 },
        {},
        {
          suppliers: [
            {
              id: "sup_karoo",
              name: "Karoo Textiles",
              xrpl_address: APPROVED_SUPPLIER_ADDRESS,
              destination_tag: 42,
              status: "approved",
            },
          ],
        }
      );
      expect(checkDestination(ctx)).toBeNull();
      expect(runPolicyChecks(ctx)).toBeNull();
    });
  });

  describe("Check 5: WRONG_ASSET", () => {
    it("rejects XRP drops string", () => {
      const ctx = createContext({ Amount: "30000000" });
      expect(checkAssetAndAmount(ctx)).toBe("WRONG_ASSET");
      expect(runPolicyChecks(ctx)).toBe("WRONG_ASSET");
    });

    it("rejects RLUSD from another issuer", () => {
      const ctx = createContext({
        Amount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: "rFakeIssuer1111111111111111111111111",
          value: "30.00",
        },
      });
      expect(checkAssetAndAmount(ctx)).toBe("WRONG_ASSET");
      expect(runPolicyChecks(ctx)).toBe("WRONG_ASSET");
    });

    it("rejects currency 'RLUSD' as text instead of hex", () => {
      const ctx = createContext({
        Amount: {
          currency: "RLUSD",
          issuer: RLUSD_TESTNET_ISSUER,
          value: "30.00",
        },
      });
      expect(checkAssetAndAmount(ctx)).toBe("WRONG_ASSET");
      expect(runPolicyChecks(ctx)).toBe("WRONG_ASSET");
    });

    it("rejects value '30.001' (more than 2 decimal places)", () => {
      const ctx = createContext({
        Amount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: "30.001",
        },
      });
      expect(checkAssetAndAmount(ctx)).toBe("WRONG_ASSET");
      expect(runPolicyChecks(ctx)).toBe("WRONG_ASSET");
    });

    it("rejects when tx value does not equal request.amount", () => {
      const ctx = createContext(
        {
          Amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "40.00",
          },
        },
        { amount: "30.00" }
      );
      expect(checkAssetAndAmount(ctx)).toBe("WRONG_ASSET");
      expect(runPolicyChecks(ctx)).toBe("WRONG_ASSET");
    });
  });

  describe("Check 6: FORBIDDEN_TX_FIELDS and fee cap", () => {
    it("rejects tfPartialPayment flag (0x00020000)", () => {
      const ctx = createContext({ Flags: 0x00020000 });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects SendMax", () => {
      const ctx = createContext({ SendMax: "100" });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects Paths", () => {
      const ctx = createContext({ Paths: [] });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects DeliverMin", () => {
      const ctx = createContext({ DeliverMin: "10" });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects DeliverMax", () => {
      const ctx = createContext({ DeliverMax: "50" });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects InvoiceID", () => {
      const ctx = createContext({ InvoiceID: "A".repeat(64) });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects TicketSequence", () => {
      const ctx = createContext({ TicketSequence: 1 });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects unknown fields", () => {
      const ctx = createContext({ maliciousField: "attack" });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects Fee 100 XRP (100,000,000 drops > MAX_FEE_DROPS 1,000)", () => {
      const ctx = createContext({ Fee: "100000000" });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("rejects non-empty SigningPubKey", () => {
      const ctx = createContext({ SigningPubKey: "02ABCDEF..." });
      expect(checkTransactionFieldsAndFee(ctx)).toBe("FORBIDDEN_TX_FIELDS");
      expect(runPolicyChecks(ctx)).toBe("FORBIDDEN_TX_FIELDS");
    });

    it("accepts Fee up to MAX_FEE_DROPS (1,000 drops)", () => {
      const ctx = createContext({ Fee: String(MAX_FEE_DROPS) });
      expect(checkTransactionFieldsAndFee(ctx)).toBeNull();
      expect(runPolicyChecks(ctx)).toBeNull();
    });
  });

  describe("Check 7: OVER_PER_PAYMENT_CAP", () => {
    it("rejects 50.01 when cap is 50.00", () => {
      const ctx = createContext(
        {
          Amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "50.01",
          },
        },
        { amount: "50.01" },
        { perPaymentCap: "50.00" }
      );
      expect(checkPerPaymentCap(ctx)).toBe("OVER_PER_PAYMENT_CAP");
      expect(runPolicyChecks(ctx)).toBe("OVER_PER_PAYMENT_CAP");
    });

    it("accepts exactly 50.00 when cap is 50.00", () => {
      const ctx = createContext(
        {
          Amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "50.00",
          },
        },
        { amount: "50.00" },
        { perPaymentCap: "50.00" }
      );
      expect(checkPerPaymentCap(ctx)).toBeNull();
      expect(runPolicyChecks(ctx)).toBeNull();
    });
  });

  describe("Memo structure check: MEMO_MISMATCH", () => {
    it("rejects no memo (empty Memos array)", () => {
      const ctx = createContext({ Memos: [] });
      expect(checkMemoStructure(ctx)).toBe("MEMO_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("MEMO_MISMATCH");
    });

    it("rejects no memo (Memos omitted)", () => {
      const ctx = createContext();
      delete ctx.decodedTx.Memos;
      expect(checkMemoStructure(ctx)).toBe("MEMO_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("MEMO_MISMATCH");
    });

    it("rejects two memos", () => {
      const validMemo = {
        Memo: {
          MemoType: toHex(MEMO_TYPE),
          MemoData: LOG_ENTRY_HASH,
        },
      };
      const ctx = createContext({ Memos: [validMemo, validMemo] });
      expect(checkMemoStructure(ctx)).toBe("MEMO_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("MEMO_MISMATCH");
    });

    it("rejects wrong MemoType", () => {
      const ctx = createContext({
        Memos: [
          {
            Memo: {
              MemoType: toHex("wrong/type"),
              MemoData: LOG_ENTRY_HASH,
            },
          },
        ],
      });
      expect(checkMemoStructure(ctx)).toBe("MEMO_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("MEMO_MISMATCH");
    });

    it("rejects MemoData not 64 hex characters (e.g. 32 chars)", () => {
      const ctx = createContext({
        Memos: [
          {
            Memo: {
              MemoType: toHex(MEMO_TYPE),
              MemoData: "a".repeat(32),
            },
          },
        ],
      });
      expect(checkMemoStructure(ctx)).toBe("MEMO_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("MEMO_MISMATCH");
    });

    it("rejects MemoData with non-hex characters", () => {
      const ctx = createContext({
        Memos: [
          {
            Memo: {
              MemoType: toHex(MEMO_TYPE),
              MemoData: "z".repeat(64),
            },
          },
        ],
      });
      expect(checkMemoStructure(ctx)).toBe("MEMO_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("MEMO_MISMATCH");
    });

    it("rejects when MemoFormat is present", () => {
      const ctx = createContext({
        Memos: [
          {
            Memo: {
              MemoType: toHex(MEMO_TYPE),
              MemoData: LOG_ENTRY_HASH,
              MemoFormat: toHex("text/plain"),
            },
          },
        ],
      });
      expect(checkMemoStructure(ctx)).toBe("MEMO_MISMATCH");
      expect(runPolicyChecks(ctx)).toBe("MEMO_MISMATCH");
    });
  });

  describe("Precedence and pipeline ordering", () => {
    it("fails destination and cap -> reports DESTINATION_MISMATCH", () => {
      // Fails destination: OTHER_ADDRESS
      // Fails cap: 100.00 > 50.00
      const ctx = createContext(
        {
          Destination: OTHER_ADDRESS,
          Amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "100.00",
          },
        },
        { amount: "100.00" },
        { perPaymentCap: "50.00" }
      );

      // Check 4 (destination) must win over Check 7 (cap)
      expect(runPolicyChecks(ctx)).toBe("DESTINATION_MISMATCH");
    });

    it("fails supplier and destination -> reports SUPPLIER_NOT_APPROVED", () => {
      const ctx = createContext(
        { Destination: OTHER_ADDRESS },
        { supplierId: "sup_unknown" }
      );
      expect(runPolicyChecks(ctx)).toBe("SUPPLIER_NOT_APPROVED");
    });

    it("fails kill switch and supplier -> reports KILL_SWITCH_ON", () => {
      const ctx = createContext(
        {},
        { supplierId: "sup_unknown" },
        { killSwitch: true }
      );
      expect(runPolicyChecks(ctx)).toBe("KILL_SWITCH_ON");
    });
  });
});
