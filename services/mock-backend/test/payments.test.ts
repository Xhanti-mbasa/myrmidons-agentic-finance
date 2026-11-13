import { afterEach, describe, expect, it } from "vitest";
import { fromHex, GENESIS_HASH, LogEntry, PayResult, verifyChain } from "@shucamoxa/shared";
import { DEMO_SEED } from "../src/index";
import { AGENT_TOKEN, pay, startTestBackend, type TestBackend } from "./support/backend";

let backend: TestBackend;
afterEach(() => backend?.close());

async function log(): Promise<LogEntry[]> {
  const res = await backend.agent("GET", "/log");
  expect(res.status).toBe(200);
  return res.json;
}

async function rules() {
  return (await backend.agent("GET", "/rules")).json;
}

describe("POST /payments", () => {
  it("settles a valid payment with an obviously fake MOCK tx hash that never claims a ledger result", async () => {
    backend = await startTestBackend();
    const res = await backend.agent("POST", "/payments", pay("INV-1042", "30.00"));
    expect(res.status).toBe(200);
    const result = PayResult.parse(res.json);
    expect(result).toMatchObject({ status: "settled", ruleCode: "OK" });
    if (result.status !== "settled") throw new Error("unreachable");
    expect(fromHex(result.txHash)).toMatch(/^MOCK-TX-NOT-ON-LEDGER-\d{10}$/);
    const [entry] = await log();
    expect(entry).toMatchObject({ event: "payment_settled", txHash: result.txHash, ledgerResult: "MOCK_NOT_SUBMITTED", amount: "30.00" });
    expect((await rules()).spent).toBe("30.00");
  });

  it("is idempotent: the same invoice twice gives the same PayResult and one log entry", async () => {
    backend = await startTestBackend();
    const first = await backend.agent("POST", "/payments", pay("INV-1042", "30.00"));
    const second = await backend.agent("POST", "/payments", pay("INV-1042", "30", "sup_karoo", "Reworded reason"));
    expect(second.json).toEqual(first.json);
    expect(await log()).toHaveLength(1);
    expect((await rules()).spent).toBe("30.00");
  });

  it("repeats a blocked result too, without logging it again", async () => {
    backend = await startTestBackend();
    const first = await backend.agent("POST", "/payments", pay("INV-2001", "120.00"));
    const second = await backend.agent("POST", "/payments", pay("INV-2001", "120.00"));
    expect(first.json).toMatchObject({ status: "blocked", ruleCode: "OVER_PER_PAYMENT_CAP" });
    expect(second.json).toEqual(first.json);
    expect(await log()).toHaveLength(1);
  });

  it("blocks a settled invoice paid again with a different amount or supplier as DUPLICATE_INVOICE", async () => {
    backend = await startTestBackend();
    const first = await backend.agent("POST", "/payments", pay("INV-1042", "30.00"));
    const otherAmount = await backend.agent("POST", "/payments", pay("INV-1042", "31.00"));
    const otherSupplier = await backend.agent("POST", "/payments", pay("INV-1042", "30.00", "sup_zambezi"));
    expect(otherAmount.json).toMatchObject({ status: "blocked", ruleCode: "DUPLICATE_INVOICE" });
    expect(otherSupplier.json).toMatchObject({ status: "blocked", ruleCode: "DUPLICATE_INVOICE" });
    expect((await rules()).spent).toBe("30.00");
    // The original result still stands for an exact repeat.
    expect((await backend.agent("POST", "/payments", pay("INV-1042", "30.00"))).json).toEqual(first.json);
  });

  it("re-checks an invoice whose first attempt was blocked when the request changes", async () => {
    backend = await startTestBackend();
    await backend.agent("POST", "/payments", pay("INV-7", "30.00", "sup_unknown"));
    const retry = await backend.agent("POST", "/payments", pay("INV-7", "30.00"));
    expect(retry.json).toMatchObject({ status: "settled" });
  });

  it("10 parallel 45.00 payments with distinct invoices never settle more than the 200.00 budget", async () => {
    backend = await startTestBackend();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => backend.agent("POST", "/payments", pay(`INV-P${i}`, "45.00"))),
    );
    const settled = results.filter((r) => r.json.status === "settled");
    expect(settled).toHaveLength(4);
    expect(results.filter((r) => r.json.ruleCode === "OVER_BUDGET")).toHaveLength(6);
    const r = await rules();
    expect(r).toMatchObject({ spent: "180.00", remaining: "20.00" });
  });

  it("keeps the log a valid hash chain under parallel writes", async () => {
    backend = await startTestBackend();
    await Promise.all(Array.from({ length: 8 }, (_, i) => backend.agent("POST", "/payments", pay(`INV-C${i}`, "10.00"))));
    const entries = (await log()).slice().reverse();
    expect(entries[0]?.prevHash).toBe(GENESIS_HASH);
    expect(await verifyChain(entries)).toBeNull();
  });

  it("blocks every payment with KILL_SWITCH_ON once the owner turns the kill switch on", async () => {
    backend = await startTestBackend();
    const owner = await backend.ownerSession();
    expect((await owner("POST", "/owner/api/kill-switch", { on: true })).status).toBe(200);
    const res = await backend.agent("POST", "/payments", pay("INV-1042", "30.00"));
    expect(res.json).toMatchObject({ status: "blocked", ruleCode: "KILL_SWITCH_ON" });
    expect((await rules()).killSwitch).toBe(true);
  });

  it("applies the kill switch before every other check", async () => {
    backend = await startTestBackend({ seed: { ...DEMO_SEED, killSwitch: true } });
    const res = await backend.agent("POST", "/payments", pay("INV-1", "500.00", "sup_unknown"));
    expect(res.json.ruleCode).toBe("KILL_SWITCH_ON");
  });

  it("refuses a supplier that isn't approved", async () => {
    backend = await startTestBackend({
      seed: { ...DEMO_SEED, suppliers: DEMO_SEED.suppliers.map((s) => (s.id === "sup_zambezi" ? { ...s, status: "pending" as const } : s)) },
    });
    expect((await backend.agent("POST", "/payments", pay("INV-1", "10.00", "sup_zambezi"))).json.ruleCode).toBe("SUPPLIER_NOT_APPROVED");
    expect((await backend.agent("POST", "/payments", pay("INV-2", "10.00", "sup_atlas"))).json.ruleCode).toBe("SUPPLIER_NOT_APPROVED");
    expect((await rules()).suppliers.map((s: { id: string }) => s.id)).toEqual(["sup_karoo"]);
  });

  it("compares the cap in cents: 50 and 50.00 pass, 50.01 does not", async () => {
    backend = await startTestBackend();
    expect((await backend.agent("POST", "/payments", pay("INV-A", "50"))).json.status).toBe("settled");
    expect((await backend.agent("POST", "/payments", pay("INV-B", "50.00"))).json.status).toBe("settled");
    expect((await backend.agent("POST", "/payments", pay("INV-C", "50.01"))).json.ruleCode).toBe("OVER_PER_PAYMENT_CAP");
  });

  it("compares the budget in cents: exactly 200.00 settles, one more cent does not", async () => {
    backend = await startTestBackend();
    for (const [i, amount] of ["50.00", "50.00", "50.00", "49.99"].entries()) {
      expect((await backend.agent("POST", "/payments", pay(`INV-${i}`, amount))).json.status).toBe("settled");
    }
    expect((await backend.agent("POST", "/payments", pay("INV-X", "0.02"))).json.ruleCode).toBe("OVER_BUDGET");
    expect((await backend.agent("POST", "/payments", pay("INV-Y", "0.01"))).json.status).toBe("settled");
    expect(await rules()).toMatchObject({ spent: "200.00", remaining: "0.00" });
  });

  it("refuses an off-contract body with 400 and logs nothing", async () => {
    backend = await startTestBackend();
    expect((await backend.agent("POST", "/payments", { ...pay("INV-1", "10.00"), destination: "rAnything" })).status).toBe(400);
    expect((await backend.agent("POST", "/payments", pay("INV-1", "10.5"))).status).toBe(200);
    expect((await backend.agent("POST", "/payments", pay("INV-2", "1e1"))).status).toBe(400);
    const res = await fetch(`${backend.url}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AGENT_TOKEN}`, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await log()).toHaveLength(1);
  });
});

