import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  createReservationsRepo,
  createRulesWriteRepo,
  migrate,
  type ReservationsRepo,
  type ShucamoxaDb,
} from "@shucamoxa/db";
import {
  MEMO_TYPE,
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  toHex,
  XRPL_TESTNET_WSS,
  type CosignRequest,
  type Rules,
} from "@shucamoxa/shared";
import { decode, Wallet } from "xrpl";
import {
  checkDuplicateInvoice,
  checkOverBudget,
  DEFAULT_POLICY_CHECKS,
  runPolicyChecks,
  type PolicyCheckContext,
  type PolicySupplier,
} from "../src/checks";
import { createPolicyServer } from "../src/server";

const CALLER_TOKEN = "policy-caller-secret-token-1234567890";
const DUMMY_HASH_1 = "1".repeat(64);
const DUMMY_HASH_2 = "2".repeat(64);

describe("T22 - Policy budget reservation and duplicate invoice checks", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;
  let reservationsRepo: ReservationsRepo;

  let treasury: Wallet;
  let agent: Wallet;
  let policy: Wallet;
  let supplier: Wallet;
  let env: Record<string, string>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-policy-t22-"));
    dbPath = join(tempDir, "policy-test.db");
    db = createDatabase(dbPath);
    migrate(db);
    reservationsRepo = createReservationsRepo(db);

    treasury = Wallet.generate();
    agent = Wallet.generate();
    policy = Wallet.generate();
    supplier = Wallet.generate();

    env = {
      POLICY_SEED: policy.seed!,
      POLICY_CALLER_TOKEN: CALLER_TOKEN,
      AGENT_ACCOUNT: agent.classicAddress,
      TREASURY_ACCOUNT: treasury.classicAddress,
      XRPL_WSS: XRPL_TESTNET_WSS,
    };

    const rulesWrite = createRulesWriteRepo(db);
    rulesWrite.upsertSupplier({
      id: "sup_karoo",
      name: "Karoo Textiles",
      xrplAddress: supplier.classicAddress,
      status: "approved",
    });

    rulesWrite.setRules({
      perPaymentCapCents: 5000, // $50.00
      totalBudgetCents: 10000, // $100.00
      periodStart: "2026-11-01",
      killSwitch: false,
      updatedBy: "owner",
    });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function makeCosignPayload(
    invoiceNumber: string,
    amountStr: string,
    logEntryHash: string = DUMMY_HASH_1,
    supplierId: string = "sup_karoo"
  ) {
    const tx = {
      TransactionType: "Payment",
      Account: treasury.classicAddress,
      Destination: supplier.classicAddress,
      Amount: {
        currency: RLUSD_CURRENCY_HEX,
        issuer: RLUSD_TESTNET_ISSUER,
        value: amountStr,
      },
      Fee: "20",
      Sequence: 1,
      SigningPubKey: "",
      Flags: 0x80000000,
      Memos: [
        {
          Memo: {
            MemoType: toHex(MEMO_TYPE),
            MemoData: logEntryHash,
          },
        },
      ],
    };

    const signed = agent.sign(tx as any, true);
    const decoded = decode(signed.tx_blob);
    const { Signers: _signers, ...txJson } = decoded;

    const request: CosignRequest = {
      txJson,
      agentSignedBlob: signed.tx_blob,
      request: {
        supplierId,
        amount: amountStr,
        invoiceNumber,
        logEntryHash,
      },
    };

    return { tx, signed, request };
  }

  // =========================================================================
  // Section 1: Unit checks (checkDuplicateInvoice & checkOverBudget)
  // =========================================================================
  describe("Unit checks", () => {
    const baseSupplier: PolicySupplier = {
      id: "sup_karoo",
      name: "Karoo Textiles",
      address: "rSupplier1111111111111111111111",
      status: "approved",
    };

    const baseRules: Rules & { suppliers: PolicySupplier[] } = {
      perPaymentCap: "50.00",
      totalBudget: "100.00",
      spent: "0.00",
      reserved: "0.00",
      remaining: "100.00",
      periodStart: "2026-11-01",
      killSwitch: false,
      suppliers: [baseSupplier],
    };

    function createUnitContext(
      invoiceNumber: string,
      amount: string,
      logEntryHash: string,
      rulesOverrides: Partial<typeof baseRules> = {}
    ): PolicyCheckContext {
      return {
        decodedTx: {
          TransactionType: "Payment",
          Account: "rTreasury111111111111111111111",
          Destination: baseSupplier.address,
          Amount: {
            currency: RLUSD_CURRENCY_HEX,
            issuer: RLUSD_TESTNET_ISSUER,
            value: amount,
          },
        },
        request: {
          txJson: {},
          agentSignedBlob: "00",
          request: {
            supplierId: "sup_karoo",
            amount,
            invoiceNumber,
            logEntryHash,
          },
        },
        rules: { ...baseRules, ...rulesOverrides },
        treasuryAccount: "rTreasury111111111111111111111",
        agentAccount: "rAgent111111111111111111111111",
        db,
        reservationsRepo,
      };
    }

    it("checkDuplicateInvoice returns null when invoice has no prior reservations", () => {
      const ctx = createUnitContext("INV-NEW-1", "30.00", DUMMY_HASH_1);
      expect(checkDuplicateInvoice(ctx)).toBeNull();
    });

    it("checkDuplicateInvoice returns DUPLICATE_INVOICE when invoice is already settled", () => {
      reservationsRepo.createReservation({
        invoiceNumber: "INV-SETTLED",
        supplierId: "sup_karoo",
        amountCents: 3000,
        status: "settled",
        txHash: DUMMY_HASH_1,
      });

      const ctx = createUnitContext("INV-SETTLED", "30.00", DUMMY_HASH_1);
      expect(checkDuplicateInvoice(ctx)).toBe("DUPLICATE_INVOICE");
    });

    it("checkDuplicateInvoice returns DUPLICATE_INVOICE when active reservation exists for another hash", () => {
      reservationsRepo.createReservation({
        invoiceNumber: "INV-ACTIVE",
        supplierId: "sup_karoo",
        amountCents: 3000,
        status: "reserved",
        txHash: DUMMY_HASH_1,
      });

      // Same invoice, but different hash -> duplicate
      const ctx = createUnitContext("INV-ACTIVE", "30.00", DUMMY_HASH_2);
      expect(checkDuplicateInvoice(ctx)).toBe("DUPLICATE_INVOICE");
    });

    it("checkDuplicateInvoice returns null when active reservation exists for the same hash (retry)", () => {
      reservationsRepo.createReservation({
        invoiceNumber: "INV-RETRY",
        supplierId: "sup_karoo",
        amountCents: 3000,
        status: "reserved",
        txHash: DUMMY_HASH_1,
      });

      // Same invoice, same hash -> idempotent retry
      const ctx = createUnitContext("INV-RETRY", "30.00", DUMMY_HASH_1);
      expect(checkDuplicateInvoice(ctx)).toBeNull();
    });

    it("checkDuplicateInvoice returns null when earlier reservation was released", () => {
      reservationsRepo.createReservation({
        invoiceNumber: "INV-RELEASED",
        supplierId: "sup_karoo",
        amountCents: 3000,
        status: "reserved",
        txHash: DUMMY_HASH_1,
      });
      reservationsRepo.releaseReservation("INV-RELEASED");

      const ctx = createUnitContext("INV-RELEASED", "30.00", DUMMY_HASH_2);
      expect(checkDuplicateInvoice(ctx)).toBeNull();
    });

    it("checkOverBudget returns null when total spent + reserved + requested <= totalBudget", () => {
      const ctx = createUnitContext("INV-BUDGET-1", "30.00", DUMMY_HASH_1);
      expect(checkOverBudget(ctx)).toBeNull();
    });

    it("checkOverBudget returns OVER_BUDGET when requested amount exceeds totalBudget", () => {
      // Total budget is $100.00; request is $110.00
      const ctx = createUnitContext("INV-BIG", "110.00", DUMMY_HASH_1);
      expect(checkOverBudget(ctx)).toBe("OVER_BUDGET");
    });

    it("checkOverBudget accounts for settled spent and active reserved amounts", () => {
      // Settle $40.00
      reservationsRepo.createReservation({
        invoiceNumber: "INV-PRIOR-1",
        supplierId: "sup_karoo",
        amountCents: 4000,
        status: "settled",
      });
      // Reserve $40.00
      reservationsRepo.createReservation({
        invoiceNumber: "INV-PRIOR-2",
        supplierId: "sup_karoo",
        amountCents: 4000,
        status: "reserved",
      });

      // Total spent (40) + reserved (40) = 80. Budget is 100. Remaining is 20.
      // Request $20.00 -> exactly 100 -> OK
      const ctxOk = createUnitContext("INV-EXACT", "20.00", DUMMY_HASH_1);
      expect(checkOverBudget(ctxOk)).toBeNull();

      // Request $20.01 -> 100.01 > 100 -> OVER_BUDGET
      const ctxOver = createUnitContext("INV-OVER", "20.01", DUMMY_HASH_1);
      expect(checkOverBudget(ctxOver)).toBe("OVER_BUDGET");
    });

    it("checkOverBudget does not double-count requested amount on idempotent retry of active reservation", () => {
      reservationsRepo.createReservation({
        invoiceNumber: "INV-SAME-HASH",
        supplierId: "sup_karoo",
        amountCents: 9000,
        status: "reserved",
        txHash: DUMMY_HASH_1,
      });

      // Budget is 100. Reserved is 90. If this is a retry of the same hash, requested 90 is NOT added again
      const ctx = createUnitContext("INV-SAME-HASH", "90.00", DUMMY_HASH_1);
      expect(checkOverBudget(ctx)).toBeNull();
    });
  });

  // =========================================================================
  // Section 2: Integration tests with Policy Server
  // =========================================================================
  describe("Policy Server cosign integration", () => {
    it("successfully allows payment and inserts active reservation record on allow", async () => {
      const server = createPolicyServer({ env, db });
      const { request } = makeCosignPayload("INV-ALLOW-1", "30.00", DUMMY_HASH_1);

      const res = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(request),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.decision).toBe("allow");
      expect(json.ruleCode).toBe("OK");
      expect(json.policySignedBlob).toBeDefined();

      // Verify active reservation row was inserted in SQLite
      const active = reservationsRepo.getActiveReservation("INV-ALLOW-1");
      expect(active).not.toBeNull();
      expect(active?.invoice_number).toBe("INV-ALLOW-1");
      expect(active?.supplier_id).toBe("sup_karoo");
      expect(active?.amount_cents).toBe(3000);
      expect(active?.status).toBe("reserved");
      expect(active?.tx_hash).toBe(DUMMY_HASH_1);

      // Verify total reserved cents is updated
      expect(reservationsRepo.getTotalReservedCents()).toBe(3000);
    });

    it("rejects duplicate invoice with DUPLICATE_INVOICE when an active reservation exists for another hash", async () => {
      const server = createPolicyServer({ env, db });
      const { request: firstReq } = makeCosignPayload("INV-DUP-TEST", "20.00", DUMMY_HASH_1);

      // First request: allowed
      const res1 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(firstReq),
      });
      expect(res1.status).toBe(200);
      expect((await res1.json()).decision).toBe("allow");

      // Second request: same invoice number, different hash
      const { request: secondReq } = makeCosignPayload("INV-DUP-TEST", "20.00", DUMMY_HASH_2);
      const res2 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(secondReq),
      });

      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.decision).toBe("block");
      expect(json2.ruleCode).toBe("DUPLICATE_INVOICE");
      expect(json2.reason).toBe("Blocked: this invoice has already been paid or is being paid.");
    });

    it("rejects duplicate invoice with DUPLICATE_INVOICE when invoice has already settled", async () => {
      const server = createPolicyServer({ env, db });
      const { request: req1 } = makeCosignPayload("INV-SETTLE-TEST", "25.00", DUMMY_HASH_1);

      // 1. Allowed and reserved
      const res1 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req1),
      });
      expect((await res1.json()).decision).toBe("allow");

      // 2. Settle the reservation (simulating payment service settlement on XRPL)
      const settledTxHash = "F".repeat(64);
      reservationsRepo.settleReservation("INV-SETTLE-TEST", settledTxHash);

      // Verify DB row is settled
      const settledRow = reservationsRepo.getActiveReservation("INV-SETTLE-TEST");
      expect(settledRow?.status).toBe("settled");
      expect(settledRow?.tx_hash).toBe(settledTxHash);

      // 3. New cosign request for the settled invoice is blocked
      const { request: req2 } = makeCosignPayload("INV-SETTLE-TEST", "25.00", DUMMY_HASH_2);
      const res2 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req2),
      });

      const json2 = await res2.json();
      expect(json2.decision).toBe("block");
      expect(json2.ruleCode).toBe("DUPLICATE_INVOICE");
    });

    it("rejects request with OVER_BUDGET when cumulative spend and reservations exhaust the budget", async () => {
      const server = createPolicyServer({ env, db });
      // Total budget is $100.00; cap is $50.00
      // Request 1: $40.00 -> total reserved $40.00 (remaining $60.00)
      const { request: req1 } = makeCosignPayload("INV-B-1", "40.00", "1".repeat(64));
      const res1 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req1),
      });
      expect((await res1.json()).decision).toBe("allow");

      // Request 2: $40.00 -> total reserved $80.00 (remaining $20.00)
      const { request: req2 } = makeCosignPayload("INV-B-2", "40.00", "2".repeat(64));
      const res2 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req2),
      });
      expect((await res2.json()).decision).toBe("allow");

      // Request 3: $30.00 -> 80 + 30 = 110 > 100 -> OVER_BUDGET
      const { request: req3 } = makeCosignPayload("INV-B-3", "30.00", "3".repeat(64));
      const res3 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req3),
      });

      const json3 = await res3.json();
      expect(json3.decision).toBe("block");
      expect(json3.ruleCode).toBe("OVER_BUDGET");
      expect(json3.reason).toBe(ruleExplanation("OVER_BUDGET"));

      // Verify that failed request did NOT insert a reservation for INV-B-3
      expect(reservationsRepo.getActiveReservation("INV-B-3")).toBeNull();
      // Total reserved remains $80.00
      expect(reservationsRepo.getTotalReservedCents()).toBe(8000);
    });

    it("allows reservation release via server helper or HTTP endpoint, freeing spending capacity", async () => {
      const server = createPolicyServer({ env, db });
      // Total budget $100.00.
      // Reserve $50.00 for INV-REL-1
      const { request: req1 } = makeCosignPayload("INV-REL-1", "50.00", "1".repeat(64));
      await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req1),
      });

      // Attempt $50.01 for INV-REL-2 -> over budget (50 + 50.01 = 100.01 > 100)
      const { request: req2 } = makeCosignPayload("INV-REL-2", "50.00", "2".repeat(64));
      const res2 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req2),
      });
      // 50 + 50 = 100 <= 100, which is allowed exactly at cap
      expect((await res2.json()).decision).toBe("allow");

      // Budget is now fully consumed (50 + 50 = 100.00)
      const { request: req3 } = makeCosignPayload("INV-REL-3", "10.00", "3".repeat(64));
      const res3 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req3),
      });
      expect((await res3.json()).decision).toBe("block");

      // Release INV-REL-1 via POST /reservations/release
      const releaseRes = await server.app.request("/reservations/release", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify({ invoiceNumber: "INV-REL-1" }),
      });
      expect(releaseRes.status).toBe(200);
      expect((await releaseRes.json()).ok).toBe(true);

      // Now remaining budget is 100 - 50 = 50.00.
      // INV-REL-3 ($10.00) should now succeed!
      const res3Retry = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req3),
      });
      expect((await res3Retry.json()).decision).toBe("allow");

      // And INV-REL-1 can also be re-requested because its prior reservation was released
      const { request: req1Again } = makeCosignPayload("INV-REL-1", "30.00", "4".repeat(64));
      const res1Again = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(req1Again),
      });
      // 50 (INV-REL-2) + 10 (INV-REL-3) + 30 (INV-REL-1) = 90 <= 100
      expect((await res1Again.json()).decision).toBe("allow");
    });

    it("allows idempotent retry of the exact same cosign request without double-charging budget", async () => {
      const server = createPolicyServer({ env, db });
      const { request } = makeCosignPayload("INV-IDEMPOTENT", "40.00", DUMMY_HASH_1);

      // First submission
      const res1 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(request),
      });
      const json1 = await res1.json();
      expect(json1.decision).toBe("allow");

      // Second submission: exact same invoiceNumber and logEntryHash
      const res2 = await server.app.request("/cosign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CALLER_TOKEN}`,
        },
        body: JSON.stringify(request),
      });
      const json2 = await res2.json();
      expect(json2.decision).toBe("allow");
      expect(json2.ruleCode).toBe("OK");

      // Total reserved should be exactly 40.00 (not 80.00)
      expect(reservationsRepo.getTotalReservedCents()).toBe(4000);
    });

    // =======================================================================
    // Section 3: Simultaneous / Concurrent reservation safety tests
    // =======================================================================
    it("guarantees concurrent budget safety using SQLite BEGIN IMMEDIATE transactions: never overspends", async () => {
      const server = createPolicyServer({ env, db });
      // Total budget is $100.00. Per payment cap is $50.00.
      // Spawn 5 concurrent cosign requests, each requesting $30.00 for distinct invoices.
      // 5 * $30 = $150 > $100.
      // Exactly 3 requests ($90.00) can succeed. Exactly 2 requests must be blocked with OVER_BUDGET.
      const payloads = [
        makeCosignPayload("INV-CONC-1", "30.00", "1".repeat(64)),
        makeCosignPayload("INV-CONC-2", "30.00", "2".repeat(64)),
        makeCosignPayload("INV-CONC-3", "30.00", "3".repeat(64)),
        makeCosignPayload("INV-CONC-4", "30.00", "4".repeat(64)),
        makeCosignPayload("INV-CONC-5", "30.00", "5".repeat(64)),
      ];

      const responses = await Promise.all(
        payloads.map(({ request }) =>
          server.app.request("/cosign", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CALLER_TOKEN}`,
            },
            body: JSON.stringify(request),
          })
        )
      );

      const results = await Promise.all(responses.map((r) => r.json()));

      const allowed = results.filter((r) => r.decision === "allow");
      const blocked = results.filter((r) => r.decision === "block" && r.ruleCode === "OVER_BUDGET");

      expect(allowed.length).toBe(3);
      expect(blocked.length).toBe(2);

      // Total reserved in SQLite database must be exactly 9000 cents ($90.00)
      const totalReservedCents = reservationsRepo.getTotalReservedCents();
      expect(totalReservedCents).toBe(9000);
      expect(totalReservedCents).toBeLessThanOrEqual(10000);
    });

    it("guarantees concurrent duplicate safety: simultaneous duplicate requests only allow one", async () => {
      const server = createPolicyServer({ env, db });
      // 5 concurrent requests for the SAME invoice number (INV-RACE), each with a distinct logEntryHash
      const payloads = [
        makeCosignPayload("INV-RACE", "20.00", "a".repeat(64)),
        makeCosignPayload("INV-RACE", "20.00", "b".repeat(64)),
        makeCosignPayload("INV-RACE", "20.00", "c".repeat(64)),
        makeCosignPayload("INV-RACE", "20.00", "d".repeat(64)),
        makeCosignPayload("INV-RACE", "20.00", "e".repeat(64)),
      ];

      const responses = await Promise.all(
        payloads.map(({ request }) =>
          server.app.request("/cosign", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CALLER_TOKEN}`,
            },
            body: JSON.stringify(request),
          })
        )
      );

      const results = await Promise.all(responses.map((r) => r.json()));

      const allowed = results.filter((r) => r.decision === "allow");
      const blocked = results.filter((r) => r.decision === "block" && r.ruleCode === "DUPLICATE_INVOICE");

      expect(allowed.length).toBe(1);
      expect(blocked.length).toBe(4);

      // Verify exactly one active reservation exists in SQLite
      const active = reservationsRepo.getActiveReservation("INV-RACE");
      expect(active).not.toBeNull();
      expect(active?.status).toBe("reserved");
      expect(active?.amount_cents).toBe(2000);
    });
  });
});
