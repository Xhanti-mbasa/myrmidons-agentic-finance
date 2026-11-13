import { describe, expect, it } from "vitest";
import { Wallet, hashes, type Payment, type SubmittableTransaction } from "xrpl";
import {
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  XRPL_TESTNET_WSS,
  MEMO_TYPE,
  toHex,
  fromHex,
  type CosignRequest,
  type CosignResponse,
  type PayRequest,
} from "@shucamoxa/shared";
import {
  createPaymentServer,
  loadPaymentConfig,
  assertNoForbiddenSeeds,
  assertTestnetWss,
  MemoryAuditLog,
  PaymentService,
  type RulesStore,
  type SupplierRecord,
  type XrplClientLike,
  type PolicyClientLike,
} from "../src/index";

// Deterministic test wallets generated offline
const agentWallet = Wallet.generate();
const policyWallet = Wallet.generate();
const AGENT_SEED = agentWallet.seed!;
const POLICY_SEED = policyWallet.seed!;

const TREASURY_ACCOUNT = "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv";
const SUPPLIER_A_ADDRESS = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const CALLER_TOKEN = "a".repeat(32);

class FakeXrplClient implements XrplClientLike {
  public currentLedger = 100;
  public submitCount = 0;
  public lastSubmittedBlob?: string;
  public submitError?: Error;
  public submitResult?: any;
  public txQueries: string[] = [];
  public txResponses: any[] = [];

  async autofill<T extends SubmittableTransaction>(tx: T, signersCount = 1): Promise<T> {
    const fee = String((signersCount + 1) * 10);
    return {
      ...tx,
      Sequence: (tx.Sequence as number) ?? 1,
      Fee: (tx.Fee as string) ?? fee,
      LastLedgerSequence: (tx.LastLedgerSequence as number) ?? this.currentLedger + 25, // purposefully high to test cap
    };
  }

  async getLedgerIndex(): Promise<number> {
    return this.currentLedger;
  }

  async submitAndWait(txBlob: string): Promise<any> {
    this.submitCount++;
    this.lastSubmittedBlob = txBlob;

    if (this.submitError) {
      throw this.submitError;
    }

    if (this.submitResult) {
      return this.submitResult;
    }

    const hash = hashes.hashSignedTx(txBlob);
    return {
      result: {
        hash,
        engine_result: "tesSUCCESS",
        meta: {
          TransactionResult: "tesSUCCESS",
          delivered_amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "30.00",
          },
        },
      },
    };
  }

  async request(req: { command: string; [key: string]: unknown }): Promise<any> {
    if (req.command === "tx") {
      this.txQueries.push(req.transaction as string);
      if (this.txResponses.length > 0) {
        const next = this.txResponses.shift();
        if (next instanceof Error) {
          throw next;
        }
        return next;
      }
      return {
        result: {
          validated: true,
          meta: {
            TransactionResult: "tesSUCCESS",
            delivered_amount: {
              currency: RLUSD_CURRENCY_HEX,
              issuer: RLUSD_TESTNET_ISSUER,
              value: "30.00",
            },
          },
        },
      };
    }
    return {};
  }
}

class FakePolicyClient implements PolicyClientLike {
  public calls: CosignRequest[] = [];
  public mode: "allow" | "block" | "tamper" | "down" = "allow";
  public blockRuleCode = "OVER_PER_PAYMENT_CAP";
  public blockReason = "Amount exceeds cap";

  async cosign(req: CosignRequest): Promise<CosignResponse> {
    this.calls.push(req);

    if (this.mode === "down") {
      const err = new Error("fetch failed: ECONNREFUSED");
      (err as any).status = 503;
      throw err;
    }

    if (this.mode === "block") {
      return {
        decision: "block",
        ruleCode: this.blockRuleCode as any,
        reason: this.blockReason,
      };
    }

    if (this.mode === "tamper") {
      // Return a signed transaction for a different destination
      const tamperedTx: Payment = {
        TransactionType: "Payment",
        Account: req.txJson.Account as string,
        Destination: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59", // Attacker destination!
        Amount: req.txJson.Amount as any,
        Fee: req.txJson.Fee as string,
        Sequence: req.txJson.Sequence as number,
        LastLedgerSequence: req.txJson.LastLedgerSequence as number,
        SigningPubKey: "",
      };
      const signed = policyWallet.sign(tamperedTx, true);
      return {
        decision: "allow",
        ruleCode: "OK",
        reason: "Allowed (tampered)",
        policySignedBlob: signed.tx_blob,
      };
    }

    // Default allow: sign the actual requested transaction with policy wallet
    const signed = policyWallet.sign(req.txJson as any, true);
    return {
      decision: "allow",
      ruleCode: "OK",
      reason: "Policy check passed",
      policySignedBlob: signed.tx_blob,
    };
  }
}