describe("GET /log", () => {
  it("returns newest first and applies LogFilter", async () => {
    backend = await startTestBackend();
    await backend.agent("POST", "/payments", pay("INV-1", "10.00"));
    await backend.agent("POST", "/payments", pay("INV-2", "10.00", "sup_zambezi"));
    await backend.agent("POST", "/payments", pay("INV-3", "90.00"));
    const all = await log();
    expect(all.map((e) => e.invoiceNumber)).toEqual(["INV-3", "INV-2", "INV-1"]);
    expect((await backend.agent("GET", "/log?status=blocked")).json.map((e: LogEntry) => e.invoiceNumber)).toEqual(["INV-3"]);
    expect((await backend.agent("GET", "/log?status=settled&supplierId=sup_zambezi")).json.map((e: LogEntry) => e.invoiceNumber)).toEqual(["INV-2"]);
    expect((await backend.agent("GET", "/log?to=2000-01-01")).json).toEqual([]);
    const today = new Date().toISOString().slice(0, 10);
    expect((await backend.agent("GET", `/log?from=${today}&to=${today}`)).json).toHaveLength(3);
  });

  it("returns at most 50 entries", async () => {
    backend = await startTestBackend();
    await Promise.all(Array.from({ length: 55 }, (_, i) => backend.agent("POST", "/payments", pay(`INV-L${i}`, "99.00"))));
    const entries = await log();
    expect(entries).toHaveLength(50);
    expect(entries[0]?.seq).toBe(55);
  });
});
