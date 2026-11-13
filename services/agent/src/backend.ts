import { PayResult } from "@shucamoxa/shared";
import { PAYMENT_OUTCOME_UNKNOWN, raceAbort, readBoundedText, resolveLimits, ResponseTooLarge, type RunControl, type RunLimits } from "./limits";

/**
 * The agent's only route to the rest of Shucamoxa: thin HTTP calls to the backend with the agent's
 * scoped token. Read and propose endpoints, plus POST /payments. Nothing here can change rules.
 *
 * Every call has a deadline, refuses redirects (so the token never follows one to another host) and
 * reads at most limits.maxBodyBytes of the response.
 */
export type BackendDeps = { backendUrl: string; backendToken: string; fetch?: typeof fetch; limits?: Partial<RunLimits> };

export type BackendReply = { ok: true; body: unknown } | { ok: false; error: string };

/** `run`, when given, ties every call to that run: once it has stopped, nothing more is sent. */
export function backendClient({ backendUrl, backendToken, fetch: doFetch = fetch, limits: partial }: BackendDeps, run?: RunControl) {
  const limits = resolveLimits(partial);

  const send = async (method: "GET" | "POST", path: string, body: unknown, signal: AbortSignal): Promise<BackendReply> => {
    const res = await doFetch(`${backendUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${backendToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      redirect: "error",
    });
    if (path === "/payments") return paymentReply(res);
    // Covers 3xx too, for a fetch that hands redirects back instead of throwing.
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, error: `backend answered ${res.status}` };
    }
    const text = await readBoundedText(res, limits.maxBodyBytes);
    return { ok: true, body: parseJson(text) };
  };

  /**
   * Once POST /payments may have reached the payment service, only a PayResult counts as an answer:
   * a valid one on 2xx, or a "blocked" one on 4xx. Anything else (5xx or a gateway error, an oversized,
   * broken, non-JSON or off-contract body) throws, and the caller reports the outcome as unknown.
   */
  const paymentReply = async (res: Response): Promise<BackendReply> => {
    const parsed = PayResult.safeParse(parseJson(await readBoundedText(res, limits.maxBodyBytes)));
    if (parsed.success && (res.ok || (res.status >= 400 && res.status < 500 && parsed.data.status === "blocked")))
      return { ok: true, body: parsed.data };
    throw new PaymentUnclear();
  };

  const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<BackendReply> => {
    const stage = `${method} ${path.split("?")[0]}`;
    const isPayment = stage === "POST /payments";
    if (run?.signal.aborted) return { ok: false, error: "This run has stopped, so nothing was sent." };
    const ms = isPayment ? limits.paymentMs : limits.backendMs;
    const timeout = AbortSignal.timeout(ms);
    const signal = run ? AbortSignal.any([run.signal, timeout]) : timeout;
    const answered = isPayment ? run?.paymentSent() : undefined;
    try {
      // Raced as well as passed to fetch, so a fetch or body stream that ignores the signal can't hang the run.
      const reply = await raceAbort(send(method, path, body, signal), signal);
      answered?.();
      return reply;
    } catch (error) {
      if (isPayment && !signal.aborted) {
        // The request may have been sent and settled: never "no payment", never retried.
        run?.paymentUnclear(stage);
        return { ok: false, error: PAYMENT_OUTCOME_UNKNOWN };
      }
      if (signal.aborted) {
        // A cut-off payment is never retried: the payment service may have settled it anyway.
        run?.stall(stage, timeout.aborted && !run.signal.aborted, ms, isPayment);
        return { ok: false, error: isPayment ? PAYMENT_OUTCOME_UNKNOWN : `${stage} did not answer in time.` };
      }
      if (error instanceof ResponseTooLarge) return { ok: false, error: `backend response too large (over ${limits.maxBodyBytes} bytes), refused` };
      return { ok: false, error: `backend unreachable (${error instanceof Error ? error.name : "error"})` };
    }
  };

  return {
    getRules: () => call("GET", "/rules"),
    findSupplier: (name: string) => call("GET", `/suppliers?q=${encodeURIComponent(name)}`),
    pay: (request: unknown) => call("POST", "/payments", request),
    createApproval: (approval: unknown) => call("POST", "/approvals", approval),
    queryLog: async (filter: Record<string, string>): Promise<BackendReply> => {
      const reply = await call("GET", `/log?${new URLSearchParams(filter)}`);
      if (!reply.ok) return reply;
      if (!Array.isArray(reply.body)) return { ok: false, error: "backend log reply was not a list" };
      return { ok: true, body: reply.body.slice(0, limits.maxLogEntries) };
    },
  };
}

class PaymentUnclear extends Error {
  override name = "PaymentUnclear";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type BackendClient = ReturnType<typeof backendClient>;
