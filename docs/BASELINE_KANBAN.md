# Baseline Kanban — Shucamoxa

Snapshot: 13 November 2026; main `47b6c55f6c33c5ce3f4e518245e12cd85082ad92`. See [progress and evidence](BASELINE_PROGRESS.md), [interactive board](planning/baseline-kanban.html), and [editable board data](planning/baseline-kanban.json).

Assignments follow the team roles supplied by Xhanti. Each card has one accountable owner and a reviewer; these are project assignments, not GitHub account assignments or evidence that the owner personally authored every existing line. No GitHub issues, Projects, PRs, merges or settings changes are created by this board.

Baseline: Open WebUI → guarded agent → authenticated backend/coordinator → independent policy signer → XRPL Testnet RLUSD; durable audit/history and scheduled execution. Keep wallet keys and owner actions outside model authority. Browser/sidebar extensions are deferred. Scheduling and ledger history are now baseline even where older specs defer them.

Columns describe observed work, not inferred current activity: **Ready** can start; **Partial** has reusable implementation but open acceptance; **Review** needs a decision on existing code/reproductions; **Blocked** needs listed prerequisites before closure; **Done** is a bounded slice, not whole-product readiness; **Deferred** is outside the current execution plan. Dependencies are closure prerequisites; harmless design/tests may begin earlier. WIP limit: one implementation card per owner; reviewers can review in parallel.

## Start here

| Owner | First action | Then |
| --- | --- | --- |
| Xhanti | C01: publish invoice/intent/route/role mapping with Cameron and Tran | SEC01, then T30/M01 and T36; H01/H02 and S01 |
| Cameron | Reproduce and close T06b/T08 review blockers | T13 guarded WebUI adapter, SEC02, T18; T14/T17 |
| Tran | C01 execution sign-off; T20 co-signer and T25 recovery-safe Testnet setup | T21–T26 with T28; T31, S02 and T27 |

T20/T25 can start offline design and generated-key tests immediately. Do not wait for every screen before building a real payment vertical slice. T37 closes only after scheduling/history and actual Testnet evidence.

## Ready (12)

