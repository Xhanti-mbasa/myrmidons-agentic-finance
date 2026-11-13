import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { chatInvoiceNumber } from "../src/ids";
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

  it("cannot pay a supplier matched below the confidence threshold", async () => {
    const { agent, backend } = setup([findKaroo, payKaroo, { text: "Paid." }], { supplierConfidence: 0.5 });

    const answer = await agent.chat("Pay Karoo $30 now");

    expect(backend.payments).toHaveLength(0);
    expect(answer.payments).toEqual([]);
  });

  it("can pay a supplier matched at exactly the confidence threshold", async () => {
    const { agent, backend } = setup([findKaroo, payKaroo, { text: "Paid." }], { supplierConfidence: 0.85 });
    await agent.chat("Pay Karoo $30 now");
    expect(backend.payments.map((r) => r.body.supplierId)).toEqual(["sup_karoo"]);
  });

  const requestApproval = (supplierId: string, amount: string): ModelTurn => ({
    toolCalls: [{ tool: "request_approval", input: { invoiceNumber: "OWNER-REQ-2", supplierId, amount, reason: "Owner asked" } }],
  });

  it("does not offer propose_supplier in chat: owners add suppliers on the dashboard", async () => {
    const { agent, plannerModel } = setup([{ text: "Hello." }]);
    await agent.chat("Hi");
    const offered = (plannerModel.calls[0]!.tools ?? []).map((t) => t.name).sort();
    expect(offered).toEqual(["find_supplier", "get_rules", "pay", "query_log", "request_approval"]);
  });

  it("sends no proposal when the model calls propose_supplier anyway", async () => {
    const { agent, backend } = setup([
      { toolCalls: [{ tool: "propose_supplier", input: { name: "Atlas Freight Brokers", address: null, evidence: "Owner said so" } }] },
      { text: "Proposed." },
    ]);
    await agent.chat("Add Atlas Freight Brokers as a supplier");
    expect(backend.approvals).toHaveLength(0);
  });

  it("sends no approval for a supplierId find_supplier never returned", async () => {
    const { agent, backend } = setup([requestApproval("sup_whatever", "4500.00"), { text: "Asked." }]);
    await agent.chat("Pay sup_whatever 4500");
    expect(backend.approvals).toHaveLength(0);
  });

  it("sends no approval for a supplier matched below the confidence threshold", async () => {
    const { agent, backend } = setup([findKaroo, requestApproval("sup_karoo", "120.00"), { text: "Asked." }], { supplierConfidence: 0.5 });
    await agent.chat("Pay Karoo 120 now");
    expect(backend.approvals).toHaveLength(0);
  });

  it("sends no approval for an amount within the cap and budget (pay is the right tool)", async () => {
    const { agent, backend } = setup([findKaroo, requestApproval("sup_karoo", "30.00"), { text: "Asked." }]);
    await agent.chat("Pay Karoo 30 now");
    expect(backend.approvals).toHaveLength(0);
  });

  it("still asks the owner for an over-cap payment to a found supplier, under a code-generated invoice number", async () => {
    const { agent, backend } = setup([findKaroo, requestApproval("sup_karoo", "120"), { text: "Asked the owner." }]);
    await agent.chat("Pay Karoo 120 now");
    expect(backend.approvals.map((r) => r.body)).toEqual([
      { kind: "payment", payload: { invoiceNumber: expect.stringMatching(/^CHAT-\d{8}-[A-Z2-7]{8}$/), supplierId: "sup_karoo", amount: "120.00", reason: "Owner asked" } },
    ]);
  });

  it("never puts a model-supplied invoice number on a chat card, even a real invoice's", async () => {
    const { agent, backend } = setup([
      findKaroo,
      { toolCalls: [{ tool: "request_approval", input: { invoiceNumber: "INV-1042", supplierId: "sup_karoo", amount: "120.00", reason: "Owner asked" } }] },
      { text: "Asked." },
    ]);
    await agent.chat("Pay Karoo 120 now");
    const numbers = backend.approvals.map((r) => r.body.payload.invoiceNumber);
    expect(numbers).toHaveLength(1);
    expect(numbers[0]).not.toBe("INV-1042");
    expect(numbers[0]).toMatch(/^CHAT-\d{8}-[A-Z2-7]{8}$/);
  });
});

describe("chatInvoiceNumber", () => {
  it("is CHAT-, the UTC date, and 8 RFC 4648 base32 characters from 5 random bytes", () => {
    const at = new Date("2026-11-13T23:30:00-05:00"); // 14 Nov in UTC
    expect(chatInvoiceNumber(at, () => new Uint8Array([0, 0, 0, 0, 0]))).toBe("CHAT-20261114-AAAAAAAA");
    expect(chatInvoiceNumber(at, () => new Uint8Array([255, 255, 255, 255, 255]))).toBe("CHAT-20261114-77777777");
    expect(chatInvoiceNumber(at, () => new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61]))).toBe("CHAT-20261114-MZXW6YTB");
  });

  it("asks for exactly 5 random bytes and differs between calls by default", () => {
    const sizes: number[] = [];
    chatInvoiceNumber(new Date(), (n) => (sizes.push(n), new Uint8Array(n)));
    expect(sizes).toEqual([5]);
    expect(chatInvoiceNumber()).not.toBe(chatInvoiceNumber());
  });
});
