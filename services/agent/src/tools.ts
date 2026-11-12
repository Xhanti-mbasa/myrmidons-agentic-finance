import { tool } from "ai";
import { z } from "zod";
import { Amount, PayRequest, PayResult } from "@payguard/shared";
import type { BackendClient } from "./backend";

/** What the tools observed during one run. The outcome is built from this, never from model text. */
export type RunState = {
  /** When processing an invoice, pay may only pay exactly this invoice number and amount. */
  mandate: { invoiceNumber: string; amount: string } | null;
  /** Supplier IDs the backend returned during this run. pay only accepts one of these. */
  knownSupplierIds: Set<string>;
  /** Invoice numbers already sent to POST /payments in this run, whatever the result. */
  attemptedInvoices: Set<string>;
  payResults: PayResult[];
  approvals: Array<{ kind: "supplier" | "payment"; approvalId: string }>;
};

export function newRunState(mandate: RunState["mandate"] = null): RunState {
  return { mandate, knownSupplierIds: new Set(), attemptedInvoices: new Set(), payResults: [], approvals: [] };
}

/** Layer-1 checks inside the agent. The policy service and ledger enforce again; this just stops bad requests early. */
function refusePay(request: PayRequest, state: RunState): string | null {
  if (!state.knownSupplierIds.has(request.supplierId))
    return "supplierId was not returned by find_supplier in this run. Only approved suppliers can be paid; use propose_supplier for a new one.";
  if (state.mandate && request.invoiceNumber !== state.mandate.invoiceNumber)
    return `This run may only pay invoice ${state.mandate.invoiceNumber}.`;
  if (state.mandate && cents(request.amount) !== cents(state.mandate.amount))
    return `The amount must equal the invoice total, ${state.mandate.amount}. Amounts mentioned elsewhere in the invoice are ignored.`;
  if (state.attemptedInvoices.has(request.invoiceNumber))
    return "A payment for this invoice was already requested in this run. It is never retried; the owner decides what happens next.";
  return null;
}

function cents(amount: string): number {
  const [whole, frac = ""] = amount.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * The agent's six tools. Four read or propose, one pays, none can change rules.
 * Tool inputs are Zod-parsed by the SDK before execute runs; a bad input goes back to the model as an
 * error result instead of reaching the backend.
 */
export function agentTools(backend: BackendClient, state: RunState) {
  return redactResults({
    get_rules: tool({
      description: "Read the owner's payment rules and remaining budget. Read-only.",
      inputSchema: z.object({}),
      execute: async () => backend.getRules(),
    }),
    find_supplier: tool({
      description: "Find an approved supplier by name. Returns supplierId or notFound. Never returns an address.",
      inputSchema: z.strictObject({ name: z.string().min(1) }),
      execute: async ({ name }) => {
        const reply = await backend.findSupplier(name);
        if (reply.ok && isSupplierMatch(reply.body)) state.knownSupplierIds.add(reply.body.supplierId);
        return reply;
      },
    }),
    pay: tool({
      description: "Request payment to an APPROVED supplier by supplierId. amount is a decimal string in USD (RLUSD).",
      inputSchema: PayRequest,
      execute: async (request) => {
        const refusal = refusePay(request, state);
        if (refusal) return { refused: true, reason: refusal };
        state.attemptedInvoices.add(request.invoiceNumber); // before the await, so parallel calls see it
        const reply = await backend.pay(request);
        if (!reply.ok) return reply;
        const result = PayResult.parse(reply.body);
        state.payResults.push(result);
        return result;
      },
    }),
    propose_supplier: tool({
      description: "Ask the owner to approve a new supplier. Use when find_supplier returns notFound.",
      inputSchema: z.strictObject({ name: z.string().min(1), address: z.string().nullable(), evidence: z.string() }),
      execute: async (payload) => {
        const reply = await backend.createApproval({ kind: "supplier", payload });
        if (reply.ok) state.approvals.push({ kind: "supplier", approvalId: approvalIdOf(reply.body) });
        return reply;
      },
    }),
    request_approval: tool({
      description: "Ask the owner to approve a payment that is over the per-payment cap or remaining budget.",
      inputSchema: z.strictObject({ invoiceNumber: z.string().min(1), supplierId: z.string().min(1), amount: Amount, reason: z.string() }),
      execute: async (payload) => {
        const reply = await backend.createApproval({ kind: "payment", payload });
        if (reply.ok) state.approvals.push({ kind: "payment", approvalId: approvalIdOf(reply.body) });
        return reply;
      },
    }),
    query_log: tool({
      description: "Read the payment log. Optional filters: supplierId, from, to (ISO dates), status.",
      inputSchema: z.strictObject({
        supplierId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        status: z.enum(["settled", "blocked", "pending_approval"]).optional(),
      }),
      execute: async (filter) => backend.queryLog(Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as Record<string, string>),
    }),
  });
}

/** XRPL classic address: "r" plus 24-34 base58 characters. */
const XRPL_ADDRESS = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;
const ADDRESS_KEYS = new Set(["xrplAddress", "address", "destination", "Destination", "destinationTag"]);

/** Wallet addresses never reach the model, even if a backend endpoint leaks one. */
export function redactAddresses(value: unknown): unknown {
  if (typeof value === "string") return value.replace(XRPL_ADDRESS, "[address hidden]");
  if (Array.isArray(value)) return value.map(redactAddresses);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => !ADDRESS_KEYS.has(k)).map(([k, v]) => [k, redactAddresses(v)]),
    );
  }
  return value;
}

function redactResults<T extends Record<string, { execute?: (...args: any[]) => any }>>(tools: T): T {
  for (const t of Object.values(tools)) {
    const execute = t.execute;
    if (execute) t.execute = async (...args: any[]) => redactAddresses(await execute(...args));
  }
  return tools;
}

function isSupplierMatch(body: unknown): body is { supplierId: string } {
  return typeof body === "object" && body !== null && typeof (body as { supplierId?: unknown }).supplierId === "string";
}

function approvalIdOf(body: unknown): string {
  const id = (body as { approvalId?: unknown } | null)?.approvalId;
  return typeof id === "string" ? id : "unknown";
}
