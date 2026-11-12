# Agent tests (W1)

Run everything: `pnpm test` from the repo root (Vitest, about 2 s).
Real-model eval (opt-in): see the header of `services/agent/eval/demo-scenarios.test.ts`.

The model is untrusted, so the tests replace it with a **scripted hostile model** (`test/support/scripted-model.ts`)
and replace the backend with a **fake HTTP backend** (`test/support/fake-backend.ts`) that records every request.
Security tests assert on what reached the backend, never on what the model said.

| Seam | File | What it proves |
|---|---|---|
| A. Shared contracts | `packages/shared/test/*` | `PayRequest` can't carry an address; amounts are clean decimal strings; every rule code has a fixed explanation; `settled` needs a tx hash |
| B. Extraction | `test/extraction.test.ts` | No tools on the raw-invoice call; invoice can't escape its `<invoice>` tags; bad output, wrong currency or a dead model → `needs_review` |
| C. Agent run | `test/agent-run.test.ts`, `test/chat.test.ts` | Hostile model can't pay an address, an unknown ID, a different amount or invoice, retry a block, pay twice, reach a write endpoint, or act under the kill switch; outcomes come from the backend's rule code; addresses never reach the model; 6-step limit |
| D. Startup config | `test/config.test.ts` | Refuses seeds, keys and DB URLs in the env (without echoing them); model URL must be localhost, Tailscale or the named HTTPS fallback |

Each guard was checked by breaking it on purpose: every mutation turns at least one test red.