| Ticket | Assigned owner / reviewer | Priority | Existing evidence / remaining outcome | Dependencies |
| --- | --- | --- | --- | --- |
| [T11](#t11) Mutation hardening and typed tool-read outputs | Cameron / Xhanti | P1 | Archived mutation review predates fixes; no fresh mutation score found. | T07, T09, T10 |
| [T13](#t13) OpenAI-compatible guarded-agent chat adapter | Cameron / Xhanti | P0 | ownerChat accepts latestOwnerTurn in-process; no HTTP chat adapter. | T08, T12 |
| [T14](#t14) Bounded PDF intake and invoice CLI fallback | Cameron / Xhanti | P1 | PDF fixtures are generated; invoice service accepts text, not PDF parsing. | T12 |
| [T18](#t18) Local model smoke gate and shared prompts | Cameron / Xhanti | P1 | User supplied local Qwen chat output; finance tool reliability not demonstrated. | T01 |
| [T20](#t20) Independent co-signer: auth and signed-byte verification | Tran / Cameron | P0 | Cosign schemas and coordinator policy interface exist; no service implementation. | T03, C01 |
| [C01](#c01) Freeze one invoice-to-intent and API contract | Xhanti / Cameron | P0 | Three incompatible contracts exist; archived hybrid recommendation is not implemented. | T03 |
| [S01](#s01) Owner scheduling/cancel/reschedule tools and records | Xhanti / Tran | P0 | Core executeAt exists; no bounded chat schedule/cancel/status journey. | C01, T30, T31 |
| [H01](#h01) Payment/transaction history and balance tools | Xhanti / Tran | P0 | query_log and legacy balance/status adapters exist; complete validated XRPL history absent. | C01, T26, T29, T30 |
| [H02](#h02) Independent audit heads and ledger memo verifier | Xhanti / Tran | P0 | Local chain detects many edits but not full rewrite/suffix deletion without independent head. | T29 |
| [SEC01](#sec01) Close secret scanner hash-label bypass (R2) | Xhanti / Cameron | P0 | Raw 64-hex exemption for hash/digest/checksum remains open. | T02 |
| [SEC02](#sec02) Bound and sanitise every tool-read response | Cameron / Xhanti | P0 | Address redaction/minimisation exists; backend dictionaries/free-text paths need typed projection. | T07 |
| [OPS01](#ops01) Isolate keys/services and record current security evidence | Tran / Cameron | P0 | Config guards/tests exist; actual runtime filesystem/network/key isolation not proved. | T20, T25, T26 |

## Partial (12)

| Ticket | Assigned owner / reviewer | Priority | Existing evidence / remaining outcome | Dependencies |
| --- | --- | --- | --- | --- |
| [T22](#t22) Atomic budgets, duplicate protection and reservation lifecycle | Tran / Xhanti | P0 | SQLite coordinator has reservations/deduplication; not integrated into a real cosign service. | T21, T28 |
| [T25](#t25) Fresh Testnet RLUSD treasury and recovery-safe multisig | Tran / Xhanti | P0 | feat/testnet has separate fresh-wallet 1-XRP demo; RLUSD multisig treasury setup absent. | T03 |
| [T26](#t26) Real wallet adapter, transaction build/sign/submit/reconcile | Tran / Cameron | P0 | Durable coordinator implemented; wallet.submit/lookup and policy.authorize are interfaces. | T20, T21, T22, T25, T28, T29, C01 |
| [T28](#t28) Extend durable storage and versioned migrations | Tran / Xhanti | P0 | Coordinator SQLite exists; business invoices/rules/suppliers/approvals API persistence incomplete. | T03, C01 |
| [T29](#t29) Durable multi-service audit writer and verification | Xhanti / Tran | P0 | Shared chain and payment audit gate exist; mock log in memory; external writer/anchors incomplete. | T28 |
| [T30](#t30) Authenticated real agent-facing API and status/history reads | Xhanti / Tran | P0 | T15 mock has five routes; MCP /v1 and /transfers differ; production API missing. | T28, T29, C01 |
| [T31](#t31) Owner-only mandate, suppliers, approval and kill-switch API | Tran / Xhanti | P0 | Core owner credential restrictions exist; full owner login/decision API absent. | T30 |
| [T32](#t32) Single-use owner-approved exception payment | Tran / Xhanti | P1 | Approval request schemas and core owner exceptions exist; complete signing flow absent. | T26, T31 |
| [T33](#t33) Harden Open WebUI workspace and owner-session boundary | Xhanti / Cameron | P0 | Compose and user-local chat exist; image uses mutable main tag; finance auth separate. | T03 |
| [T38](#t38) Current runbook, evidence-backed pitch and demo package | Xhanti / Cameron | P1 | Docs and supporting statement exist; commands/status and final evidence need reconciliation. | T37 |
| [M01](#m01) Align MCP tools with selected guarded backend | Xhanti / Tran | P1 | Seven stdio tools and strict two-tool transfer entry point exist; not attached to real backend/WebUI. | C01, T30, SEC02 |
| [S02](#s02) Deploy durable due-payment worker and recovery | Tran / Xhanti | P0 | executeDue and /transfers/due exist; no deployed timer/worker. | T26, T31, S01 |

## Review (2)

| Ticket | Assigned owner / reviewer | Priority | Existing evidence / remaining outcome | Dependencies |
| --- | --- | --- | --- | --- |
| [T06b](#t06b) Finish sender and text-line-item grounding | Cameron / Xhanti | P0 | Branch implementation exists; review notes identify skipped digit lines, negative/credit handling and sender-block ambiguity. | T06, T16 |
| [T08](#t08) Reconcile merged chat guards with outstanding review | Cameron / Xhanti | P0 | Base chat guards merged; later handoff still reports currency/payee parsing blockers. | T04 |

## Blocked (9)

| Ticket | Assigned owner / reviewer | Priority | Existing evidence / remaining outcome | Dependencies |
| --- | --- | --- | --- | --- |
| [T17](#t17) Repeatable real-model finance evaluation | Cameron / Tran | P1 | Opt-in tests and fixtures exist; no current qualified finance run on local Qwen. | T06b, T08, T13 |
| [T21](#t21) Strict XRPL payment transaction checks | Tran / Cameron | P0 | No deployed policy check pipeline found. | T20 |
| [T23](#t23) Policy version, stale-ledger, memo and rate checks | Tran / Cameron | P0 | Policy versions are checked in coordinator; final transaction/memo/ledger checks absent. | T22, T29 |
| [T24](#t24) Policy decision audit and hostile replay | Tran / Cameron | P0 | Adversarial missing-control tests exist; no real co-signer path to replay. | T23, T16 |
| [T27](#t27) Kill switch and ledger revocation evidence | Tran / Xhanti | P0 | Coordinator flag/lockout exists; no ledger revoke/restore flow. | T25, T31 |
| [T34](#t34) Owner control surface for rules, suppliers and approvals | Xhanti / Tran | P0 | Generic WebUI settings are not finance owner controls. | T31, T33 |
| [T35](#t35) Owner kill-switch and trustworthy activity view | Xhanti / Tran | P0 | No integrated activity/kill-switch screen found. | T27, T29, T33, H01 |
| [T36](#t36) Connect Open WebUI chat and invoice upload to guarded agent | Xhanti / Cameron | P0 | Local general chat works; no repo-finance connector registered. | T13, T14, T33 |
| [T37](#t37) Cross-service baseline acceptance and Testnet evidence | Cameron / Tran | P0 | Agent/mock/core tests and adversarial suite exist; full deployed pipeline unproved. | T06b, T08, T24, T26, T30, T36, S02, H01 |

## Done (13)

| Ticket | Assigned owner / reviewer | Priority | Existing evidence / remaining outcome | Dependencies |
| --- | --- | --- | --- | --- |
| [T01](#t01) Workspace, agent and initial fixtures | Cameron / Xhanti | P1 | Node/pnpm workspace and existing agent sources are on main. | None |
| [T02](#t02) CI and secret/path guardrails | Cameron / Xhanti | P1 | Pinned workflows, scanner and tracked-path guard exist; R2 remains SEC01. | None |
| [T03](#t03) Shared contracts, money and audit primitives | Cameron / Xhanti | P1 | Shared schemas, bigint cents and canonical hashes exist. | None |
| [T03b](#t03b) Product rename to Shucamoxa | Cameron / Xhanti | P1 | Rename landed; older history remains historical. | None |
| [T04](#t04) Bind invoice payments to code-resolved supplier | Cameron / Xhanti | P1 | Supplier binding and confidence threshold exist; extraction spoofing is T06b. | None |
| [T05](#t05) Bind approvals and supplier proposals to invoice | Cameron / Xhanti | P1 | Bound requests and one-per-kind restrictions exist; no production approval UI. | None |
| [T06](#t06) Ground extraction and neutralise invoice tags | Cameron / Xhanti | P1 | Initial grounding/normalisation implemented; sender/items bypasses remain T06b. | None |
| [T07](#t07) Minimise planner input and bound free text | Cameron / Xhanti | P1 | plannerView and bounded reasons implemented; tool-read projections need SEC02. | None |
| [T09](#t09) Agent environment and backend-origin checks | Cameron / Xhanti | P1 | Startup checks reject key-shaped values and unsafe backend origins. | None |
| [T10](#t10) Timeouts, redirects and response-size limits | Cameron / Xhanti | P1 | Bounded calls, redirect rejection and conservative payment-unknown handling exist. | None |
| [T12](#t12) Authenticated invoice HTTP agent service | Cameron / Xhanti | P1 | /health, /agent/invoices, serial queue and ownerChat seam are on main. | None |
| [T15](#t15) Explicit development mock backend | Cameron / Xhanti | P1 | Five agent API routes and contract tests exist; hashes/state are simulated. | None |
| [T16](#t16) Demo invoice PDFs and red-team fixtures | Cameron / Xhanti | P1 | Fixture generation and expected outcomes exist. | None |

## Deferred (3)

| Ticket | Assigned owner / reviewer | Priority | Existing evidence / remaining outcome | Dependencies |
| --- | --- | --- | --- | --- |
| [T19](#t19) Conditional simplified approval toolset | Cameron / Xhanti | P2 | Only needed if measured model confusion justifies it. | T18 |
| [LATER01](#later01) Firefox/Chrome sidebar extension | Xhanti / Cameron | P2 | Requested later, no extension implementation found. | T37 |
| [LATER02](#later02) Broader banking, FX, escrow, yield and commercial rollout | Tran / Xhanti | P2 | Roadmap aspirations and governance research; not baseline banking parity. | T37 |

## Card acceptance and evidence

Original T identifiers are preserved from Cameron’s uploaded ticket archive. The current outcomes below reconcile that archive with current code and the user’s latest baseline; historical dates and old workflow prompts are not new deadlines or permissions. C/M/S/H/SEC/OPS/LATER cards fill missing baseline contracts, history, scheduling and security work.

<a id="t01"></a>
### T01 — Workspace, agent and initial fixtures

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Node/pnpm workspace and existing agent sources are on main.

**Evidence:** main@7e90d79

**Acceptance:** Fresh install, typecheck and targeted tests reproduce on the supported runtime.

**Closure dependencies:** None.

<a id="t02"></a>
### T02 — CI and secret/path guardrails

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Pinned workflows, scanner and tracked-path guard exist; R2 remains SEC01.

**Evidence:** main@1d44270

**Acceptance:** Retain the current CI checks; close scanner bypass separately under SEC01.

**Closure dependencies:** None.

<a id="t03"></a>
### T03 — Shared contracts, money and audit primitives

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Shared schemas, bigint cents and canonical hashes exist.

**Evidence:** main@825ec9c

**Acceptance:** Consumers import shared contracts; contract integration is C01, not implied by this library.

**Closure dependencies:** None.

<a id="t03b"></a>
### T03b — Product rename to Shucamoxa

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Rename landed; older history remains historical.

**Evidence:** main@c808928

**Acceptance:** Current source imports use @shucamoxa naming.

**Closure dependencies:** None.

<a id="t04"></a>
### T04 — Bind invoice payments to code-resolved supplier

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Supplier binding and confidence threshold exist; extraction spoofing is T06b.

**Evidence:** main@f800e55

**Acceptance:** Preserve supplier-ID/confidence attack regressions.

**Closure dependencies:** None.

<a id="t05"></a>
### T05 — Bind approvals and supplier proposals to invoice

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Bound requests and one-per-kind restrictions exist; no production approval UI.

**Evidence:** main@e1870ac

**Acceptance:** Preserve exact invoice/amount/supplier binding; real decisions remain T31/T32.

**Closure dependencies:** None.

<a id="t06"></a>
### T06 — Ground extraction and neutralise invoice tags

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Initial grounding/normalisation implemented; sender/items bypasses remain T06b.

**Evidence:** main@dbaffa2

**Acceptance:** Keep unicode/template/amount boundary regressions; do not call all grounding solved.

**Closure dependencies:** None.

<a id="t07"></a>
### T07 — Minimise planner input and bound free text

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** plannerView and bounded reasons implemented; tool-read projections need SEC02.

**Evidence:** main@7ca8db5

**Acceptance:** Descriptions/suspicious-text canaries stay out of planner; revalidate all read outputs.

**Closure dependencies:** None.

<a id="t09"></a>
### T09 — Agent environment and backend-origin checks

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Startup checks reject key-shaped values and unsafe backend origins.

**Evidence:** main@3d2acce

**Acceptance:** No unsafe bypass flag; credentials never appear in errors.

**Closure dependencies:** None.

<a id="t10"></a>
### T10 — Timeouts, redirects and response-size limits

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Bounded calls, redirect rejection and conservative payment-unknown handling exist.

**Evidence:** main@3ccb949

**Acceptance:** Keep no-retry unknown behavior and redirect credential-isolation tests.

**Closure dependencies:** None.

<a id="t12"></a>
### T12 — Authenticated invoice HTTP agent service

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** /health, /agent/invoices, serial queue and ownerChat seam are on main.

**Evidence:** main@47b6c55

**Acceptance:** Retain auth/body-limit/duplicate-inflight tests; chat transport remains T13.

**Closure dependencies:** None.

<a id="t15"></a>
### T15 — Explicit development mock backend

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Five agent API routes and contract tests exist; hashes/state are simulated.

**Evidence:** main@679617a

**Acceptance:** Keep SHUCAMOXA_MOCK opt-in and visible mock labeling; never count as settlement.

**Closure dependencies:** None.

<a id="t16"></a>
### T16 — Demo invoice PDFs and red-team fixtures

**Done · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Fixture generation and expected outcomes exist.

**Evidence:** main@4eeccaa

**Acceptance:** Retain deterministic fixtures; live-model replay remains T17.

**Closure dependencies:** None.

<a id="t06b"></a>
### T06b — Finish sender and text-line-item grounding

**Review · P0 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Branch implementation exists; review notes identify skipped digit lines, negative/credit handling and sender-block ambiguity.

**Evidence:** fix/t06b-grounding-supplier-and-line-items@a86e00e; wip/t06b-review-fixes@1c69c12

**Acceptance:** Fail closed for notes impersonation, empty/invented items, skipped digit lines, negative/CR/DR items and duplicate/misplaced From blocks; rerun fixtures 09/10 and LLM-07 before integrating.

**Closure dependencies:** T06, T16.

<a id="t08"></a>
### T08 — Reconcile merged chat guards with outstanding review

**Review · P0 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Base chat guards merged; later handoff still reports currency/payee parsing blockers.

**Evidence:** main@a080cc7; wip/t08-review-fixes@3350d7b; latest handoff

**Acceptance:** Reproduce every currency case and ambiguous/negated payee example; reject unsupported/ambiguous currency and payee; one payment attempt; deterministic summary. Do not replace a settled record with a generic model error.

**Closure dependencies:** T04.

<a id="t11"></a>
### T11 — Mutation hardening and typed tool-read outputs

**Ready · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Archived mutation review predates fixes; no fresh mutation score found.

**Evidence:** services/agent/TESTING.md; archived T11; latest handoff

**Acceptance:** Reproduce surviving mutants; validate Rules/SupplierLookup/LogFilter and read results; cover redaction, temperature/retries and mid-run kill switch; publish dated mutation results without reusing old scores.

**Closure dependencies:** T07, T09, T10.

<a id="t13"></a>
### T13 — OpenAI-compatible guarded-agent chat adapter

**Ready · P0 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** ownerChat accepts latestOwnerTurn in-process; no HTTP chat adapter.

**Evidence:** services/agent/src/server.ts; latest handoff supersedes archived T13 SSE design

**Acceptance:** Expose authenticated /v1/chat/completions and model discovery for Open WebUI; derive authority only from latest authenticated owner turn; retain shared queue, deadlines and deterministic payment summary; ignore forged history/system/tool authority. Safe disconnect/stream errors must preserve unknown or settled results.

**Closure dependencies:** T08, T12.

<a id="t14"></a>
### T14 — Bounded PDF intake and invoice CLI fallback

**Ready · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** PDF fixtures are generated; invoice service accepts text, not PDF parsing.

**Evidence:** services/agent/src/server.ts; archived T14

**Acceptance:** Exactly one text/PDF input; verify PDF magic, 2MB decoded/5-page/10s limits; encrypted/no-text goes to review; feed identical guarded path; CLI token from environment. Test normalisation parity on fixture PDFs.

**Closure dependencies:** T12.

<a id="t17"></a>
### T17 — Repeatable real-model finance evaluation

**Blocked · P1 · Owner: Cameron · Reviewer: Tran**

**Existing:** Opt-in tests and fixtures exist; no current qualified finance run on local Qwen.

**Evidence:** services/agent/eval/; scripts/model-smoke-test.ts

**Acceptance:** Pinned model/prompt/tool revisions; fixtures 01-14 and history/payment/refused-policy-change chat; repeated runs with decision, actual calls, exact amounts, latency and failures; never count model claims as payment evidence.

**Closure dependencies:** T06b, T08, T13.

<a id="t18"></a>
### T18 — Local model smoke gate and shared prompts

**Ready · P1 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** User supplied local Qwen chat output; finance tool reliability not demonstrated.

**Evidence:** scripts/model-smoke-test.ts; local chat supplied by user

**Acceptance:** Use selected local model, shared production prompts and actual tool schemas; record digest/context/latency; prove harmless repository read first and guarded mock pay next. No hosted fallback required unless team chooses it.

**Closure dependencies:** T01.

<a id="t19"></a>
### T19 — Conditional simplified approval toolset

**Deferred · P2 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Only needed if measured model confusion justifies it.

**Evidence:** Archived T19

**Acceptance:** Implement only after failed tool-selection evidence; preserve all T05 bindings.

**Closure dependencies:** T18.

<a id="t20"></a>
### T20 — Independent co-signer: auth and signed-byte verification

**Ready · P0 · Owner: Tran · Reviewer: Cameron**

**Existing:** Cosign schemas and coordinator policy interface exist; no service implementation.

**Evidence:** packages/shared/src/policy.ts; services/payments/src/payment.ts; audit P1

**Acceptance:** Isolated Testnet signer authenticates payment service only; decode actual blob, verify expected signer/signature and canonical equality; enforce Payment/treasury; sign exactly checked bytes, never mutable caller JSON; fail closed on exceptions/log failure.

**Closure dependencies:** T03, C01.

<a id="t21"></a>
### T21 — Strict XRPL payment transaction checks

**Blocked · P0 · Owner: Tran · Reviewer: Cameron**

**Existing:** No deployed policy check pipeline found.

**Evidence:** Archived T21; audit X1-X6/P1

**Acceptance:** Allowlist type/fields/flags; cap Fee; exact genuine test RLUSD issuer/currency/cents and approved destination/tag; forbid partial payment/DEX routing; exactly bound memo and expiry. Test every substitution and non-Payment type offline with real generated keys.

**Closure dependencies:** T20.

<a id="t22"></a>
### T22 — Atomic budgets, duplicate protection and reservation lifecycle

**Partial · P0 · Owner: Tran · Reviewer: Xhanti**

**Existing:** SQLite coordinator has reservations/deduplication; not integrated into a real cosign service.

**Evidence:** services/payments/src/payment.ts

**Acceptance:** Use one authoritative durable reservation state; concurrent requests cannot overspend; no second submit per obligation; retain unknown reservations across timeout/restart. Replace archived unconditional TTL release with proven definitive rejection/expiry rules.

**Closure dependencies:** T21, T28.

<a id="t23"></a>
### T23 — Policy version, stale-ledger, memo and rate checks

**Blocked · P0 · Owner: Tran · Reviewer: Cameron**

**Existing:** Policy versions are checked in coordinator; final transaction/memo/ledger checks absent.

**Evidence:** services/payments/src/payment.ts; archived T23

**Acceptance:** Recheck policy/kill switch/reservation at signing and before submission; current < LastLedgerSequence <= current+20; exact unused pending-entry memo; bounded rate window. Durable payment safety cannot depend on a resettable in-memory counter.

**Closure dependencies:** T22, T29.

<a id="t24"></a>
### T24 — Policy decision audit and hostile replay

**Blocked · P0 · Owner: Tran · Reviewer: Cameron**

**Existing:** Adversarial missing-control tests exist; no real co-signer path to replay.

**Evidence:** security/missing-controls.test.ts; archived T24

**Acceptance:** Audit allowed and blocked decisions before releasing signature; no audit write means no sign; replay fixtures and transaction attacks through actual service, including direct calls without agent.

**Closure dependencies:** T23, T16.

<a id="t25"></a>
### T25 — Fresh Testnet RLUSD treasury and recovery-safe multisig

**Partial · P0 · Owner: Tran · Reviewer: Xhanti**

**Existing:** feat/testnet has separate fresh-wallet 1-XRP demo; RLUSD multisig treasury setup absent.

**Evidence:** feat/testnet@9f94e53; services/backend/src/; reported XRP hash in branch status

**Acceptance:** Testnet guard; trusted issuer and trustlines; establish recovery before master disable; verify signer list/quorum and no alternate key bypass. Generate keys at runtime, isolate service stores, print no seeds; prove RLUSD delivered_amount with a validated transaction.

**Closure dependencies:** T03.

<a id="t26"></a>
### T26 — Real wallet adapter, transaction build/sign/submit/reconcile

**Partial · P0 · Owner: Tran · Reviewer: Cameron**

**Existing:** Durable coordinator implemented; wallet.submit/lookup and policy.authorize are interfaces.

**Evidence:** services/payments/src/payment.ts; http.ts; audit P1/P4

**Acceptance:** Persist final transaction/hash/signing attempt before send; no post-approval mutation; verify policy signature and identical bytes; exact validated delivered_amount/issuer/destination/tag; unknown stays reserved and reconciles on restart without replacement transfer.

**Closure dependencies:** T20, T21, T22, T25, T28, T29, C01.

<a id="t27"></a>
### T27 — Kill switch and ledger revocation evidence

**Blocked · P0 · Owner: Tran · Reviewer: Xhanti**

**Existing:** Coordinator flag/lockout exists; no ledger revoke/restore flow.

**Evidence:** services/payments/src/payment.ts; archived T27

**Acceptance:** Owner-only revoke/restore; recheck in-flight policy; document already-submitted transaction limits; capture ledger signer state and actual agent-only/master-key/revoked-signer submission rejections. Non-applied tef failures need RPC+ledger-state evidence, not a fictitious validated failure hash. Fix archived contradictory resume ordering by testing one fail-closed state machine.

**Closure dependencies:** T25, T31.

<a id="t28"></a>
### T28 — Extend durable storage and versioned migrations

**Partial · P0 · Owner: Tran · Reviewer: Xhanti**

**Existing:** Coordinator SQLite exists; business invoices/rules/suppliers/approvals API persistence incomplete.

**Evidence:** services/payments/src/payment.ts; archived T28

**Acceptance:** Reuse existing coordinator rather than duplicate budgets; persist tenant-bound invoices, suppliers, policy versions, approvals, attempts and audit; migration/restart/concurrency tests; exact cents; agent cannot access database.

**Closure dependencies:** T03, C01.

<a id="t29"></a>
### T29 — Durable multi-service audit writer and verification

**Partial · P0 · Owner: Xhanti · Reviewer: Tran**

**Existing:** Shared chain and payment audit gate exist; mock log in memory; external writer/anchors incomplete.

**Evidence:** packages/shared/src/log.ts; services/payments/src/payment.ts; security/audit.test.ts

**Acceptance:** Serialized appends across processes; log allow/block/unknown/settle and owner changes; owner-only bounded export; preserve canonical schema. A locally valid chain alone cannot prove no suffix deletion or complete rewrite; complete H02 before claiming that.

**Closure dependencies:** T28.

<a id="t30"></a>
### T30 — Authenticated real agent-facing API and status/history reads

**Partial · P0 · Owner: Xhanti · Reviewer: Tran**

**Existing:** T15 mock has five routes; MCP /v1 and /transfers differ; production API missing.

**Evidence:** services/mock-backend/; mcp_gateway/; services/payments/src/http.ts

**Acceptance:** One explicit versioned route/status/role map; real storage + coordinator; request schemas and bounded projections; agentApiContract passes; least-privilege token denied every owner route; transport error cannot imply payment failed or safely retryable.

**Closure dependencies:** T28, T29, C01.

<a id="t31"></a>
### T31 — Owner-only mandate, suppliers, approval and kill-switch API

**Partial · P0 · Owner: Tran · Reviewer: Xhanti**

**Existing:** Core owner credential restrictions exist; full owner login/decision API absent.

**Evidence:** services/payments/src/http.ts; archived T31

**Acceptance:** Owner auth/session/Origin/CSRF/expiry plus narrow script credentials; versioned rules; supplier address/tag changes require independent re-verification; auditable decisions; no model/WebUI inference token carries owner authority.

**Closure dependencies:** T30.

<a id="t32"></a>
### T32 — Single-use owner-approved exception payment

**Partial · P1 · Owner: Tran · Reviewer: Xhanti**

**Existing:** Approval request schemas and core owner exceptions exist; complete signing flow absent.

**Evidence:** packages/shared/src/approvals.ts; archived T32

**Acceptance:** Approve exact obligation/recipient/amount/version/expiry once; owner signs outside agent/API; verify returned bytes and identity; budget accounting includes owner payments; distinguish owner authority from independent policy enforcement.

**Closure dependencies:** T26, T31.

<a id="t33"></a>
### T33 — Harden Open WebUI workspace and owner-session boundary

**Partial · P0 · Owner: Xhanti · Reviewer: Cameron**

**Existing:** Compose and user-local chat exist; image uses mutable main tag; finance auth separate.

**Evidence:** deploy/open-webui.compose.yml; docs/open-webui.md; latest handoff

**Acceptance:** Use Open WebUI baseline rather than rebuild archived Next.js chat; pin reviewed image digest; restrict unnecessary direct connections/web loading/code execution; private binding and separate owner controls. Review version-specific advisories; no claim installed version is vulnerable without evidence.

**Closure dependencies:** T03.

<a id="t34"></a>
### T34 — Owner control surface for rules, suppliers and approvals

**Blocked · P0 · Owner: Xhanti · Reviewer: Tran**

**Existing:** Generic WebUI settings are not finance owner controls.

**Evidence:** Archived T34; docs/PRD.md

**Acceptance:** Small authenticated owner UI or companion view; show cap/budget/spent/reserved, approved payees and pending decisions; render untrusted evidence literally; re-verification workflow; no owner writes as model tools.

**Closure dependencies:** T31, T33.

<a id="t35"></a>
### T35 — Owner kill-switch and trustworthy activity view

**Blocked · P0 · Owner: Xhanti · Reviewer: Tran**

**Existing:** No integrated activity/kill-switch screen found.

**Evidence:** Archived T35; packages/shared/src/log.ts

**Acceptance:** Immediate stop-new-payments control; explicit submitted/unknown limits; independent verify/export; safe Testnet links only; distinguish chain continuity from external anchoring and complete ledger history. Paginated windows need checkpoint context, not verifyChain on reversed newest-first rows.

**Closure dependencies:** T27, T29, T33, H01.

<a id="t36"></a>
### T36 — Connect Open WebUI chat and invoice upload to guarded agent

**Blocked · P0 · Owner: Xhanti · Reviewer: Cameron**

**Existing:** Local general chat works; no repo-finance connector registered.

**Evidence:** docs/open-webui.md; services/agent/src/server.ts

**Acceptance:** Configure adapter as guarded agent endpoint; WebUI cannot bypass it via raw pay MCP. Upload passes bounded intake; deterministic payment record visibly separate from model prose; demonstrate authenticated read then mock payment before live Testnet.

**Closure dependencies:** T13, T14, T33.

<a id="t37"></a>
### T37 — Cross-service baseline acceptance and Testnet evidence

**Blocked · P0 · Owner: Cameron · Reviewer: Tran**

**Existing:** Agent/mock/core tests and adversarial suite exist; full deployed pipeline unproved.

**Evidence:** security/; services/agent/test/; services/payments/test/

**Acceptance:** Boot actual services against temporary DB, verify authority and concurrency attacks; then fresh-wallet Testnet RLUSD allowed/blocked/scheduled/history journeys with sanitized evidence. Simulator results labeled simulated; tef failure proof separate from validated success. Never invent passing policy implementation inside tests.

**Closure dependencies:** T06b, T08, T24, T26, T30, T36, S02, H01.

<a id="t38"></a>
### T38 — Current runbook, evidence-backed pitch and demo package

**Partial · P1 · Owner: Xhanti · Reviewer: Cameron**

**Existing:** Docs and supporting statement exist; commands/status and final evidence need reconciliation.

**Evidence:** README.md; docs/PROJECT_STATUS.md; SECURITY_ASSESSMENT.md; archived T38

**Acceptance:** Update active docs and remove retired commands; one-command local stack with explicit mock/Testnet modes; cite exact SHA/results; verify official submission requirements separately. State tested against only; no infallibility/certification/legal or Sharia approval claims.

**Closure dependencies:** T37.

<a id="c01"></a>
### C01 — Freeze one invoice-to-intent and API contract

**Ready · P0 · Owner: Xhanti · Reviewer: Cameron**

**Existing:** Three incompatible contracts exist; archived hybrid recommendation is not implemented.

**Evidence:** MCP README; shared transfers.ts; archived contract-conflict.md; audit P2

**Acceptance:** Xhanti writes route/status/role map; Tran signs off execution, Cameron signs off client. Persist grounded trusted payable and immutable ID; narrowly scoped intake may register obligation but cannot set policy/recipient/unlock/approve. Model pay carries ID, not arbitrary payee/amount; dedupe across invoice revisions and UI retries.

**Closure dependencies:** T03.

<a id="m01"></a>
### M01 — Align MCP tools with selected guarded backend

**Partial · P1 · Owner: Xhanti · Reviewer: Tran**

**Existing:** Seven stdio tools and strict two-tool transfer entry point exist; not attached to real backend/WebUI.

**Evidence:** mcp_gateway/server.py; transfers.py; tests

**Acceptance:** Contract tests cover canonical backend, error/unknown/status handling, scoped auth, output allowlists and extra-field refusal. Keep optional raw finance MCP for separately authorized clients; baseline WebUI uses guarded T13 agent, not direct payment tool access.

**Closure dependencies:** C01, T30, SEC02.

<a id="s01"></a>
### S01 — Owner scheduling/cancel/reschedule tools and records

**Ready · P0 · Owner: Xhanti · Reviewer: Tran**

**Existing:** Core executeAt exists; no bounded chat schedule/cancel/status journey.

**Evidence:** services/payments/src/payment.ts; user baseline overrides old scheduling exclusion

**Acceptance:** Authenticated owner request binds trusted intent, amount/payee, timezone and UTC due instant; clarify ambiguous date/time and confirm interpretation; cancel/reschedule cannot race execution or change settled/unknown history. Agent cannot create arbitrary authority; persist scheduling changes and responses.

**Closure dependencies:** C01, T30, T31.

<a id="s02"></a>
### S02 — Deploy durable due-payment worker and recovery

**Partial · P0 · Owner: Tran · Reviewer: Xhanti**

**Existing:** executeDue and /transfers/due exist; no deployed timer/worker.

**Evidence:** services/payments/src/payment.ts; services/payments/src/http.ts

**Acceptance:** Bounded authenticated worker; due-time policy/kill/recipient/expiry checks, atomic claim and restart-safe once-only execution. Two workers and repeated timer ticks cannot duplicate; unknown retains reservation; surface missed/delayed/cancelled status.

**Closure dependencies:** T26, T31, S01.

<a id="h01"></a>
### H01 — Payment/transaction history and balance tools

**Ready · P0 · Owner: Xhanti · Reviewer: Tran**

**Existing:** query_log and legacy balance/status adapters exist; complete validated XRPL history absent.

**Evidence:** services/agent/src/tools.ts; mcp_gateway/server.py; user baseline

**Acceptance:** Paginated, tenant-authorized status/history and genuine RLUSD balance from validated ledger; distinguish intent/audit/settled/on-chain events; include incoming/out-of-band transactions for selected treasury, ledger cursor/reconnect/dedupe; bounded filters and privacy-safe results. Live answers reference actual records/hashes, never model memory.

**Closure dependencies:** C01, T26, T29, T30.

<a id="h02"></a>
### H02 — Independent audit heads and ledger memo verifier

**Ready · P0 · Owner: Xhanti · Reviewer: Tran**

**Existing:** Local chain detects many edits but not full rewrite/suffix deletion without independent head.

**Evidence:** security/audit.test.ts; audit A6/Feature B

**Acceptance:** Persist authenticated checkpoints outside payment DB; match actual payment memo to durable request entry; detect deletion/rollback/full recomputation against checkpoint; disclose unanchored blocked-event suffixes. Never expose invoice or personal data in memo.

**Closure dependencies:** T29.

<a id="sec01"></a>
### SEC01 — Close secret scanner hash-label bypass (R2)

**Ready · P0 · Owner: Xhanti · Reviewer: Cameron**

**Existing:** Raw 64-hex exemption for hash/digest/checksum remains open.

**Evidence:** .gitleaks.toml; security/test_python.py; audit R2

**Acceptance:** Real scanner regressions catch runtime canary with deceptive labels/comments; exact legitimate hashes remain usable; no real secrets; CI remains green without relaxing scanner.

**Closure dependencies:** T02.

<a id="sec02"></a>
### SEC02 — Bound and sanitise every tool-read response

**Ready · P0 · Owner: Cameron · Reviewer: Xhanti**

**Existing:** Address redaction/minimisation exists; backend dictionaries/free-text paths need typed projection.

**Evidence:** services/agent/src/tools.ts; mcp_gateway/server.py; historical V-02

**Acceptance:** Strict schemas and field allowlists for log/rules/supplier/status/balance; canary credentials and untrusted instruction strings never reach next model prompt/logs/errors; owner detail view separate. Test TS and Python paths.

**Closure dependencies:** T07.

<a id="ops01"></a>
### OPS01 — Isolate keys/services and record current security evidence

**Ready · P0 · Owner: Tran · Reviewer: Cameron**

**Existing:** Config guards/tests exist; actual runtime filesystem/network/key isolation not proved.

**Evidence:** AGENTS.md; audit R6/P4; security/README.md

**Acceptance:** Separate signer/agent/policy identities and storage; no signer seeds in WebUI/agent; private binds and no public model/tool ports; exercise restart/restore and compromised-agent containment; rerun current adversarial suite on pinned runtime and retain SHA/results. Deployment dependency blocks final closure, not the initial isolation plan.

**Closure dependencies:** T20, T25, T26.

<a id="later01"></a>
### LATER01 — Firefox/Chrome sidebar extension

**Deferred · P2 · Owner: Xhanti · Reviewer: Cameron**

**Existing:** Requested later, no extension implementation found.

**Evidence:** User baseline decision

**Acceptance:** Only after baseline acceptance; scoped read-only page intake/explicit actions and same guarded authority boundary.

**Closure dependencies:** T37.

<a id="later02"></a>
### LATER02 — Broader banking, FX, escrow, yield and commercial rollout

**Deferred · P2 · Owner: Tran · Reviewer: Xhanti**

**Existing:** Roadmap aspirations and governance research; not baseline banking parity.

**Evidence:** docs/PRD.md; FINANCE_TRUST_FRAMEWORK.md; original technical plan

**Acceptance:** Separate product requirements and legal/custody/Sharia review when applicable; no bank/compliance certification claims from Testnet.

**Closure dependencies:** T37.

## Update the board

Edit `docs/planning/baseline-kanban.json` as the shared source, and refresh the Markdown/HTML snapshots together. The HTML also supports local moves and JSON export for handoff; those browser-local changes do not update GitHub. Move a card to Done only with a commit and reproducible result that satisfy its acceptance, retaining evidence levels. Do not count conditional/deferred cards in baseline percentages.
