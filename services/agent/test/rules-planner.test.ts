import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { scriptedModel } from "./support/scripted-model";
import { AGENT_TOKEN, BACKEND_URL, fakeBackend } from "./support/fake-backend";
import { ATLAS_FIELDS, invoiceTextFor, KAROO_FIELDS } from "./support/invoices";

/** planner: "rules" makes one model call per invoice (extraction); the planner model must never be used. */
function setup(fields: Record<string, unknown>, backendOptions: Parameters<typeof fakeBackend>[0] = {}) {
  const backend = fakeBackend(backendOptions);
  const plannerModel = scriptedModel([]);
  const agent = createAgent({
    extractionModel: scriptedModel([{ text: JSON.stringify(fields) }]).model,
    plannerModel: plannerModel.model,
    planner: "rules",
    backendUrl: BACKEND_URL,
    backendToken: AGENT_TOKEN,
    fetch: backend.fetch,
  });
  const run = () => agent.processInvoice(invoiceTextFor(fields as Parameters<typeof invoiceTextFor>[0]));
  return { backend, plannerModel, run };
}

describe("rules planner (AGENT_PLANNER=rules)", () => {
  it("pays a valid invoice from an approved supplier without calling the planner model", async () => {
    const { backend, plannerModel, run } = setup(KAROO_FIELDS);
    const outcome = await run();
    expect(outcome).toMatchObject({ decision: "paid", ruleCode: "OK" });
    expect(plannerModel.calls).toHaveLength(0);
    expect(backend.payments).toHaveLength(1);
    expect(backend.payments[0]!.body).toMatchObject({ supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "INV-1042" });
  });

  it("proposes an unknown supplier to the owner and pays nothing", async () => {
    const { backend, plannerModel, run } = setup(ATLAS_FIELDS);
    const outcome = await run();
    expect(outcome.decision).toBe("awaiting_owner");
    expect(plannerModel.calls).toHaveLength(0);
    expect(backend.payments).toHaveLength(0);
    expect(backend.approvals).toHaveLength(1);
  });

  it("asks the owner to approve an amount over the per-payment cap and pays nothing", async () => {
    const { backend, run } = setup(KAROO_FIELDS, { perPaymentCap: "20.00" });
    const outcome = await run();
    expect(outcome).toMatchObject({ decision: "awaiting_owner", ruleCode: "OVER_PER_PAYMENT_CAP" });
    expect(backend.payments).toHaveLength(0);
  });

  it("asks the owner when the amount is over the remaining budget", async () => {
    const { backend, run } = setup(KAROO_FIELDS, { remaining: "10.00" });
    const outcome = await run();
    expect(outcome.decision).toBe("awaiting_owner");
    expect(backend.payments).toHaveLength(0);
  });

  it("still stops before any tool when the kill switch is on", async () => {
    const { backend, run } = setup(KAROO_FIELDS, { killSwitch: true });
    expect(await run()).toMatchObject({ decision: "blocked", ruleCode: "KILL_SWITCH_ON" });
    expect(backend.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });
});