interface TestSetup {
  xrpl: FakeXrplClient;
  policy: FakePolicyClient;
  auditLog: MemoryAuditLog;
  rulesStore: RulesStore;
  paymentService: PaymentService;
  app: ReturnType<typeof createPaymentServer>;
  reservations: { reserved: string[]; settled: string[]; released: string[] };
}

function createTestHarness(opts?: {
  maxFeeDrops?: string;
  suppliers?: Record<string, SupplierRecord>;
}): TestSetup {
  const xrpl = new FakeXrplClient();
  const policy = new FakePolicyClient();
  const auditLog = new MemoryAuditLog();

  const reservations = {
    reserved: [] as string[],
    settled: [] as string[],
    released: [] as string[],
  };

  const suppliersMap = new Map<string, SupplierRecord>(
    Object.entries(
      opts?.suppliers ?? {
        sup_karoo: {
          id: "sup_karoo",
          name: "Karoo Tech Ltd",
          address: SUPPLIER_A_ADDRESS,
          destinationTag: 12345,
          status: "approved",
        },
      },
    ),
  );

  const rulesStore: RulesStore = {
    getSupplier: async (id: string) => suppliersMap.get(id) ?? null,
    reserveBudget: async (amount: string, invoice: string) => {
      reservations.reserved.push(`${invoice}:${amount}`);
      return true;
    },
    settleReservation: async (amount: string, invoice: string) => {
      reservations.settled.push(`${invoice}:${amount}`);
    },
    releaseReservation: async (amount: string, invoice: string) => {
      reservations.released.push(`${invoice}:${amount}`);
    },
  };

  const paymentService = new PaymentService({
    agentSeed: AGENT_SEED,
    treasuryAccount: TREASURY_ACCOUNT,
    policyAccount: policyWallet.address,
    maxFeeDrops: opts?.maxFeeDrops ?? "2000",
    pollIntervalMs: 1, // Fast for tests
    rulesStore,
    auditLog,
    policyClient: policy,
    xrplClient: xrpl,
  });

  const app = createPaymentServer({
    callerToken: CALLER_TOKEN,
    paymentService,
  });

  return {
    xrpl,
    policy,
    auditLog,
    rulesStore,
    paymentService,
    app,
    reservations,
  };
}

