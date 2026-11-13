/**
 * agentApiContract: the agent-facing backend contract as a reusable Vitest suite. It runs against the
 * T15 dev mock (services/mock-backend) and, unchanged, against W4's real API (T30), so the two can't
 * drift apart.
 *
 * Safe to run against a real backend: the only payment it requests is for a supplier ID that can't be
 * approved, so nothing can settle. It does create one pending payment approval, whose reason says to
 * decline it.
 *
 * Usage, in a test file whose server is already listening:
 *   agentApiContract("http://127.0.0.1:8787", process.env.AGENT_TOKEN!);
 */
import { describe, expect, it } from "vitest";
import { encodeAccountID, isValidClassicAddress, isValidXAddress } from "ripple-address-codec";
import { z } from "zod";
import { ApprovalResponse, LogEntry, PayResult, Rules, SupplierLookup } from "../src/index";

/** Classic r-address shape (the same scan T30 uses). Matched as a shape, checksum or not. */
const CLASSIC_ADDRESS_SHAPE = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;

/** Every classic or X-address in a response body. Shape matches count even with a bad checksum. */
export function addressesIn(text: string): string[] {
  const found = new Set<string>(text.match(CLASSIC_ADDRESS_SHAPE) ?? []);
  for (const token of text.split(/[^0-9A-Za-z]+/)) {
    if (token.length < 25) continue;
    if (safe(() => isValidClassicAddress(token)) || safe(() => isValidXAddress(token))) found.add(token);
  }
  return [...found];
}

