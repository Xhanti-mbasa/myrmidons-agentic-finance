import { readFileSync, existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalResponse } from "@shucamoxa/shared";
import { mockSupplierAddress } from "../src/index";
import { startTestBackend, type TestBackend } from "./support/backend";

let backend: TestBackend;
afterEach(() => backend?.close());

const supplierProposal = {
  kind: "supplier",
  payload: { name: "Atlas Freight", address: mockSupplierAddress("sup_atlas"), evidence: "Invoice INV-3301 names Atlas Freight", invoiceNumber: "INV-3301" },
};
const paymentApproval = {
  kind: "payment",
  payload: { invoiceNumber: "INV-2001", supplierId: "sup_karoo", amount: "120", reason: "Over the per-payment cap" },
};

describe("POST /approvals", () => {
  it("appends each approval to .mock/approvals.jsonl and answers pending", async () => {
    backend = await startTestBackend();
    const a = await backend.agent("POST", "/approvals", supplierProposal);
    const b = await backend.agent("POST", "/approvals", paymentApproval);
    expect(a.status).toBe(201);
    expect(ApprovalResponse.parse(a.json).status).toBe("pending");
    expect(b.json.approvalId).not.toBe(a.json.approvalId);
    const lines = readFileSync(backend.approvalsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ approvalId: a.json.approvalId, status: "pending", kind: "supplier", payload: supplierProposal.payload });
    expect(lines[1]).toMatchObject({ approvalId: b.json.approvalId, kind: "payment" });
  });

  it("logs approval_requested without the proposed address", async () => {
    backend = await startTestBackend();
    await backend.agent("POST", "/approvals", supplierProposal);
    await backend.agent("POST", "/approvals", paymentApproval);
    const res = await backend.agent("GET", "/log");
    expect(res.json.map((e: { event: string }) => e.event)).toEqual(["approval_requested", "approval_requested"]);
    expect(res.json[0]).toMatchObject({ invoiceNumber: "INV-2001", supplierId: "sup_karoo", amount: "120.00" });
    expect(res.text).not.toContain(supplierProposal.payload.address);
  });

  it("refuses an off-contract approval with 400 and writes nothing", async () => {
    backend = await startTestBackend();
    const bad = { kind: "supplier", payload: { ...supplierProposal.payload, address: "rNotARealAddress" } };
    expect((await backend.agent("POST", "/approvals", bad)).status).toBe(400);
    expect((await backend.agent("POST", "/approvals", { ...paymentApproval, approve: true })).status).toBe(400);
    expect(existsSync(backend.approvalsFile)).toBe(false);
    expect((await backend.agent("GET", "/log")).json).toEqual([]);
  });
});
