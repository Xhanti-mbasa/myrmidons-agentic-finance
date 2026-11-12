/**
 * The agent's only route to the rest of PayGuard: thin HTTP calls to the backend with the agent's
 * scoped token. Read and propose endpoints, plus POST /payments. Nothing here can change rules.
 */
export type BackendDeps = { backendUrl: string; backendToken: string; fetch?: typeof fetch };

export type BackendReply = { ok: true; body: unknown } | { ok: false; error: string };

export function backendClient({ backendUrl, backendToken, fetch: doFetch = fetch }: BackendDeps) {
  const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<BackendReply> => {
    try {
      const res = await doFetch(`${backendUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${backendToken}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed = await res.json().catch(() => undefined);
      if (!res.ok) return { ok: false, error: `backend answered ${res.status}` };
      return { ok: true, body: parsed };
    } catch (error) {
      return { ok: false, error: `backend unreachable (${error instanceof Error ? error.name : "error"})` };
    }
  };
  return {
    getRules: () => call("GET", "/rules"),
    findSupplier: (name: string) => call("GET", `/suppliers?q=${encodeURIComponent(name)}`),
    pay: (request: unknown) => call("POST", "/payments", request),
    createApproval: (approval: unknown) => call("POST", "/approvals", approval),
    queryLog: (filter: Record<string, string>) => call("GET", `/log?${new URLSearchParams(filter)}`),
  };
}

export type BackendClient = ReturnType<typeof backendClient>;
