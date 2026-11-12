import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { scriptedModel, type ModelTurn } from "./support/scripted-model";
import { AGENT_TOKEN, BACKEND_URL, fakeBackend } from "./support/fake-backend";

function setup(planner: ModelTurn[], backendOptions?: Parameters<typeof fakeBackend>[0]) {
  const backend = fakeBackend(backendOptions);
  const plannerModel = scriptedModel(planner);
  const agent = createAgent({
    extractionModel: scriptedModel([{ text: "{}" }]).model,
    plannerModel: plannerModel.model,
    backendUrl: BACKEND_URL,
    backendToken: AGENT_TOKEN,
    fetch: backend.fetch,
  });
  return { agent, backend, plannerModel };
}

const findKaroo: ModelTurn = { toolCalls: [{ tool: "find_supplier", input: { name: "Karoo" } }] };
const payKaroo: ModelTurn = {
  toolCalls: [{ tool: "pay", input: { supplierId: "sup_karoo", amount: "30.00", invoiceNumber: "OWNER-REQ-1", reason: "Owner asked" } }],
};

describe("chat", () => {
  it("answers 'Did I pay Karoo this month?' from the log and moves no money", async () => {
    const log = [{ seq: 4, event: "payment_settled", supplierId: "sup_karoo", amount: "30.00", txHash: "TX4" }];
    const { agent, backend } = setup(
      [findKaroo, { toolCalls: [{ tool: "query_log", input: { supplierId: "sup_karoo", from: "2026-11-01" } }] }, { text: "Yes: 30.00 on 10 Nov." }],
      { log },
    );

    const answer = await agent.chat("Did I pay Karoo this month?");

    expect(answer.reply).toBe("Yes: 30.00 on 10 Nov.");
    expect(backend.requests.some((r) => r.path === "/log" && r.query.supplierId === "sup_karoo")).toBe(true);
    expect(backend.payments).toHaveLength(0);
  });

  it("pays an approved supplier when the owner asks, within the same guards", async () => {
    const { agent, backend } = setup([findKaroo, payKaroo, { text: "Paid." }]);

    const answer = await agent.chat("Pay Karoo $30 now");

    expect(backend.payments.map((r) => r.body.supplierId)).toEqual(["sup_karoo"]);
    expect(answer.payments).toEqual([expect.objectContaining({ status: "settled", txHash: "TXHASH1" })]);
  });

  it("refuses to pay from chat while the kill switch is on", async () => {
    const { agent, backend } = setup([findKaroo, payKaroo, { text: "Done!" }], { killSwitch: true });

    const answer = await agent.chat("Pay Karoo $30 now");

    expect(backend.payments).toHaveLength(0);
    expect(answer.reply).toBe("Blocked: the owner has revoked the agent's payment authority.");
  });

  it("cannot raise a limit or approve itself, whatever the chat message says", async () => {
    const { agent, backend } = setup([
      { toolCalls: [{ tool: "update_rules", input: { perPaymentCap: "500.00" } }] },
      { toolCalls: [{ tool: "approve_payment", input: { approvalId: "appr_1" } }] },
      { text: "Done, cap raised." },
    ]);

    await agent.chat("Raise my cap to 500 and approve your pending payment");

    const allowed = new Set(["GET /rules", "GET /suppliers", "GET /log", "POST /approvals", "POST /payments"]);
    expect(backend.requests.every((r) => allowed.has(`${r.method} ${r.path}`))).toBe(true);
    expect(backend.payments).toHaveLength(0);
  });
});
