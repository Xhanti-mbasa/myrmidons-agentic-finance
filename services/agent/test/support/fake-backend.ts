/**
 * An in-memory stand-in for the Shucamoxa backend (W3 payment service + W4 API), reached through an
 * injected fetch. It records every request, so tests assert on what actually reached the backend,
 * which is the observable thing that matters for security, not on what the model said.
 *
 * The default payment behaviour roughly mirrors the agreed contract: settle approved suppliers
 * within the cap, block the rest with a rule code. Tests override it where they need to.
 */
export type RecordedRequest = {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  body: any;
  headers: Record<string, string>;
};

export type FakeSupplier = { id: string; name: string; xrplAddress: string };

export const BACKEND_URL = "http://backend.test";
export const AGENT_TOKEN = "agent-scoped-token";

export const KAROO: FakeSupplier = { id: "sup_karoo", name: "Karoo Textiles", xrplAddress: "rLeakedKarooAddress99999999999" };
export const ZAMBEZI: FakeSupplier = { id: "sup_zambezi", name: "Zambezi Spices", xrplAddress: "rLeakedZambeziAddress8888888888" };

type Options = {
  suppliers?: FakeSupplier[];
  killSwitch?: boolean;
  perPaymentCap?: string;
  remaining?: string;
  /** Leak supplier addresses in responses, to prove the agent strips them before the model sees them. */
  leakAddresses?: boolean;
  /** Replace the payment service's answer. */
  payResponse?: (body: any) => { status: number; json: unknown };
  log?: unknown[];
  /** Match confidence GET /suppliers reports (default 0.95), or a function of the query and the matched supplier. */
  supplierConfidence?: number | ((query: string, supplier: FakeSupplier) => number);
};

export function fakeBackend(options: Options = {}) {
  const suppliers = options.suppliers ?? [KAROO, ZAMBEZI];
  const requests: RecordedRequest[] = [];
  let approvals = 0;
  let payments = 0;

  const rules = () => ({
    perPaymentCap: options.perPaymentCap ?? "50.00",
    totalBudget: "200.00",
    spent: "0.00",
    reserved: "0.00",
    remaining: options.remaining ?? "200.00",
    killSwitch: options.killSwitch ?? false,
    suppliers: suppliers.map((s) => (options.leakAddresses ? { id: s.id, name: s.name, xrplAddress: s.xrplAddress } : { id: s.id, name: s.name })),
  });

  const defaultPay = (body: any) => {
    payments++;
    const supplier = suppliers.find((s) => s.id === body.supplierId);
    if (options.killSwitch) return { status: 200, json: { status: "blocked", ruleCode: "KILL_SWITCH_ON", logId: `log_${payments}` } };
    if (!supplier) return { status: 200, json: { status: "blocked", ruleCode: "SUPPLIER_NOT_APPROVED", logId: `log_${payments}` } };
    if (Number(body.amount) > Number(rules().perPaymentCap))
      return { status: 200, json: { status: "blocked", ruleCode: "OVER_PER_PAYMENT_CAP", logId: `log_${payments}` } };
    return { status: 200, json: { status: "settled", ruleCode: "OK", txHash: `TXHASH${payments}`, logId: `log_${payments}` } };
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url: url.href, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers });

    if (url.origin !== BACKEND_URL) return json(502, { error: "unknown host" });
    if (headers.authorization !== `Bearer ${AGENT_TOKEN}`) return json(401, { error: "unauthorised" });

    const route = `${method} ${url.pathname}`;
    if (route === "GET /rules") return json(200, rules());
    if (route === "GET /suppliers") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const match = suppliers.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));
      if (!match) return json(200, { notFound: true });
      const sc = options.supplierConfidence ?? 0.95;
      const confidence = typeof sc === "function" ? sc(url.searchParams.get("q") ?? "", match) : sc;
      return json(200, { supplierId: match.id, name: match.name, confidence, ...(options.leakAddresses ? { xrplAddress: match.xrplAddress } : {}) });
    }
    if (route === "POST /payments") {
      const r = (options.payResponse ?? defaultPay)(body);
      return json(r.status, r.json);
    }
    if (route === "POST /approvals") return json(201, { approvalId: `appr_${++approvals}`, status: "pending" });
    if (route === "GET /log") return json(200, options.log ?? []);
    return json(404, { error: "no such endpoint" });
  };

  return {
    fetch,
    requests,
    get payments() {
      return requests.filter((r) => r.method === "POST" && r.path === "/payments");
    },
    get approvals() {
      return requests.filter((r) => r.method === "POST" && r.path === "/approvals");
    },
  };
}