function safe(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

const LogPage = z.array(LogEntry).max(50);

/** An ID that matches SupplierId but that no backend will have approved, so a payment to it can't settle. */
const UNAPPROVED_SUPPLIER = "sup_contract_check_never_approved";

/**
 * Write routes the agent token must never reach. POST /payments and POST /approvals are the agent's
 * only writes; everything here would change rules, suppliers, the kill switch, an approval or the log.
 */
const FORBIDDEN_WRITES: ReadonlyArray<readonly [method: string, path: string]> = [
  ["POST", "/rules"],
  ["PUT", "/rules"],
  ["PATCH", "/rules"],
  ["DELETE", "/rules"],
  ["POST", "/suppliers"],
  ["PUT", "/suppliers/sup_karoo"],
  ["PATCH", "/suppliers/sup_karoo"],
  ["DELETE", "/suppliers/sup_karoo"],
  ["POST", "/log"],
  ["PUT", "/log"],
  ["PATCH", "/log"],
  ["DELETE", "/log"],
  ["DELETE", "/log/1"],
  ["PUT", "/payments"],
  ["PATCH", "/payments"],
  ["DELETE", "/payments"],
  ["PUT", "/approvals"],
  ["PATCH", "/approvals"],
  ["DELETE", "/approvals"],
  ["PATCH", "/approvals/appr_contract_check"],
  ["POST", "/approvals/appr_contract_check/decision"],
  ["POST", "/approvals/appr_contract_check/approve"],
  ["POST", "/kill-switch"],
  ["POST", "/owner/kill-switch"],
  ["POST", "/dev/kill-switch"],
];

/** A checksum-valid address for a made-up account ID ("CONTRACT-CHECK-ONLY" + NUL): nobody holds its key. */
const KEYLESS_ADDRESS = encodeAccountID(new TextEncoder().encode("CONTRACT-CHECK-ONLY\0"));

/** A body that would loosen every rule if any of those routes accepted it. */
const LOOSENING_BODY = {
  on: false,
  killSwitch: false,
  perPaymentCap: "999999.00",
  totalBudget: "999999.00",
  status: "approved",
  decision: "approve",
  name: "Contract Check Supplier",
  address: KEYLESS_ADDRESS,
};

export function agentApiContract(baseUrl: string, agentToken: string): void {
  const request = (method: string, path: string, options: { body?: unknown; token?: string | null } = {}) => {
    const token = options.token === undefined ? agentToken : options.token;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  const readJson = async (res: Response) => {
    const text = await res.text();
    return { text, json: JSON.parse(text) as unknown };
  };

  const unique = () => `CONTRACT-CHECK-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  describe(`agent API contract (${baseUrl})`, () => {
    describe("authentication", () => {
      const agentRoutes: ReadonlyArray<readonly [string, string]> = [
        ["GET", "/rules"],
        ["GET", "/suppliers?q=Karoo%20Textiles"],
        ["GET", "/log"],
        ["POST", "/payments"],
        ["POST", "/approvals"],
      ];

      it.each(agentRoutes)("%s %s without a token is 401", async (method, path) => {
        const res = await request(method, path, { token: null, body: method === "POST" ? {} : undefined });
        expect(res.status).toBe(401);
      });

      it.each(agentRoutes)("%s %s with a wrong token is 401", async (method, path) => {
        const res = await request(method, path, { token: `${agentToken}x`, body: method === "POST" ? {} : undefined });
        expect(res.status).toBe(401);
      });
    });

    describe("GET /rules", () => {
      it("parses as Rules and contains no address anywhere", async () => {
        const res = await request("GET", "/rules");
        expect(res.status).toBe(200);
        const { text, json } = await readJson(res);
        expect(Rules.safeParse(json).success).toBe(true);
        expect(addressesIn(text)).toEqual([]);
      });
    });

    describe("GET /suppliers", () => {
      it.each(["Karoo Textiles (Pty) Ltd", "Zambezi Spices", "Atlas Freight Ltd", "Karoo"])(
        "q=%s parses as SupplierLookup and never returns an address",
        async (q) => {
          const res = await request("GET", `/suppliers?q=${encodeURIComponent(q)}`);
          expect(res.status).toBe(200);
          const { text, json } = await readJson(res);
          expect(SupplierLookup.safeParse(json).success).toBe(true);
          expect(addressesIn(text)).toEqual([]);
        },
      );

      it("refuses a missing query with 400", async () => {
        expect((await request("GET", "/suppliers")).status).toBe(400);
      });
    });

    describe("GET /log", () => {
      it("parses as at most 50 LogEntry rows", async () => {
        const res = await request("GET", "/log");
        expect(res.status).toBe(200);
        expect(LogPage.safeParse((await readJson(res)).json).success).toBe(true);
      });

      it("accepts every LogFilter field", async () => {
        const res = await request("GET", `/log?${new URLSearchParams({ supplierId: "sup_karoo", from: "2026-01-01", to: "2099-12-31", status: "blocked" })}`);
        expect(res.status).toBe(200);
        expect(LogPage.safeParse((await readJson(res)).json).success).toBe(true);
      });

      it("refuses an unknown filter or a bad value with 400", async () => {
        expect((await request("GET", "/log?limit=1000")).status).toBe(400);
        expect((await request("GET", "/log?status=deleted")).status).toBe(400);
      });
    });

    describe("POST /payments", () => {
      it("answers a well-formed request with a PayResult, and an unapproved supplier never settles", async () => {
        const res = await request("POST", "/payments", {
          body: { supplierId: UNAPPROVED_SUPPLIER, amount: "1.00", invoiceNumber: unique(), reason: "Contract check: must be blocked." },
        });
        expect(res.status).toBe(200);
        const { text, json } = await readJson(res);
        const parsed = PayResult.safeParse(json);
        expect(parsed.success).toBe(true);
        expect(parsed.data?.status).toBe("blocked");
        expect(["SUPPLIER_NOT_APPROVED", "KILL_SWITCH_ON"]).toContain(parsed.data?.ruleCode);
        expect(addressesIn(text)).toEqual([]);
      });

      it("refuses a body that carries a destination with 400", async () => {
        const res = await request("POST", "/payments", {
          body: {
            supplierId: UNAPPROVED_SUPPLIER,
            amount: "1.00",
            invoiceNumber: unique(),
            reason: "Contract check",
            destination: LOOSENING_BODY.address,
          },
        });
        expect(res.status).toBe(400);
      });

      it("refuses a float amount with 400", async () => {
        const res = await request("POST", "/payments", {
          body: { supplierId: UNAPPROVED_SUPPLIER, amount: 1, invoiceNumber: unique(), reason: "Contract check" },
        });
        expect(res.status).toBe(400);
      });
    });

    describe("POST /approvals", () => {
      it("answers a payment approval request with an ApprovalResponse", async () => {
        const res = await request("POST", "/approvals", {
          body: {
            kind: "payment",
            payload: { invoiceNumber: unique(), supplierId: UNAPPROVED_SUPPLIER, amount: "1.00", reason: "Contract check: decline this approval." },
          },
        });
        expect(res.ok).toBe(true);
        expect(ApprovalResponse.safeParse((await readJson(res)).json).success).toBe(true);
      });

      it("refuses an off-contract body with 400", async () => {
        expect((await request("POST", "/approvals", { body: { kind: "rules", payload: {} } })).status).toBe(400);
      });
    });

    describe("route scope", () => {
      it.each(["GET", "POST"])("an unknown route (%s) is 404", async (method) => {
        const res = await request(method, "/contract-check-no-such-route", { body: method === "POST" ? {} : undefined });
        expect(res.status).toBe(404);
      });

      it("refuses the agent token on every write route except POST /payments and POST /approvals, and the rules don't change", async () => {
        const before = (await readJson(await request("GET", "/rules"))).json;
        for (const [method, path] of FORBIDDEN_WRITES) {
          const res = await request(method, path, { body: LOOSENING_BODY });
          expect([401, 403, 404, 405], `${method} ${path} answered ${res.status}`).toContain(res.status);
        }
        const after = (await readJson(await request("GET", "/rules"))).json;
        expect(after).toEqual(before);
      });
    });
  });
}