describe("Payment Service (T26)", () => {
  const validPayRequest: PayRequest = {
    supplierId: "sup_karoo",
    amount: "30.00",
    invoiceNumber: "INV-2026-001",
    reason: "Monthly supply batch 1",
  };

  // 1. Happy path -> {status: settled, ruleCode: OK, txHash, logId}.
  it("1. Happy path -> {status: settled, ruleCode: OK, txHash, logId}", async () => {
    const { app, xrpl, policy, auditLog, reservations } = createTestHarness();

    const res = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("settled");
    expect(body.ruleCode).toBe("OK");
    expect(typeof body.txHash).toBe("string");
    expect(body.txHash).toHaveLength(64);
    expect(typeof body.logId).toBe("string");

    // XRPL submit called once
    expect(xrpl.submitCount).toBe(1);

    // Reservation lifecycle: reserved then settled
    expect(reservations.reserved).toContain("INV-2026-001:30.00");
    expect(reservations.settled).toContain("INV-2026-001:30.00");
    expect(reservations.released).toHaveLength(0);

    // Policy was called with CosignRequest containing logEntryHash
    expect(policy.calls).toHaveLength(1);
    const cosignCall = policy.calls[0]!;
    expect(cosignCall.request.invoiceNumber).toBe("INV-2026-001");
    expect(cosignCall.request.amount).toBe("30.00");

    // Memo verification: tx had MemoType and MemoData
    const tx = cosignCall.txJson as any;
    expect(tx.Memos).toBeDefined();
    expect(tx.Memos[0].Memo.MemoType).toBe(toHex(MEMO_TYPE));
    expect(tx.Memos[0].Memo.MemoData).toBe(toHex(cosignCall.request.logEntryHash));

    // LastLedgerSequence capped at currentLedger + 20
    expect(tx.LastLedgerSequence).toBe(120);

    // Audit entries
    const log = auditLog.getLog();
    expect(log.some((e) => e.event === "payment_requested" && e.invoiceNumber === "INV-2026-001")).toBe(true);
    expect(log.some((e) => e.event === "payment_settled" && e.invoiceNumber === "INV-2026-001" && e.txHash === body.txHash)).toBe(true);
  });

  // 2. Policy blocks with OVER_PER_PAYMENT_CAP -> blocked; submitAndWait never called.
  it("2. Policy blocks with OVER_PER_PAYMENT_CAP -> blocked; submitAndWait never called", async () => {
    const { app, xrpl, policy, auditLog, reservations } = createTestHarness();
    policy.mode = "block";
    policy.blockRuleCode = "OVER_PER_PAYMENT_CAP";
    policy.blockReason = "Invoice amount exceeds $50.00 cap";

    const res = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...validPayRequest, amount: "65.00" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("blocked");
    expect(body.ruleCode).toBe("OVER_PER_PAYMENT_CAP");
    expect(body.txHash).toBeUndefined();

    // submitAndWait never called!
    expect(xrpl.submitCount).toBe(0);

    // Reservation released
    expect(reservations.released).toContain("INV-2026-001:65.00");
    expect(reservations.settled).toHaveLength(0);

    // Audit log has policy_blocked
    const log = auditLog.getLog();
    expect(log.some((e) => e.event === "policy_blocked" && e.ruleCode === "OVER_PER_PAYMENT_CAP")).toBe(true);
  });

  // 3. tecPATH_PARTIAL -> blocked LEDGER_REJECTED with txHash; reservation released; payment_failed logged.
  it("3. tecPATH_PARTIAL -> blocked LEDGER_REJECTED with txHash; reservation released; payment_failed logged", async () => {
    const { app, xrpl, auditLog, reservations } = createTestHarness();
    const fakeHash = "A".repeat(64);
    xrpl.submitResult = {
      result: {
        hash: fakeHash,
        engine_result: "tecPATH_PARTIAL",
        meta: {
          TransactionResult: "tecPATH_PARTIAL",
        },
      },
    };

    const res = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("blocked");
    expect(body.ruleCode).toBe("LEDGER_REJECTED");
    expect(body.txHash).toBe(fakeHash);

    // Reservation released
    expect(reservations.released).toContain("INV-2026-001:30.00");
    expect(reservations.settled).toHaveLength(0);

    // payment_failed logged with ledgerResult and txHash
    const log = auditLog.getLog();
    const failedEntry = log.find((e) => e.event === "payment_failed" && e.txHash === fakeHash);
    expect(failedEntry).toBeDefined();
    expect(failedEntry?.ledgerResult).toBe("tecPATH_PARTIAL");
  });

  // 4. delivered_amount mismatch (29.00 for 30.00) -> blocked LEDGER_REJECTED.
  it("4. delivered_amount mismatch (29.00 for 30.00) -> blocked LEDGER_REJECTED", async () => {
    const { app, xrpl, auditLog, reservations } = createTestHarness();
    const fakeHash = "B".repeat(64);
    xrpl.submitResult = {
      result: {
        hash: fakeHash,
        engine_result: "tesSUCCESS",
        meta: {
          TransactionResult: "tesSUCCESS",
          delivered_amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: "29.00", // Mismatch! Requested was 30.00
          },
        },
      },
    };

    const res = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("blocked");
    expect(body.ruleCode).toBe("LEDGER_REJECTED");

    // Reservation released
    expect(reservations.released).toContain("INV-2026-001:30.00");
    expect(reservations.settled).toHaveLength(0);

    const log = auditLog.getLog();
    expect(log.some((e) => e.event === "payment_failed" && e.ruleCode === "LEDGER_REJECTED")).toBe(true);
  });

  // 5. Same invoiceNumber twice -> identical PayResult and exactly one submit.
  it("5. Same invoiceNumber twice -> identical PayResult and exactly one submit", async () => {
    const { app, xrpl } = createTestHarness();

    // Call 1
    const res1 = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });
    const body1 = await res1.json();

    // Call 2 (repeat)
    const res2 = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });
    const body2 = await res2.json();

    expect(body1).toEqual(body2);
    expect(xrpl.submitCount).toBe(1);

    // Concurrent duplicate calls wait for first; never a second submit
    const concurrentReq: PayRequest = {
      ...validPayRequest,
      invoiceNumber: "INV-CONCURRENT-99",
    };

    const [cRes1, cRes2] = await Promise.all([
      app.request("/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CALLER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(concurrentReq),
      }),
      app.request("/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CALLER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(concurrentReq),
      }),
    ]);

    const cBody1 = await cRes1.json();
    const cBody2 = await cRes2.json();
    expect(cBody1).toEqual(cBody2);
    // 1 submit from initial + 1 from concurrent pair = 2 total submits
    expect(xrpl.submitCount).toBe(2);
  });

  // 6. Timeout then later validated -> settled; never re-submitted.
  it("6. Timeout then later validated -> settled; never re-submitted", async () => {
    const { app, xrpl, reservations } = createTestHarness();
    xrpl.submitError = new Error("XRPL submitAndWait timeout");

    // Queue query responses: first poll fails with txnNotFound, second succeeds with validated tesSUCCESS
    xrpl.txResponses = [
      new Error("txnNotFound"),
      {
        result: {
          validated: true,
          meta: {
            TransactionResult: "tesSUCCESS",
            delivered_amount: {
              currency: RLUSD_CURRENCY_HEX,
              issuer: RLUSD_TESTNET_ISSUER,
              value: "30.00",
            },
          },
        },
      },
    ];

    const res = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("settled");
    expect(body.ruleCode).toBe("OK");
    expect(typeof body.txHash).toBe("string");

    // Exactly one submission attempt: never re-submitted!
    expect(xrpl.submitCount).toBe(1);
    expect(reservations.settled).toContain("INV-2026-001:30.00");
  });

  // 7. Tampered policy blob -> nothing submitted.
  it("7. Tampered policy blob -> nothing submitted", async () => {
    const { app, xrpl, policy, auditLog, reservations } = createTestHarness();
    policy.mode = "tamper"; // Alters destination to an attacker address

    const res = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("blocked");
    expect(body.ruleCode).toBe("LEDGER_REJECTED");

    // Nothing submitted!
    expect(xrpl.submitCount).toBe(0);

    // Reservation released
    expect(reservations.released).toContain("INV-2026-001:30.00");
    expect(reservations.settled).toHaveLength(0);

    const log = auditLog.getLog();
    expect(log.some((e) => e.event === "payment_failed" && e.ruleCode === "LEDGER_REJECTED")).toBe(true);
  });

  // 8. Agent token gets 401; policy down gives 503.
  it("8. Agent token gets 401; policy down gives 503", async () => {
    const { app, policy } = createTestHarness();

    // 401 with missing Authorization header
    const noAuth = await app.request("/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayRequest),
    });
    expect(noAuth.status).toBe(401);

    // 401 with wrong token
    const wrongAuth = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"w".repeat(32)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });
    expect(wrongAuth.status).toBe(401);

    // 503 when policy service is down / unreachable
    policy.mode = "down";
    const downRes = await app.request("/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALLER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validPayRequest),
    });
    expect(downRes.status).toBe(503);
    const downBody = await downRes.json();
    expect(downBody.error).toBe("POLICY_UNAVAILABLE");
  });

  // Additional acceptance criteria tests:
  describe("Supplier approval check & fee limit", () => {
    it("unknown or unapproved supplier is blocked with SUPPLIER_NOT_APPROVED without signing", async () => {
      const { app, xrpl, policy, reservations } = createTestHarness();

      const res = await app.request("/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CALLER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...validPayRequest, supplierId: "sup_unknown" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("blocked");
      expect(body.ruleCode).toBe("SUPPLIER_NOT_APPROVED");

      // No policy call and no submit
      expect(policy.calls).toHaveLength(0);
      expect(xrpl.submitCount).toBe(0);
      expect(reservations.settled).toHaveLength(0);
    });

    it("pending or removed supplier is blocked with SUPPLIER_NOT_APPROVED without signing", async () => {
      const { app, xrpl, policy } = createTestHarness({
        suppliers: {
          sup_pending: {
            id: "sup_pending",
            name: "Pending Supplier",
            address: SUPPLIER_A_ADDRESS,
            status: "pending",
          },
          sup_removed: {
            id: "sup_removed",
            name: "Removed Supplier",
            address: SUPPLIER_A_ADDRESS,
            status: "removed",
          },
        },
      });

      const resPending = await app.request("/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CALLER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...validPayRequest, supplierId: "sup_pending" }),
      });
      const bodyPending = await resPending.json();
      expect(bodyPending.ruleCode).toBe("SUPPLIER_NOT_APPROVED");

      const resRemoved = await app.request("/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CALLER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...validPayRequest, supplierId: "sup_removed" }),
      });
      const bodyRemoved = await resRemoved.json();
      expect(bodyRemoved.ruleCode).toBe("SUPPLIER_NOT_APPROVED");

      expect(policy.calls).toHaveLength(0);
      expect(xrpl.submitCount).toBe(0);
    });

    it("aborts and releases reservation if Fee > MAX_FEE_DROPS", async () => {
      const { app, xrpl, policy, reservations } = createTestHarness({
        maxFeeDrops: "10", // autofill will return 30, which exceeds 10
      });

      const res = await app.request("/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CALLER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validPayRequest),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("blocked");
      expect(body.ruleCode).toBe("LEDGER_REJECTED");

      expect(policy.calls).toHaveLength(0);
      expect(xrpl.submitCount).toBe(0);
      expect(reservations.released).toContain("INV-2026-001:30.00");
    });
  });

  describe("Startup and environment guardrails", () => {
    it("refuses non-testnet XRPL_WSS", () => {
      expect(() => assertTestnetWss("wss://s1.ripple.com")).toThrow("non-testnet XRPL_WSS");
      expect(() => assertTestnetWss("wss://s.devnet.rippletest.net:51233")).toThrow("non-testnet XRPL_WSS");
      expect(() => assertTestnetWss(XRPL_TESTNET_WSS)).not.toThrow();
    });

    it("refuses if env holds POLICY_SEED or owner seed", () => {
      expect(() => assertNoForbiddenSeeds({ POLICY_SEED: "sEd..." })).toThrow("forbidden seed variable: POLICY_SEED");
      expect(() => assertNoForbiddenSeeds({ OWNER_DEV_SEED: "sEd..." })).toThrow("forbidden seed variable: OWNER_DEV_SEED");
      expect(() => assertNoForbiddenSeeds({ OWNER_SEED: "sEd..." })).toThrow("forbidden seed variable: OWNER_SEED");
      expect(() => assertNoForbiddenSeeds({ AGENT_SEED })).not.toThrow();
    });

    it("loadPaymentConfig validates token length and accounts", () => {
      expect(() =>
        loadPaymentConfig({
          PAYMENT_CALLER_TOKEN: "too-short",
          AGENT_SEED,
          TREASURY_ACCOUNT,
          POLICY_ACCOUNT: policyWallet.address,
        }),
      ).toThrow("PAYMENT_CALLER_TOKEN must be at least 32 characters");

      expect(() =>
        loadPaymentConfig({
          PAYMENT_CALLER_TOKEN: "a".repeat(32),
          AGENT_SEED,
          TREASURY_ACCOUNT: "invalid_address",
          POLICY_ACCOUNT: policyWallet.address,
        }),
      ).toThrow("invalid TREASURY_ACCOUNT");
    });
  });
});
