# Agent tests (W1)

Run everything: `pnpm test` from the repo root (Vitest, a few seconds).
Real-model eval (opt-in): see the header of `services/agent/eval/demo-scenarios.test.ts`.

The model is untrusted, so the tests replace it with a **scripted hostile model** (`test/support/scripted-model.ts`)
and replace the backend with a **fake HTTP backend** (`test/support/fake-backend.ts`) that records every request.
Security tests assert on what reached the backend, never on what the model said.

| Seam | File | What it proves |
|---|---|---|
| A. Shared contracts | `packages/shared/test/*` | `PayRequest` can't carry an address; amounts are clean decimal strings; every rule code has a fixed explanation; `settled` needs a tx hash |
| B. Extraction | `test/extraction.test.ts` | No tools on the raw-invoice call; invoice can't escape its `<invoice>` tags; bad output, wrong currency or a dead model → `needs_review` |
| C. Agent run | `test/agent-run.test.ts`, `test/chat.test.ts` | Hostile model can't pay an address, an unknown ID, another approved supplier for this invoice (code resolves the invoice's own supplier, confidence ≥ 0.85), a different amount or invoice, retry a block, pay twice, reach a write endpoint, or act under the kill switch; approval cards carry only the invoice's own number, supplier, amount, name and code-filled address and evidence, only when over the code-read cap or budget in cents, at most one per kind per run; no reason carries an address (even split up) or a 25+ character code; chat cards get a code-generated `CHAT-` number and chat offers no propose_supplier; the planner prompt holds no address, only `hasAddressOnInvoice`; outcomes come from the backend's rule code; addresses (classic or X-address, plain or split by spaces or punctuation) never reach the model, in the prompt or in tool results; 6-step limit |
| D. Startup config | `test/config.test.ts` | `.env` holds only allowlisted names; every env name and value is scanned for seeds, hex keys, mnemonics, DB URLs and service-role JWTs (found anywhere in a value); no refusal echoes any 6-character piece of the value; a dev shell or CI runner does not trip it; model URL must be localhost, Tailscale or the named HTTPS fallback; `BACKEND_URL` is a bare origin, HTTP only to a private host |
| E. Timeouts and limits | `test/limits.test.ts` | A hung backend call, model call or run (injected limits of tens of ms, no fake timers) ends as `needs_review` naming the stage; a `POST /payments` that hangs, fails mid-request, answers 5xx, or returns an oversized, broken, non-JSON or off-contract body is "outcome unknown, check the activity log", sent once, never retried (a 4xx with a `blocked` PayResult stays a refusal); after a stall nothing more reaches the backend, even from a model that answers late; bodies over `maxBodyBytes` are refused without being buffered; `query_log` passes at most 50 entries; a redirect (real sockets) never reaches its target |

Each guard was checked by breaking it on purpose: every mutation turns at least one test red.
