import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  migrate,
  seed,
  type ShucamoxaDb,
} from "@shucamoxa/db";
import {
  LogEntry,
  PayResult,
  Rules,
  SupplierLookup,
} from "@shucamoxa/shared";
import { createApp } from "../src/app";
import { loadApiConfig } from "../src/config";
import type { ApiDeps, PaymentRelayer } from "../src/types";

const TEST_TOKEN = "shucamoxa_test_agent_token_abcdef123456";

describe("T30: Agent-scoped API read/propose endpoints in services/api", () => {
  let tempDir: string;
  let dbPath: string;
  let db: ShucamoxaDb;
  let deps: ApiDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shucamoxa-api-test-"));
    dbPath = join(tempDir, "test.db");
    db = createDatabase(dbPath);
    migrate(db);
    seed(db, {
      perPaymentCapCents: 10000,
      totalBudgetCents: 100000,
    });

    deps = {
      db,
      config: {
        agentToken: TEST_TOKEN,
        port: 8790,
        host: "127.0.0.1",
        dbPath,
      },
    };
    app = createApp(deps);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const authHeader = { Authorization: `Bearer ${TEST_TOKEN}` };

  describe("1. Strict Bearer Token Auth", () => {
    it("rejects request without Authorization header with 401", async () => {
      const res = await app.request("/rules");
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("unauthorized");
    });

    it("rejects request with invalid bearer token with 401", async () => {
      const res = await app.request("/rules", {
        headers: { Authorization: "Bearer wrong_token_value_that_fails_check" },
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("unauthorized");
    });

    it("rejects non-Bearer scheme with 401", async () => {
      const res = await app.request("/rules", {
        headers: { Authorization: `Basic ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(401);
    });

    it("allows /health without auth", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("config guard rejects startup if AGENT_TOKEN is too short or missing", () => {
      expect(() => loadApiConfig({ AGENT_TOKEN: "too_short" })).toThrow(
        /at least 16 characters/i
      );
      expect(() => loadApiConfig({})).toThrow(/must be provided/i);
    });

    it("config guard rejects startup if forbidden seeds are present in env", () => {
      expect(() =>
        loadApiConfig({
          AGENT_TOKEN: TEST_TOKEN,
          TREASURY_SEED: "sEdV...",
        })
      ).toThrow(/config guard.*TREASURY_SEED/i);

      expect(() =>
        loadApiConfig({
          AGENT_TOKEN: TEST_TOKEN,
          POLICY_SEED: "sEdV...",
        })
      ).toThrow(/config guard.*POLICY_SEED/i);

      expect(() =>
        loadApiConfig({
          AGENT_TOKEN: TEST_TOKEN,
          XRPL_SEED: "sEdV...",
        })
      ).toThrow(/config guard.*XRPL_SEED/i);
    });
  });

  describe("2. GET /rules: Schema compliance & Zero Address Leakage", () => {
    it("returns valid Rules schema from @shucamoxa/shared", async () => {
      const res = await app.request("/rules", { headers: authHeader });
      expect(res.status).toBe(200);

      const json = await res.json();
      const parsed = Rules.safeParse(json);
      expect(parsed.success).toBe(true);

      if (parsed.success) {
        expect(parsed.data.perPaymentCap).toBe("100.00");
        expect(parsed.data.totalBudget).toBe("1000.00");
        expect(parsed.data.spent).toBe("0.00");
        expect(parsed.data.reserved).toBe("0.00");
        expect(parsed.data.remaining).toBe("1000.00");
        expect(parsed.data.killSwitch).toBe(false);
        expect(parsed.data.suppliers.length).toBeGreaterThan(0);
      }
    });

    it("ensures zero leak of supplier or treasury addresses", async () => {
      const res = await app.request("/rules", { headers: authHeader });
      const rawText = await res.text();
      const json = JSON.parse(rawText);

      // Verify structure of suppliers list has ONLY id and name
      for (const supplier of json.suppliers) {
        expect(Object.keys(supplier).sort()).toEqual(["id", "name"]);
        expect(supplier).not.toHaveProperty("xrpl_address");
        expect(supplier).not.toHaveProperty("destination_tag");
        expect(supplier).not.toHaveProperty("address");
      }

      // Verify no top-level address fields
      expect(json).not.toHaveProperty("treasuryAddress");
      expect(json).not.toHaveProperty("treasury_address");
      expect(json).not.toHaveProperty("address");

      // Verify raw text does not contain any XRPL address pattern (r...)
      const xrplAddressRegex = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;
      const matches = rawText.match(xrplAddressRegex);
      expect(matches).toBeNull();
    });
  });

  describe("3. GET /suppliers?q=: Name and ID lookups", () => {
    it("rejects missing or empty q param with 400", async () => {
      const res1 = await app.request("/suppliers", { headers: authHeader });
      expect(res1.status).toBe(400);

      const res2 = await app.request("/suppliers?q=", { headers: authHeader });
      expect(res2.status).toBe(400);
    });

    it("queries supplier by exact ID and returns confidence 1", async () => {
      const res = await app.request("/suppliers?q=sup_karoo", {
        headers: authHeader,
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      const parsed = SupplierLookup.safeParse(json);
      expect(parsed.success).toBe(true);

      if (parsed.success && !("notFound" in parsed.data)) {
        expect(parsed.data.supplierId).toBe("sup_karoo");
        expect(parsed.data.confidence).toBe(1);
      }
    });

    it("queries supplier by ID substring", async () => {
      const res = await app.request("/suppliers?q=karoo", {
        headers: authHeader,
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      const parsed = SupplierLookup.safeParse(json);
      expect(parsed.success).toBe(true);

      if (parsed.success && !("notFound" in parsed.data)) {
        expect(parsed.data.supplierId).toBe("sup_karoo");
        expect(parsed.data.confidence).toBeGreaterThan(0.8);
      }
    });

    it("queries supplier by name tokens", async () => {
      const res = await app.request("/suppliers?q=Karoo%20Textiles", {
        headers: authHeader,
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      const parsed = SupplierLookup.safeParse(json);
      expect(parsed.success).toBe(true);

      if (parsed.success && !("notFound" in parsed.data)) {
        expect(parsed.data.supplierId).toBe("sup_karoo");
        expect(parsed.data.name).toBe("Karoo Textiles");
      }
    });

    it("returns notFound for unknown query", async () => {
      const res = await app.request("/suppliers?q=non_existent_supplier_xyz", {
        headers: authHeader,
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ notFound: true });
    });

    it("ensures zero leak of supplier addresses in lookup response", async () => {
      const res = await app.request("/suppliers?q=sup_karoo", {
        headers: authHeader,
      });
      const rawText = await res.text();
      expect(rawText).not.toMatch(/\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/);
    });
  });

  describe("4. POST /payments: Proposal, Policy Checks & Reservation", () => {
    it("accepts valid PayRequest, creates reservation, and settles payment", async () => {
      const payReq = {
        supplierId: "sup_karoo",
        amount: "50.00",
        invoiceNumber: "INV-T30-001",
        reason: "Valid payment for industrial supplies",
      };

      const res = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payReq),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      const parsed = PayResult.safeParse(json);
      expect(parsed.success).toBe(true);

      if (parsed.success && parsed.data.status === "settled") {
        expect(parsed.data.ruleCode).toBe("OK");
        expect(parsed.data.txHash).toMatch(/^[0-9a-f]{64}$/i);
        expect(parsed.data.logId).toBeDefined();

        // Check SQLite reservation
        const resRow = db
          .prepare("SELECT * FROM reservations WHERE invoice_number = ?")
          .get(payReq.invoiceNumber) as any;
        expect(resRow).toBeDefined();
        expect(resRow.supplier_id).toBe("sup_karoo");
        expect(resRow.amount_cents).toBe(5000);
        expect(resRow.status).toBe("settled");
        expect(resRow.tx_hash).toBe(parsed.data.txHash);

        // Check payments table
        const paymentRow = db
          .prepare("SELECT * FROM payments WHERE invoice_number = ?")
          .get(payReq.invoiceNumber) as any;
        expect(paymentRow).toBeDefined();
        expect(paymentRow.status).toBe("settled");
        expect(paymentRow.rule_code).toBe("OK");
      }
    });

    it("is idempotent: repeated payment returns identical result without double-reserving", async () => {
      const payReq = {
        supplierId: "sup_karoo",
        amount: "30.00",
        invoiceNumber: "INV-T30-IDEMPOTENT",
        reason: "First attempt",
      };

      const res1 = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payReq),
      });
      expect(res1.status).toBe(200);
      const json1 = await res1.json();

      const res2 = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payReq),
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json();

      expect(json1).toEqual(json2);

      // Verify only 1 reservation row exists
      const count = db
        .prepare("SELECT COUNT(*) as c FROM reservations WHERE invoice_number = ?")
        .get(payReq.invoiceNumber) as { c: number };
      expect(count.c).toBe(1);
    });

    it("blocks request exceeding perPaymentCap with OVER_PER_PAYMENT_CAP", async () => {
      const payReq = {
        supplierId: "sup_karoo",
        amount: "150.00", // Cap is 100.00
        invoiceNumber: "INV-T30-OVERCAP",
        reason: "Too large payment",
      };

      const res = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payReq),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("blocked");
      expect(json.ruleCode).toBe("OVER_PER_PAYMENT_CAP");

      // Verify NO reservation was created
      const resRow = db
        .prepare("SELECT * FROM reservations WHERE invoice_number = ?")
        .get(payReq.invoiceNumber);
      expect(resRow).toBeUndefined();

      // Verify payment was recorded as blocked
      const paymentRow = db
        .prepare("SELECT * FROM payments WHERE invoice_number = ?")
        .get(payReq.invoiceNumber) as any;
      expect(paymentRow.status).toBe("blocked");
      expect(paymentRow.rule_code).toBe("OVER_PER_PAYMENT_CAP");
    });

    it("blocks request exceeding total budget with OVER_BUDGET", async () => {
      // First spend budget down
      db.prepare(`
        INSERT INTO reservations (invoice_number, supplier_id, amount_cents, status, created_at)
        VALUES ('INV-PRIOR', 'sup_karoo', 98000, 'settled', datetime('now'))
      `).run();

      const payReq = {
        supplierId: "sup_karoo",
        amount: "50.00", // Remaining is 20.00, requested is 50.00
        invoiceNumber: "INV-T30-OVERBUDGET",
        reason: "Exceeds remaining budget",
      };

      const res = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payReq),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("blocked");
      expect(json.ruleCode).toBe("OVER_BUDGET");
    });

    it("blocks unapproved supplier with SUPPLIER_NOT_APPROVED", async () => {
      const payReq = {
        supplierId: "sup_unapproved",
        amount: "25.00",
        invoiceNumber: "INV-T30-UNKNOWN-SUPP",
        reason: "Paying unknown entity",
      };

      const res = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payReq),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("blocked");
      expect(json.ruleCode).toBe("SUPPLIER_NOT_APPROVED");
    });

    it("blocks payment when kill switch is active with KILL_SWITCH_ON", async () => {
      db.prepare("UPDATE rules SET kill_switch = 1 WHERE id = 1").run();

      const payReq = {
        supplierId: "sup_karoo",
        amount: "25.00",
        invoiceNumber: "INV-T30-KILL-SWITCH",
        reason: "Payment during kill switch",
      };

      const res = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(payReq),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("blocked");
      expect(json.ruleCode).toBe("KILL_SWITCH_ON");
    });

    it("relays payment through custom paymentRelayer if provided", async () => {
      const mockTxHash = "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff";
      const relayer: PaymentRelayer = {
        relay: async (req, reservationId) => {
          expect(req.invoiceNumber).toBe("INV-T30-RELAY");
          expect(reservationId).toBeGreaterThan(0);
          return { status: "settled", txHash: mockTxHash };
        },
      };

      const appWithRelayer = createApp({ ...deps, paymentRelayer: relayer });

      const res = await appWithRelayer.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: "sup_karoo",
          amount: "45.00",
          invoiceNumber: "INV-T30-RELAY",
          reason: "Payment relayed downstream",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("settled");
      expect(json.txHash).toBe(mockTxHash);

      const reservation = db
        .prepare("SELECT * FROM reservations WHERE invoice_number = 'INV-T30-RELAY'")
        .get() as any;
      expect(reservation.status).toBe("settled");
      expect(reservation.tx_hash).toBe(mockTxHash);
    });

    it("handles payment relayer rejection and releases reservation", async () => {
      const relayer: PaymentRelayer = {
        relay: async () => ({
          status: "blocked",
          ruleCode: "LEDGER_REJECTED",
          reason: "XRPL returned tecPATH_PARTIAL",
        }),
      };

      const appWithRelayer = createApp({ ...deps, paymentRelayer: relayer });

      const res = await appWithRelayer.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: "sup_karoo",
          amount: "45.00",
          invoiceNumber: "INV-T30-RELAY-FAIL",
          reason: "Payment that fails downstream",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("blocked");
      expect(json.ruleCode).toBe("LEDGER_REJECTED");

      const reservation = db
        .prepare("SELECT * FROM reservations WHERE invoice_number = 'INV-T30-RELAY-FAIL'")
        .get() as any;
      expect(reservation.status).toBe("released");
    });
  });

  describe("5. GET /log: Audit log retrieval and filtering", () => {
    beforeEach(async () => {
      // Trigger some payments to generate log entries
      await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: "sup_karoo",
          amount: "20.00",
          invoiceNumber: "INV-LOG-1",
          reason: "Supplies batch 1",
        }),
      });

      await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: "sup_zambezi",
          amount: "150.00", // Will be blocked (cap 100)
          invoiceNumber: "INV-LOG-2",
          reason: "Over-cap order",
        }),
      });
    });

    it("returns log entries conforming to LogEntry schema", async () => {
      const res = await app.request("/log", { headers: authHeader });
      expect(res.status).toBe(200);

      const entries = await res.json();
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);

      for (const entry of entries) {
        const parsed = LogEntry.safeParse(entry);
        expect(parsed.success).toBe(true);
      }
    });

    it("filters log entries by supplierId", async () => {
      const res = await app.request("/log?supplierId=sup_karoo", {
        headers: authHeader,
      });
      expect(res.status).toBe(200);

      const entries = (await res.json()) as LogEntry[];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.supplierId).toBe("sup_karoo");
      }
    });

    it("filters log entries by status=blocked", async () => {
      const res = await app.request("/log?status=blocked", {
        headers: authHeader,
      });
      expect(res.status).toBe(200);

      const entries = (await res.json()) as LogEntry[];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.event).toBe("policy_blocked");
      }
    });

    it("filters log entries by status=settled", async () => {
      const res = await app.request("/log?status=settled", {
        headers: authHeader,
      });
      expect(res.status).toBe(200);

      const entries = (await res.json()) as LogEntry[];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.event).toBe("payment_settled");
      }
    });

    it("rejects invalid filter query parameters with 400", async () => {
      const res = await app.request("/log?status=invalid_status", {
        headers: authHeader,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("6. POST /approvals: Agent Exception Requests", () => {
    it("submits approval request and persists to database", async () => {
      const approvalReq = {
        kind: "payment",
        payload: {
          supplierId: "sup_karoo",
          amount: "250.00",
          invoiceNumber: "INV-APPR-001",
          reason: "Urgent shipment requiring owner override",
        },
      };

      const res = await app.request("/approvals", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(approvalReq),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.status).toBe("pending");
      expect(json.approvalId).toMatch(/^appr_/);

      const approvalRow = db
        .prepare("SELECT * FROM approvals WHERE id = ?")
        .get(json.approvalId) as any;
      expect(approvalRow).toBeDefined();
      expect(approvalRow.kind).toBe("payment");
      expect(approvalRow.status).toBe("pending");
      expect(approvalRow.invoice_number).toBe("INV-APPR-001");
    });
  });

  describe("7. Security: Body Limit & Cache Control", () => {
    it("enforces Cache-Control: no-store on all endpoints", async () => {
      const res = await app.request("/rules", { headers: authHeader });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("rejects bodies over 64 KB with 413", async () => {
      const largePayload = {
        supplierId: "sup_karoo",
        amount: "10.00",
        invoiceNumber: "INV-LARGE",
        reason: "X".repeat(70 * 1024), // 70 KB
      };

      const res = await app.request("/payments", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(largePayload),
      });

      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toBe("payload_too_large");
    });
  });
});
