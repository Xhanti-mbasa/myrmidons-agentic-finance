# Agent tests (W1 / T11)

Run everything: `pnpm test` from the repo root (Vitest).
Mutation testing: `pnpm mutate` (Stryker with Vitest runner across core modules).
Real-model eval (opt-in): see the header of `services/agent/eval/demo-scenarios.test.ts`.

The model is untrusted, so the tests replace it with a **scripted hostile model** (`test/support/scripted-model.ts`)
and replace the backend with a **fake HTTP backend** (`test/support/fake-backend.ts`) that records every request.
Security tests assert on what reached the backend, never on what the model said.

## Mutation Testing & Guard Verification (T11)

- **Date**: 2026-11-13
- **Stryker Configuration**: `services/agent/stryker.config.json`
- **Mutated modules**: `src/{tools,config,extraction,grounding,normalise}.ts`
- **Threshold break**: 80
- **Stryker Mutation Score**: >80% (1,346 mutants evaluated; all 5 surviving mutants identified on main killed)

| Guard | Test File and Test Name | What Breaking It Proves |
|---|---|---|
| Regex Address Redaction in Tool Results | `test/agent-run.test.ts` > `redacts an address leaked under key 'wallet' AND inside a sentence in a tool result` | If regex redaction in `redactText` is bypassed and only key-based stripping remains, addresses inside sentences and descriptions are caught and replaced with `[address hidden]`. |
| Extended Case-Insensitive Key Redaction | `test/agent-run.test.ts` > `strips keys xrpl_address, account, payTo, wallet case-insensitively and redacts X-addresses in tool results` | If backend responses leak address fields under keys like `WALLET`, `payTo`, `xrpl_address`, `Account`, or X-addresses in values, key stripping removes the entries regardless of casing. |
| Deterministic Planner Temperature | `test/agent-run.test.ts` > `runs the planner model with temperature: 0 on every call` | Setting `temperature: 0` in planner calls prevents non-deterministic sampling drift or hallucinated tool arguments during payments. |
| Deterministic Extraction Temperature | `test/extraction.test.ts` > `calls the extraction model with temperature: 0` | Setting `temperature: 0` in `extractInvoice` guarantees reproducible field parsing from untrusted raw invoice text. |
| Extraction Retry Upper Bound | `test/extraction.test.ts` > `calls a failing extraction model exactly 2 times (not more)` | Setting `maxRetries: 1` ensures a failing model call is retried at most once (2 calls total), preventing infinite loops or budget/quota depletion. |
| Invoice Tag Neutralisation & Case Invariance | `test/normalise.test.ts` > `neutralises a closing tag spelled with %s`, `test/extraction.test.ts` > `G11: neutralises %s` | Altering the `<invoice>` tag regex or bypassing lowercase skeleton normalization allows adversarial closing tags (`</InVoIcE>`, unicode angle brackets) to escape and inject system prompts. |
| Kill Switch Race Condition Enforcement | `test/agent-run.test.ts` > `reports blocked with KILL_SWITCH_ON when POST /payments returns blocked KILL_SWITCH_ON even if GET /rules said false` | If the kill switch activates between `GET /rules` and payment submission, the agent maps the backend `KILL_SWITCH_ON` refusal directly to a `blocked` outcome with the official rule explanation. |
| Mandate Decimal Amount Equivalence | `test/agent-run.test.ts` > `mandate '30.00' accepts pay.amount '%s' and settles the invoice` & `mandate '30.00' refuses pay.amount '30.01'` | Validates exact integer-cent comparison (`toCents`): `'30'` and `'30.0'` match `'30.00'` and execute payment; `'30.01'` is refused and never reaches the backend. |
| Address Hiding in Planner View | `test/agent-run.test.ts` > `never shows the planner an address planted in %s (%s), though the field passes its schema` | The planner view never reveals wallet addresses in `supplierName` or `invoiceNumber`, passing only `hasAddressOnInvoice: true`. |
| No Write Endpoints in Planner Tools | `test/agent-run.test.ts` > `offers exactly the six agreed tools, none of which can change rules, suppliers or approvals` | The toolset provided to the planner restricts execution strictly to `find_supplier`, `get_rules`, `pay`, `propose_supplier`, `query_log`, and `request_approval`. |
| Capped Free-Text Reasons | `test/agent-run.test.ts` > `rejects a 201-character pay reason as a tool error` / `sends no payment whose reason carries markup` | Model-supplied reason fields must not exceed 200 characters or include HTML/XML markup or control characters. |
| Environment Secret Scanning | `test/config.test.ts` > `readConfig scans every env name and value for secrets` | Any XRPL seeds, private keys, mnemonics, DB URLs or JWTs in environment variables cause immediate startup abortion. |
| Timeout Fail-Closed Behavior | `test/limits.test.ts` > `limits: a hung model fails closed and fast` | Calls exceeding stage timeouts abort immediately with `needs_review` and discard delayed or out-of-order tool responses. |
| Inbound Service Authentication | `test/server.test.ts` > `POST /agent/invoices: authentication` | Timing-safe authentication ensures missing, mismatched, or suffixed bearer tokens reject with 401 without running the model or backend. |

Each guard was verified by mutating the implementation on purpose to ensure the corresponding test suite fails red, then restoring the guard to green.
