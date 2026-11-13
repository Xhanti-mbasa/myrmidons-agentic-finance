# Implementation backlog and evidence map

The broad inventory below is a historical pinned-source review. The following payment update records newer branch work and supersedes that review for issues #30–#33 only; it does not close the broader integration or release gates.

## Payment controls and paid resources: issues #30–#33 integration update

Snapshot: 13 November 2026. Source baseline `47b6c55`; inspect current branches
and handoffs before using this snapshot as implementation evidence. These issues
extend the invoice-payment MVP; paid-resource work does not silently replace its
release criteria. No Mainnet or real-value execution is authorized here.

| Issue | Work and evidence | Remaining gate |
|---|---|---|
| [#30](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/30) | Verification and [shared handoff](HANDOFF_ISSUE30.md) complete. Cumulative RLUSD caps, budget and disable semantics checked; typecheck and 67 payment-project tests passed on `c9d415b`. | Actual independent signer and Testnet evidence belong to #31; simulated tests do not establish deployment. |
| [#31](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/31) | Concrete Testnet transfer wallet adapter, signed permit checks, durable transaction identity, final signing/revocation DB gate and exact ledger receipt verification. [Integration handoff](PAYMENT_INTEGRATION.md). | Deploy isolated provider and final co-sign topology; validated allowed/blocked Testnet evidence. Privy remains with the transaction workstream. |
| [#32](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/32) | Presigned v2 RLUSD executor, merchant revalidation, durable crash/no-sign recovery, private authenticated host and strict MCP tools; generated-key and scripted transport tests. [Integration handoff](PAYMENT_INTEGRATION.md). | Funded dedicated wallet, compatible real HTTPS merchant/facilitator purchase and deployment evidence. Signed-but-unconfirmed expiry recovery remains conservative/unknown. |
| [#33](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/33) | Daily/weekly/monthly categories, purchase-wallet aggregate RLUSD allowance, signed owner-attested rate/fee envelopes and final signer checks; rejected payments retain fee charges. [Integration handoff](PAYMENT_INTEGRATION.md). | Deploy quote publisher with reviewed rate/fee source and prove live period-boundary behavior. No automatic market-price feed is claimed. |

All four workstreams require honest separation of source inspection, fake-adapter
tests, local HTTP/model evidence and actual validated ledger transactions. Owner
controls and deployment isolation must be enforced outside the model. The current
invoice APIs and transfer/purchase extensions require explicit adapters.

## Pinned baseline review

Reviewed **13 November 2026 (Africa/Johannesburg)** against `main@47b6c55f6c33c5ce3f4e518245e12cd85082ad92`.
All **21 tracked Markdown files** at that commit were read; the source and relevant
branch heads were inspected where docs contradicted implementation. This is a
ready-to-assign ticket list, **not newly created GitHub issues**, personal task
assignments, dates, or promises. B/D identifiers are local to this document and
preserve earlier T/FR/AC/audit references rather than renumbering them.

## How far implemented

The project has an implemented **guarded agent, authenticated agent HTTP service,
dev-only mock backend, strict stdio MCP gateway, shared contracts, adversarial tests,
and durable transfer coordinator**. It does not yet have the integrated real
backend, independent co-signer, live RLUSD wallet execution, owner dashboard or
reviewed Testnet end-to-end evidence needed for the payment MVP.

There are **13 completed implementation slices** (with explicit limits) and
**40 remaining tickets** below. These are planning units of different sizes,
not a completion percentage. A schema, mock, branch or green expected-failure
job is not a deployed financial control. No tests or ledger transactions were
run during this documentation review; test sources and previously recorded
results were inspected. Historical 79-case security counts are not represented
as fresh results.

**Immediate path for the tools you asked for:** B01 → B13/B14 → B15 can establish a
clearly labelled mock developer demo. Existing TypeScript tools should stay
behind the guarded agent where needed. The seven Python gateway tools do not
map automatically onto the five mock-backend routes. Real payment execution
additionally needs B02–B12 and B22/B23. WebUI built-ins are not these repo tools.

## Status and priority legend

- **DONE (bounded):** source/tests exist for that slice; deployment or live funds are not implied.
- **PARTIAL:** meaningful code exists, with named missing work.
- **BRANCH WORK:** relevant source exists outside this main snapshot; review/integration still required.
- **MISSING / OPEN:** no complete implementation found, or a documented defect remains.
- **NOT VERIFIED:** implementation/setup may exist, but current operational proof is absent.
- **DECISION / PROPOSED:** an owner/specialist scope decision is needed; proposals are not approved scope.
- **P0:** blocks the credible independently enforced Testnet MVP/security claim.
- **P1:** developer integration, owner usability, operations or important hardening.
- **P2:** later enhancement or separately gated real-value/legal/Sharia readiness. P2 is not permission to skip an applicable production obligation.

All execution remains **Testnet only**. This backlog neither enables payments nor
changes security permissions, repository settings or funding authority.

## Completed slices — reuse these

| ID | Implemented slice | Source evidence | Completion limit |
|---|---|---|---|
| D01 | Shared schemas, exact cents, supplier matching and audit primitives | packages/shared/src/; packages/shared/test/ | Implemented library and tests; schemas do not implement consuming services. |
| D02 | Invoice extraction/planning and six bounded agent tools (T04/T05/T06) | services/agent/src/; services/agent/test/ | Implemented; T06b remains B16, and real backend/signing is missing. |
| D03 | Planner input minimisation (T07) and chat payment guards (T08) | services/agent/src/agent.ts (plannerView); services/agent/src/tools.ts | Present on main; do not reopen whole T07 merely because its named branch still exists. |
| D04 | Startup secret guards, timeout/body/run bounds and deterministic responses (T09/T10) | services/agent/src/config.ts; limits.ts; backend.ts; explanation.ts | Redirect refusal exists; secrets in returned text still need B17. |
| D05 | Authenticated agent HTTP service and serial invoice queue (T12) | services/agent/src/server.ts; main.ts; test/server.test.ts | Implemented /health and /agent/invoices; ownerChat is an in-process seam, not T13 HTTP integration. |
| D06 | Explicit local mock backend (T15) | services/mock-backend/; packages/shared/test-support/contract.ts | Implemented simulation with mock headers/hashes and tests; not durable payment execution. |
| D07 | Demo/red-team text fixtures, PDFs and expected outcomes (T16) | fixtures/; scripts/make-invoice-pdfs.ts; scripts/test/fixtures.test.ts | Implemented fixture pack; existing model-only gaps are documented, not solved by fixtures. |
| D08 | Strict stdio MCP payment gateway and transfer-only endpoint | mcp_gateway/server.py; transfers.py; test_server.py; test_transfers.py | Implemented adapter/test sources; backend and HTTP/WebUI connection remain B01/B13. |
| D09 | Durable transfer coordinator, auth factory, scheduling and lockout | services/payments/src/; test/payment.test.ts | SQLite core implemented and adapter seams present; no live wallet, signer or scheduler deployment. |
| D10 | Adversarial suite, pinned-action CI, secret/path guardrails | security/; .github/workflows/; .githooks/ | Implemented regression/evidence machinery; expected failures deliberately expose missing controls. |
| D11 | Team access client/root sync and scheduler definitions | src/w3node/; deploy/w3node-sync.*; tests/ | Implemented code; unattended provisioning and accepted-share revocation need operational evidence. |
| D12 | Open WebUI Compose workspace and local inference setup | deploy/open-webui.compose.yml; docs/open-webui.md | Config/docs implemented; local Qwen chat and timestamp tool observed this session only, not finance integration. |
| D13 | Product, technical, governance and session-context documentation | docs/PRD.md; TECHNICAL_SPEC.md; FINANCE_TRUST_FRAMEWORK.md; SESSION_START.md | Written baseline/research exists; conflicting historical snapshots need B29, legal approvals remain open. |

## Remaining ticket index

| Ticket | Priority | Current status | Workstream | Next outcome | Dependencies |
|---|---|---|---|---|---|
| [B01](#b01) | P0 | PARTIAL | W1/W2/W3/W4 | Agree the invoice, transfer and MCP contracts | None |
| [B02](#b02) | P0 | MISSING | W4/W2 | Persist trusted invoice identity and add least-privilege intake | B01 |
| [B03](#b03) | P0 | PARTIAL | W4 | Build the durable production backend and payment host | B01, B02 |
| [B04](#b04) | P0 | PARTIAL | W4/W5 | Complete owner authentication and service authorization | B01 |
| [B05](#b05) | P0 | PARTIAL | W4/W5 | Verify supplier identities and destination changes | B03, B04 |
| [B06](#b06) | P0 | PARTIAL | W4/W5 | Implement owner exception decisions | B03, B04, B05 |
| [B07](#b07) | P0 | MISSING | W3 | Construct and persist the exact XRPL transaction before policy approval | B01, B03, B10 |
| [B08](#b08) | P0 | MISSING | W2 | Implement independent policy co-signing | B03, B07, B09, B10 |
| [B09](#b09) | P0 | MISSING | W3/operations | Implement isolated signing and key lifecycle | B10 |
| [B10](#b10) | P0 | DECISION | W2/W3/owner | Approve signer topology and recovery semantics | None |
| [B11](#b11) | P0 | PARTIAL | W3 | Persist signing attempts and reconcile validated outcomes | B07, B08, B09 |
| [B12](#b12) | P0 | MISSING | W5 | Build the finance owner dashboard | B03, B04, B05, B06 |
| [B13](#b13) | P1 | MISSING | W1/developer tooling | Expose repository tools over authenticated HTTP for WebUI | B01; B17 before sensitive data; B03/B08/B11 before real execution |
| [B14](#b14) | P1 | MISSING | W1 | Connect WebUI chat to the guarded agent (T13) | B01; B03 for live backend; B13 only if choosing MCP transport |
| [B15](#b15) | P1 | NOT VERIFIED | W1/developer tooling | Prove repository tools work with local Qwen | B13 or B14 |
| [B16](#b16) | P0 | BRANCH WORK | W1 | Land supplier and line-item grounding fixes (T06b) | None |
| [B17](#b17) | P0 | PARTIAL | W1/W4 | Keep secrets and untrusted backend text out of model context | None |
| [B18](#b18) | P0 | OPEN | security | Fix gitleaks hash-comment exemptions (R2) | None |
| [B19](#b19) | P1 | PARTIAL | W4/W3 | Add independent audit checkpoints and verification | B03; B07/B11 for ledger anchors |
| [B20](#b20) | P1 | PARTIAL | W2/W4 | Define budget periods and add recipient aggregates/velocity holds | B03, B08 |
| [B21](#b21) | P1 | PARTIAL | W3/operations | Deploy scheduled payment execution | B03, B08, B11 |
| [B22](#b22) | P0 | BRANCH WORK | W3 | Prepare genuine test RLUSD and a reproducible Testnet harness | B07, B08, B09, B10, B11 |
| [B23](#b23) | P0 | MISSING | all workstreams | Assemble live release evidence for AC-01 through AC-07 | B02–B12, B16, B22 |
| [B24](#b24) | P0 | PARTIAL | security/CI | Reconcile current security tests and historical assessment | Incremental: B16–B18; final: B08/B11/B19/B23 |
| [B25](#b25) | P1 | PARTIAL | W1 | Qualify the model and pin demo configuration | B13 or B14; B16 |
| [B26](#b26) | P0 | NOT VERIFIED | operations/security | Enforce runtime isolation and secret boundaries | B03, B04, B09 |
| [B27](#b27) | P1 | MISSING | operations | Rehearse backups, incidents and key recovery | B09, B11, B19, B26 |
| [B28](#b28) | P1 | NOT VERIFIED | operations/onboarding | Validate and deploy automatic team onboarding | None; requires authorized administrator |
| [B29](#b29) | P1 | OPEN | documentation | Reconcile stale docs, commands and status tables | Use this review immediately; update again after code tickets |
| [B30](#b30) | P1 | DECISION | owner/security | Choose licensing and publish disclosure/threat model | Owner decisions |
| [B31](#b31) | P2 | DECISION | business/legal | Confirm operating model and regulatory responsibilities | Custody decision B10; production-only release gate |
| [B32](#b32) | P2 | PROPOSED | W2/W4/compliance | Implement scoped eligibility evidence when required | B05, B08, B31; B33 if offering that profile |
| [B33](#b33) | P2 | DECISION | owner/qualified Sharia reviewer | Review Islamic-finance profile and asset/agency terms | B31; no external approval needed merely to run a labelled Testnet prototype |
| [B34](#b34) | P2 | MISSING | W4/privacy/legal | Implement privacy, retention and protected records | B03, B31 |
| [B35](#b35) | P2 | PROPOSED | W3/W4 | Monitor inbound, out-of-band and issuer-control events | B11, B12 |
| [B36](#b36) | P2 | PROPOSED | W2/W4/W5 | Add supplier key-continuity after identity verification | B05, B08, B12 |
| [B37](#b37) | P1 | DECISION | owner/product | Validate target customer, submission requirements and business model | None |
| [B38](#b38) | P2 | PROPOSED | W4/W5 | Evaluate two-owner mandate changes | B04, B06, B12; owner scope decision |
| [B39](#b39) | P2 | PROPOSED | product/W2/W3 | Evaluate contractual early-payment discounts | B02, B08, B11; B33 if applicable |
| [B40](#b40) | P2 | OPEN | W4/performance | Benchmark and checkpoint audit verification | B19 |

## Detailed tickets

<a id="b01"></a>
### [ ] B01 — Agree the invoice, transfer and MCP contracts

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** W1/W2/W3/W4. **Assignee:** unassigned.

**Already implemented:** Shared invoice schemas, /transfers schemas and Python /v1 client expectations exist as three distinct interfaces.

**To do:** Choose one canonical invoice-to-payment flow and explicitly map the other interfaces, errors, uncertain outcomes and versioning.

**Acceptance criteria:** Publish route/status/role mapping; contract tests cover each consumer; pending/unknown cannot map to paid; no blanket HTTP-4xx resubmission assumption.

**Depends on:** None.

**Evidence / originating requirement:** docs/TECHNICAL_SPEC.md; mcp_gateway/server.py; packages/shared/src/transfers.ts.

<a id="b02"></a>
### [ ] B02 — Persist trusted invoice identity and add least-privilege intake

**Priority:** P0. **Status:** MISSING. **Suggested lane:** W4/W2. **Assignee:** unassigned.

**Already implemented:** Extraction and owner-only createIntent exist; neither establishes an autonomous approved business obligation.

**To do:** Implement stored payable identity/revisions, trusted source evidence and createIntentFromInvoice under a narrow intake capability.

**Acceptance criteria:** Intake cannot change policy, recipients, accounts, unlock or execute; cross-tenant/revoked/evidence failures block; revised and concurrent invoices cannot duplicate one obligation.

**Depends on:** B01.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (P2); services/payments/src/payment.ts.

<a id="b03"></a>
### [ ] B03 — Build the durable production backend and payment host

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** W4. **Assignee:** unassigned.

**Already implemented:** T15 mock implements the agent API; transfer core has SQLite and a server factory. The mock resets payment state and submits nothing.

**To do:** Create a real configured host and persistence/migrations for suppliers, policies, invoices, approvals and operation IDs; connect invoice requests to the core.

**Acceptance criteria:** Restart/concurrency and tenant tests pass against real storage; shared agentApiContract passes; mock data/hashes never enter production paths; service starts with fail-closed configuration.

**Depends on:** B01, B02.

**Evidence / originating requirement:** services/mock-backend/README.md; packages/shared/test-support/contract.ts; services/payments/src/http.ts.

<a id="b04"></a>
### [ ] B04 — Complete owner authentication and service authorization

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** W4/W5. **Assignee:** unassigned.

**Already implemented:** Agent inbound bearer auth, transfer owner/agent credential map and mock role separation exist.

**To do:** Implement owner login/session and per-operation service capabilities, rotation/revocation, audit of changes and API authorization.

**Acceptance criteria:** Agent/intake cannot call owner operations; tenant isolation and owner-session tests pass; no owner token in WebUI model context; production role model documented.

**Depends on:** B01.

**Evidence / originating requirement:** services/agent/src/server.ts; services/payments/src/http.ts; docs/PRD.md (FR-01/12).

<a id="b05"></a>
### [ ] B05 — Verify supplier identities and destination changes

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** W4/W5. **Assignee:** unassigned.

**Already implemented:** ID-based tools, checksum validation and intent recipient binding exist; proposals still carry invoice-originated addresses.

**To do:** Add trusted onboarding, independent contact verification, address/tag provenance and a versioned approval/change workflow.

**Acceptance criteria:** Invoice address is labelled unverified; an authenticated independent verification is required before it is payable; old intents cannot silently redirect after edits.

**Depends on:** B03, B04.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (A4); services/agent/src/tools.ts; services/payments/src/payment.ts.

<a id="b06"></a>
### [ ] B06 — Implement owner exception decisions

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** W4/W5. **Assignee:** unassigned.

**Already implemented:** Agent creates bounded approval requests; mock appends pending requests. No real decision API/owner queue is implemented.

**To do:** Build persisted supplier/payment approval decisions tied to exact invoice, amount, recipient, policy and expiry.

**Acceptance criteria:** Approval cannot be self-issued or reused for another payment; owner decision revalidates policy; legally prohibited operations cannot be overridden as ordinary exceptions.

**Depends on:** B03, B04, B05.

**Evidence / originating requirement:** packages/shared/src/approvals.ts; services/agent/src/tools.ts; docs/PRD.md (FR-11).

<a id="b07"></a>
### [ ] B07 — Construct and persist the exact XRPL transaction before policy approval

**Priority:** P0. **Status:** MISSING. **Suggested lane:** W3. **Assignee:** unassigned.

**Already implemented:** PreparedTransfer is an abstract business object; it does not cover final Fee, Flags, Sequence, expiry or Memo.

**To do:** Build one canonical Testnet RLUSD Payment from trusted records; persist sequence/ticket, ledger expiry, memo and signing payload before authorization.

**Acceptance criteria:** Every relevant field is bound and substitution-tested; no autofill/mutation after approval; signing serialization uses XRPL protocol encoding; unsupported fields fail closed.

**Depends on:** B01, B03, B10.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (P1/X6); services/payments/src/payment.ts; packages/shared/src/policy.ts.

<a id="b08"></a>
### [ ] B08 — Implement independent policy co-signing

**Priority:** P0. **Status:** MISSING. **Suggested lane:** W2. **Assignee:** unassigned.

**Already implemented:** Policy contracts and coordinator authorization calls exist; there is no production co-signer.

**To do:** Decode the actual candidate bytes independently; enforce mandate, budgets, reservation, recipient, asset, type, fee, expiry and revocation; produce a real multisignature.

**Acceptance criteria:** Payment-only allowlist; reject partial payments, Paths/unsupported SendMax, wrong asset/issuer, fee excess, stale expiry and memo/tag substitutions; direct calls cannot bypass policy.

**Depends on:** B03, B07, B09, B10.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (X1–X6/X8/P1); security/missing-controls.test.ts.

<a id="b09"></a>
### [ ] B09 — Implement isolated signing and key lifecycle

**Priority:** P0. **Status:** MISSING. **Suggested lane:** W3/operations. **Assignee:** unassigned.

**Already implemented:** TS agent environment secret rejection is implemented; wallet/key-store APIs are only obligations.

**To do:** Select a supported signer/vendor; implement generation, encrypted storage, isolated execution signing, key rotation and recovery.

**Acceptance criteria:** No signing keys in model/WebUI/developer environment or logs; independent keys cannot be read by one execution process; custody and recovery are exercised, not inferred from schemas.

**Depends on:** B10.

**Evidence / originating requirement:** docs/FINANCE_TRUST_FRAMEWORK.md; services/payments/README.md; security/missing-controls.test.ts (KEY-01/02).

<a id="b10"></a>
### [ ] B10 — Approve signer topology and recovery semantics

**Priority:** P0. **Status:** DECISION. **Suggested lane:** W2/W3/owner. **Assignee:** unassigned.

**Already implemented:** Agent 1 + policy 1 + owner 2 / quorum 2 is proposed; owner-only authority is an explicit exception, not universal policy enforcement.

**To do:** Record signer owners, quorum, policy scope, alternate master/regular-key paths and recovery; provision fresh Testnet accounts safely.

**Acceptance criteria:** Recovery verified before disabling master; ledger state matches approved topology; agent-only bypass fails; owner exception accurately described; no unattended setup risks lockout.

**Depends on:** None.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (Q2/X5); docs/FINANCE_TRUST_FRAMEWORK.md §4.

<a id="b11"></a>
### [ ] B11 — Persist signing attempts and reconcile validated outcomes

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** W3. **Assignee:** unassigned.

**Already implemented:** Core retains unknown reservations and reconciles through a mandatory adapter; adapter implementation and signed-attempt recovery are absent.

**To do:** Persist candidate/signature/blob/hash before transmission; make signing attempts idempotent/queryable; verify ledger outcomes and proven expiry.

**Acceptance criteria:** Validate delivered_amount, exact asset/issuer, account, recipient/tag/hash; no reservation release after uncertain signing timeout; restarts and RPC failures cannot mint replacement payments.

**Depends on:** B07, B08, B09.

**Evidence / originating requirement:** services/payments/src/payment.ts; docs/AUDIT_COLLAB.md (P1 timeout consequence); docs/PRD.md (FR-13).

<a id="b12"></a>
### [ ] B12 — Build the finance owner dashboard

**Priority:** P0. **Status:** MISSING. **Suggested lane:** W5. **Assignee:** unassigned.

**Already implemented:** Open WebUI is a generic model workspace; it is not an implemented mandate/approval control surface.

**To do:** Implement owner supplier, cap/budget, treasury, approval, kill-switch, pending-operation and evidence screens.

**Acceptance criteria:** Owner completes AC-03/04/06 journeys; unknown is never labelled paid; agent credentials cannot mutate controls; supplier-address provenance and issuer risks are visible.

**Depends on:** B03, B04, B05, B06.

**Evidence / originating requirement:** docs/PRD.md §§5/7; docs/open-webui.md.

<a id="b13"></a>
### [ ] B13 — Expose repository tools over authenticated HTTP for WebUI

**Priority:** P1. **Status:** MISSING. **Suggested lane:** W1/developer tooling. **Assignee:** unassigned.

**Already implemented:** Python gateway exposes seven stdio tools, with a stricter two-tool transfer entry point. No HTTP registration/adapter is present.

**To do:** Add a reviewed MCP Streamable HTTP or OpenAPI bridge, scoped auth, loopback/private binding and a reproducible launch/configuration guide.

**Acceptance criteria:** WebUI discovers real schemas; unauthorized/unknown/extra-field calls fail; no secrets in tools/results; mock mode is explicit; /v1 tools are not pointed at a backend lacking those routes.

**Depends on:** B01; B17 before sensitive data; B03/B08/B11 before real execution.

**Evidence / originating requirement:** mcp_gateway/server.py; mcp_gateway/transfers.py; docs/open-webui.md §5.

<a id="b14"></a>
### [ ] B14 — Connect WebUI chat to the guarded agent (T13)

**Priority:** P1. **Status:** MISSING. **Suggested lane:** W1. **Assignee:** unassigned.

**Already implemented:** T12 exposes /agent/invoices and an in-process ownerChat latestOwnerTurn seam; no WebUI/OpenAI-compatible chat adapter is implemented.

**To do:** Create the chat adapter with shared queue/auth and latest-owner-turn semantics; preserve the guarded code instead of recreating payment authority in a WebUI prompt.

**Acceptance criteria:** WebUI exercises the real guarded agent; model-generated text cannot claim settlement; prior assistant history is not interpreted as a new owner payment instruction; mock demo is unmistakable.

**Depends on:** B01; B03 for live backend; B13 only if choosing MCP transport.

**Evidence / originating requirement:** services/agent/src/server.ts (ownerChat); services/agent/src/agent.ts; docs/open-webui.md §4.

<a id="b15"></a>
### [ ] B15 — Prove repository tools work with local Qwen

**Priority:** P1. **Status:** NOT VERIFIED. **Suggested lane:** W1/developer tooling. **Assignee:** unassigned.

**Already implemented:** User-local Qwen chat and built-in timestamp call were observed in this session. Those are not repo payment-tool evidence.

**To do:** Run a harmless/read-only repository tool first, then guarded agent + explicit mock backend; record versions, inputs, actual tool calls and results.

**Acceptance criteria:** One-command runbook works on a fresh setup; failures are visible; tool calls, not conversational claims, establish success; later live finance evidence is separate.

**Depends on:** B13 or B14.

**Evidence / originating requirement:** services/agent/TESTING.md; docs/open-webui.md; services/mock-backend/README.md.

<a id="b16"></a>
### [ ] B16 — Land supplier and line-item grounding fixes (T06b)

**Priority:** P0. **Status:** BRANCH WORK. **Suggested lane:** W1. **Assignee:** unassigned.

**Already implemented:** Main still grounds supplier words anywhere in text and permits empty model line items. Branch a86e00e contains sender/layout and item checks.

**To do:** Review/rebase relevant T06b work and its review-fixes branch; integrate without weakening adversarial expectations.

**Acceptance criteria:** Fixture 09 cannot select another approved supplier via notes; fixture 10 cannot hide mismatch via empty/invented items; ordinary invoice variants remain supported; LLM-07 classification changes only with reproduction.

**Depends on:** None.

**Evidence / originating requirement:** services/agent/src/grounding.ts; fixtures/red-team/README.md; security/agent.test.ts; branch fix/t06b-grounding-supplier-and-line-items.

<a id="b17"></a>
### [ ] B17 — Keep secrets and untrusted backend text out of model context

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** W1/W4. **Assignee:** unassigned.

**Already implemented:** Agent startup guards, address redaction and planner minimisation exist. Backend log notes can still carry secret-shaped text; Python returns backend dictionaries.

**To do:** Use bounded endpoint schemas/field allowlists and consistent secret-safe result projections in both tool paths; isolate signer logs.

**Acceptance criteria:** SECRET-02 and MCP-02 safe outcomes pass; canaries never enter the next model prompt or errors; owner-visible details remain access-controlled.

**Depends on:** None.

**Evidence / originating requirement:** SECURITY_ASSESSMENT.md (V-02); services/agent/src/tools.ts; mcp_gateway/server.py.

<a id="b18"></a>
### [ ] B18 — Fix gitleaks hash-comment exemptions (R2)

**Priority:** P0. **Status:** OPEN. **Suggested lane:** security. **Assignee:** unassigned.

**Already implemented:** Pinned scanner, hook and CI self-tests exist; raw-hex rule still exempts an entire line containing hash/digest/checksum.

**To do:** Narrow exemptions to reviewed fields/paths, add real-scanner regressions, and document split/encoded-secret limitations.

**Acceptance criteria:** Same runtime canary is caught with deceptive field names/comments; normal hashes remain usable; no real keys committed; SCAN-02 reclassified from observed evidence only.

**Depends on:** None.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (R2); .gitleaks.toml; security/test_python.py.

<a id="b19"></a>
### [ ] B19 — Add independent audit checkpoints and verification

**Priority:** P1. **Status:** PARTIAL. **Suggested lane:** W4/W3. **Assignee:** unassigned.

**Already implemented:** Canonical shared chains and SQLite gate detect ordinary edits/gaps. Suffix deletion and complete rewrite remain undetectable locally.

**To do:** Retain authenticated heads outside payment DB; implement ledger memo/anchor retrieval and full export verifier, including blocked-event coverage.

**Acceptance criteria:** AUDIT-04/05/06/08/09 pass intended safe outcomes; rollback/erasure detected against an independent checkpoint; no invalid self-payment anchor; no personal data in public memos.

**Depends on:** B03; B07/B11 for ledger anchors.

**Evidence / originating requirement:** packages/shared/src/log.ts; security/audit.test.ts; docs/AUDIT_COLLAB.md (A6/Feature B).

<a id="b20"></a>
### [ ] B20 — Define budget periods and add recipient aggregates/velocity holds

**Priority:** P1. **Status:** PARTIAL. **Suggested lane:** W2/W4. **Assignee:** unassigned.

**Already implemented:** Core has cumulative owner budget, recipient per-payment cap overrides and five-rejection principal lockout. These are not recipient-period or rolling velocity controls.

**To do:** Define period rollover without losing unknown reservations; implement atomic recipient/owner aggregates and bounded review holds if selected.

**Acceptance criteria:** Concurrent split invoices cannot bypass agreed period limits; transitions preserve reservations; risk holds are reviewable and never presented as an AML verdict.

**Depends on:** B03, B08.

**Evidence / originating requirement:** services/payments/README.md; docs/PRD.md §§5/7; docs/AUDIT_COLLAB.md (Feature C).

<a id="b21"></a>
### [ ] B21 — Deploy scheduled payment execution

**Priority:** P1. **Status:** PARTIAL. **Suggested lane:** W3/operations. **Assignee:** unassigned.

**Already implemented:** Core stores schedules and exposes executeDue plus /transfers/due. No host timer/cron is installed by that code.

**To do:** Add authenticated bounded scheduler and recovery/monitoring; preserve due-time policy, recipient and expiry rechecks.

**Acceptance criteria:** Repeated timers/restarts execute each intent once; revoked/expired schedules block; scheduled never means settled; unknown operation remains reserved.

**Depends on:** B03, B08, B11.

**Evidence / originating requirement:** services/payments/src/payment.ts; services/payments/README.md (FR-21).

<a id="b22"></a>
### [ ] B22 — Prepare genuine test RLUSD and a reproducible Testnet harness

**Priority:** P0. **Status:** BRANCH WORK. **Suggested lane:** W3. **Assignee:** unassigned.

**Already implemented:** feat/testnet@5c120b2 contains fresh-wallet funding and a validated 1-XRP demo checker. It is not on main and is not RLUSD or multisig integration.

**To do:** Review the branch as a smoke-test foundation; add issuer/currency verification, fresh trust lines/wallets and the real product adapters.

**Acceptance criteria:** Testnet-only configuration and no stored seeds; validated RLUSD delivered_amount evidence; XRP smoke test remains separately labelled and does not satisfy AC-01.

**Depends on:** B07, B08, B09, B10, B11.

**Evidence / originating requirement:** branch feat/testnet: services/backend/src/xrpl-demo.ts and confirmation.ts; packages/shared/src/constants.ts.

<a id="b23"></a>
### [ ] B23 — Assemble live release evidence for AC-01 through AC-07

**Priority:** P0. **Status:** MISSING. **Suggested lane:** all workstreams. **Assignee:** unassigned.

**Already implemented:** Fixtures, local mock tests and adversarial specifications exist; no reviewed validated product payment is in main evidence.

**To do:** Run the allowed RLUSD path plus policy/kill-switch, duplicate/restart, hostile-input and direct signer-bypass cases.

**Acceptance criteria:** Retain sanitized validated setup/payment hashes and delivered_amount; tef rejections retain submit and ledger-state evidence, not a fictitious validated rejection tx; explain all seven acceptance criteria.

**Depends on:** B02–B12, B16, B22.

**Evidence / originating requirement:** docs/PRD.md (AC-01–07); SECURITY_ASSESSMENT.md.

<a id="b24"></a>
### [ ] B24 — Reconcile current security tests and historical assessment

**Priority:** P0. **Status:** PARTIAL. **Suggested lane:** security/CI. **Assignee:** unassigned.

**Already implemented:** Adversarial runner and expected-failure inventory exist. NET-01 fixed; removed Python launcher probe and dependency setup repaired. Historical counts differ across documents.

**To do:** Rerun on pinned Node 22/Python 3.11, retain fresh evidence, reconcile branch fixes and document every still-expected vulnerability/missing control.

**Acceptance criteria:** Current SHA and exact case inventory accompany results; unexpected failures/passes fail CI; main pushes also run appropriate security checks; no passing mock co-signer is invented.

**Depends on:** Incremental: B16–B18; final: B08/B11/B19/B23.

**Evidence / originating requirement:** security/run.py; security/evidence/results.json; .github/workflows/security.yml; SECURITY_ASSESSMENT.md integration note.

<a id="b25"></a>
### [ ] B25 — Qualify the model and pin demo configuration

**Priority:** P1. **Status:** PARTIAL. **Suggested lane:** W1. **Assignee:** unassigned.

**Already implemented:** Scripted hostile-model tests and opt-in live evals exist. Local Qwen inference is observed; model finance accuracy/tool reliability has not been qualified.

**To do:** Pin model digest/profile, tool schemas and prompt revision for reproducible evals; measure latency and extraction/tool failure rates on actual demo hardware.

**Acceptance criteria:** Demo fixtures and adversarial variants exercised live; failures route safely; rollback documented; no LLM-infallibility claim; do not restore removed legacy model-build tooling by accident.

**Depends on:** B13 or B14; B16.

**Evidence / originating requirement:** services/agent/eval/demo-scenarios.test.ts; scripts/model-smoke-test.ts; docs/open-webui.md.

<a id="b26"></a>
### [ ] B26 — Enforce runtime isolation and secret boundaries

**Priority:** P0. **Status:** NOT VERIFIED. **Suggested lane:** operations/security. **Assignee:** unassigned.

**Already implemented:** Agent environment restrictions and localhost/private binds exist; general WebUI container is not a signing enclave.

**To do:** Deploy separate agent, payment DB, execution signer and policy identities with controlled filesystem/network access and scoped credentials.

**Acceptance criteria:** Agent cannot modify policy/tool code or read DB/keys; owner credentials stay outside inference; verify actual ACLs and network rules; no unauthenticated public Ollama/payment listeners.

**Depends on:** B03, B04, B09.

**Evidence / originating requirement:** AGENTS.md; services/payments/README.md; docs/AUDIT_COLLAB.md (R6).

<a id="b27"></a>
### [ ] B27 — Rehearse backups, incidents and key recovery

**Priority:** P1. **Status:** MISSING. **Suggested lane:** operations. **Assignee:** unassigned.

**Already implemented:** State semantics and recovery obligations are documented, but no complete operational restore/rotation runbook or rehearsal is evidenced.

**To do:** Implement protected backups, restores, signing-outcome reconciliation, alerting, incident containment and key/credential rotation procedures.

**Acceptance criteria:** Restored state cannot double-pay or lose reservations; compromised-agent authority can be revoked; recovery does not expose signer keys or erase audit anchors.

**Depends on:** B09, B11, B19, B26.

**Evidence / originating requirement:** docs/PRD.md §8; docs/FINANCE_TRUST_FRAMEWORK.md §4.

<a id="b28"></a>
### [ ] B28 — Validate and deploy automatic team onboarding

**Priority:** P1. **Status:** NOT VERIFIED. **Suggested lane:** operations/onboarding. **Assignee:** unassigned.

**Already implemented:** Client, strict root sync, revocation and scheduler definitions exist; earlier access was interactive/user-reported.

**To do:** Privately configure preapproved identities and root-owned install; verify one request/invite/login and one revocation; choose one scheduler.

**Acceptance criteria:** No private keys or invite URLs in Git/logs; root code not developer-writable; accepted Tailscale shares separately revoked; record actual deployment verification.

**Depends on:** None; requires authorized administrator.

**Evidence / originating requirement:** docs/onboarding.md; src/w3node/onboarding.py; deploy/w3node-sync.service.

<a id="b29"></a>
### [ ] B29 — Reconcile stale docs, commands and status tables

**Priority:** P1. **Status:** OPEN. **Suggested lane:** documentation. **Assignee:** unassigned.

**Already implemented:** All 21 Markdown files were reviewed. Older status/spec/handoff statements conflict with current source and removed CLI modules.

**To do:** Update current summaries and mark historical notes; repair literal backslash-n table rows, broken links, retired chat commands, tool counts and old security assertions.

**Acceptance criteria:** No active install path references removed chat/model code or .[chat]; mock/backend/branch distinctions clear; markdown links resolve; current status is pinned to evidence.

**Depends on:** Use this review immediately; update again after code tickets.

**Evidence / originating requirement:** docs/PROJECT_STATUS.md; docs/TECHNICAL_SPEC.md; security/README.md; mcp_gateway/README.md; services/payments/README.md.

<a id="b30"></a>
### [ ] B30 — Choose licensing and publish disclosure/threat model

**Priority:** P1. **Status:** DECISION. **Suggested lane:** owner/security. **Assignee:** unassigned.

**Already implemented:** No tracked LICENSE or SECURITY.md; the assessment includes threat assumptions but no standalone maintained deployment threat model.

**To do:** Owner chooses licence and disclosure contact; write concise security scope and trust/dataflow model. Revisit branch-protection policy outside the session exception.

**Acceptance criteria:** No invented licensing/contact details; Testnet-only assessment scope and issue route clear; repo settings require explicit owner decision and are not silently changed.

**Depends on:** Owner decisions.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (R1/R4/R5); SECURITY_ASSESSMENT.md.

<a id="b31"></a>
### [ ] B31 — Confirm operating model and regulatory responsibilities

**Priority:** P2. **Status:** DECISION. **Suggested lane:** business/legal. **Assignee:** unassigned.

**Already implemented:** Finance framework contains scoped research and a proposed licensed-partner model; no named partner or legal authorization is evidenced.

**To do:** Obtain activity/corridor/custody-specific counsel assessment and allocate operator/partner duties before any real-value release.

**Acceptance criteria:** Written scope and responsibility map; current licensing/AML/Travel Rule/exchange-control obligations independently verified; drafts not encoded as law; no compliance claims from a demo.

**Depends on:** Custody decision B10; production-only release gate.

**Evidence / originating requirement:** docs/FINANCE_TRUST_FRAMEWORK.md §1; docs/AUDIT_COLLAB.md (L1/L2/L3/L6/L8).

<a id="b32"></a>
### [ ] B32 — Implement scoped eligibility evidence when required

**Priority:** P2. **Status:** PROPOSED. **Suggested lane:** W2/W4/compliance. **Assignee:** unassigned.

**Already implemented:** allow/block/review/unavailable is a proposal in the framework, not a shared implemented API.

**To do:** Agree evidence provenance, identity, ruleset version, expiry/re-screening and privacy-safe reviewer workflow; bind applicable decisions at signing.

**Acceptance criteria:** Missing/stale/ambiguous evidence cannot allow; model compliant flags cannot authorize; owner approval cannot override legal prohibitions; no religious inference from names.

**Depends on:** B05, B08, B31; B33 if offering that profile.

**Evidence / originating requirement:** docs/FINANCE_TRUST_FRAMEWORK.md §§1/3/4.

<a id="b33"></a>
### [ ] B33 — Review Islamic-finance profile and asset/agency terms

**Priority:** P2. **Status:** DECISION. **Suggested lane:** owner/qualified Sharia reviewer. **Assignee:** unassigned.

**Already implemented:** AAOIFI/IFSB-informed policy research and supporting statement exist; Wakalah and RLUSD acceptability are not approved.

**To do:** Obtain scoped qualified review of agency contract, asset/reserves/redemption, fees, activity exclusions, exceptions and governance.

**Acceptance criteria:** Reviewer scope/conditions/versions/effective dates retained; financing/yield remains outside payment MVP; no halal or Sharia-approval claim without that evidence.

**Depends on:** B31; no external approval needed merely to run a labelled Testnet prototype.

**Evidence / originating requirement:** docs/FINANCE_TRUST_FRAMEWORK.md §2; docs/SUPPORTING_STATEMENT.md.

<a id="b34"></a>
### [ ] B34 — Implement privacy, retention and protected records

**Priority:** P2. **Status:** MISSING. **Suggested lane:** W4/privacy/legal. **Assignee:** unassigned.

**Already implemented:** Off-chain minimisation and legal-retention questions are documented; no operational retention/access/export programme is evidenced.

**To do:** Inventory data, identify processing roles/bases, define reviewed retention classes/legal holds and implement protected access/deletion/export controls.

**Acceptance criteria:** Identity/Travel Rule/private invoices stay off public chain and model context; access/deletion/restore tested; low-entropy hashes not assumed anonymous; retention not a universal guessed duration.

**Depends on:** B03, B31.

**Evidence / originating requirement:** docs/FINANCE_TRUST_FRAMEWORK.md §§1/4; docs/AUDIT_COLLAB.md (L4).

<a id="b35"></a>
### [ ] B35 — Monitor inbound, out-of-band and issuer-control events

**Priority:** P2. **Status:** PROPOSED. **Suggested lane:** W3/W4. **Assignee:** unassigned.

**Already implemented:** Outgoing coordinator audit exists; issuer freeze/clawback risks are documented, not monitored.

**To do:** Add resumable validated-ledger monitoring and owner-facing risk/event records for incoming/outside-path transactions and asset restrictions.

**Acceptance criteria:** Checkpoint/reconnect without duplicate events; past settlement not rewritten after later issuer action; owner can distinguish settlement from continuing redemption/freeze risk.

**Depends on:** B11, B12.

**Evidence / originating requirement:** docs/FINANCE_TRUST_FRAMEWORK.md §2; docs/AUDIT_COLLAB.md (X7/L9).

<a id="b36"></a>
### [ ] B36 — Add supplier key-continuity after identity verification

**Priority:** P2. **Status:** PROPOSED. **Suggested lane:** W2/W4/W5. **Assignee:** unassigned.

**Already implemented:** Feature A is a corrected proposal; no signed-change or credential implementation exists.

**To do:** If selected, bind old/new wallet/tag, business/network, nonce, expiry and approval version to supplier-signed changes with independent recovery.

**Acceptance criteria:** Replay/cross-business/stale changes rejected; stolen keys and bad initial onboarding remain explicit risks; optional XRPL Credentials/DepositAuth not misrepresented as payer policy.

**Depends on:** B05, B08, B12.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (Feature A and corrections); docs/FINANCE_TRUST_FRAMEWORK.md §4.

<a id="b37"></a>
### [ ] B37 — Validate target customer, submission requirements and business model

**Priority:** P1. **Status:** DECISION. **Suggested lane:** owner/product. **Assignee:** unassigned.

**Already implemented:** Small-importer SME is a working persona; customer demand, price, final branding, official judging rubric/deadline are not established in docs.

**To do:** Confirm primary buyer/use case and conduct interviews; record official competition deliverables/deadline; define measurable pilot/pricing hypotheses.

**Acceptance criteria:** Sourced requirements and owner decisions, no invented rubric/date/traction; optional features do not displace independently enforced Testnet MVP.

**Depends on:** None.

**Evidence / originating requirement:** docs/PRD.md §§1/10/11; docs/AUDIT_COLLAB.md (Q5).

<a id="b38"></a>
### [ ] B38 — Evaluate two-owner mandate changes

**Priority:** P2. **Status:** PROPOSED. **Suggested lane:** W4/W5. **Assignee:** unassigned.

**Already implemented:** Feature D is an alternate proposal, not a selected MVP requirement.

**To do:** If selected, add separately authenticated threshold approval for recipient/cap changes plus recovery.

**Acceptance criteria:** One phished owner session cannot approve its own second vote; approvals bind exact versioned change; otherwise explicitly defer this proposal.

**Depends on:** B04, B06, B12; owner scope decision.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md §4 (Feature D).

<a id="b39"></a>
### [ ] B39 — Evaluate contractual early-payment discounts

**Priority:** P2. **Status:** PROPOSED. **Suggested lane:** product/W2/W3. **Assignee:** unassigned.

**Already implemented:** Feature E is a proposal; no invoice-term or discount engine is implemented.

**To do:** If selected, parse verified terms and calculate exact discount with owner mandate and budget checks; obtain relevant contract/Sharia review.

**Acceptance criteria:** No fabricated discount terms or extra authority; precise deadline/amount handling; otherwise defer beyond MVP.

**Depends on:** B02, B08, B11; B33 if applicable.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md §4 (Feature E).

<a id="b40"></a>
### [ ] B40 — Benchmark and checkpoint audit verification

**Priority:** P2. **Status:** OPEN. **Suggested lane:** W4/performance. **Assignee:** unassigned.

**Already implemented:** pay() verifies the full chain on each request; scale impact has not been benchmarked.

**To do:** Measure bounded local workloads and design verified checkpoints without allowing rollback or omitting chain validation.

**Acceptance criteria:** Publish reproducible latency/size results; checkpoint tampering remains blocked; no load against public XRPL or other infrastructure.

**Depends on:** B19.

**Evidence / originating requirement:** docs/AUDIT_COLLAB.md (P3); services/payments/src/payment.ts.

## Recommended execution order

1. **Clarify interfaces and authority:** B01/B10; B16/B17/B18 can proceed independently as security fixes.
2. **Make the requested repo tools usable in a labelled local demo:** B13/B14/B15 with the existing T15 mock. Do not present its hashes or responses as ledger settlement.
3. **Build the real non-model vertical slice:** B02/B03/B04/B05/B06 plus B07/B08/B09/B11. The co-signer approves final transaction bytes; signatures and uncertain outcomes have durable identity.
4. **Add owner flow and scheduling:** B12/B21; define B20 budget-period semantics explicitly.
5. **Prove release behavior:** B22/B23/B24/B25 with B26 isolation and B27 recovery. Independently anchored audit is B19; its absence must remain disclosed until implemented.
6. **Address deployment and commercial readiness:** B28/B29/B30/B37. B31–B36/B38–B40 are scoped legal/operational/enhancement gates, not automatic hackathon feature commitments.

No personal workstream owner or deadline is inferred. The official rubric and
submission requirements still need B37 confirmation.

## Branch work checked separately

| Branch / inspected head | Observed work | Consequence for backlog |
|---|---|---|
| `fix/t06b-grounding-supplier-and-line-items@a86e00ef6925dd74a77d7ea4ea8b9bf33ce83e13` | Supplier sender/layout grounding and text line-item checks differ from main. | B16 is branch work, not greenfield work and not done on main. Review `wip/t06b-review-fixes@1c69c12` too before integration. |
| `fix/t07-planner-input-minimisation@e0e84d2189fd49ffcf00e630db4ba4bc55f5af75` | Typed PlannerView removes descriptions/suspicious text; main also contains PlannerView. | D03 is implemented on main; a remaining named branch alone is not an open ticket. |
| `wip/t08-review-fixes@3350d7b2ed6f97dfac914c4126d57543c3a89f4e` | Branch head fetched; main chat guards inspected, full branch review not performed. | D03 covers main behavior; do not imply all review comments or unpublished branch work are accepted. |
| `feat/testnet@5c120b292118a41dc2eab27b744f5360ea658e71` | Fresh wallets, faucet funding, 1-XRP submit-and-wait and exact validated delivery checker. | B22 reuses it after review; no live run was performed, and XRP smoke is not RLUSD/co-signer evidence. |

Scope of “all Markdown”: all tracked Markdown on the pinned default branch,
not every historical revision or every file on every remote branch. Selected
branch source above was additionally inspected to avoid duplicate implementation.

## Documentation conflicts to resolve (B29)

| Document / claim | Source-grounded correction |
|---|---|
| PROJECT_STATUS baseline inventory says payment/backend services only have contracts | Transfer SQLite core and T15 mock now exist. They still do not make a real backend or live signer. |
| PRD/spec/status describe `w3node chat`, model setup/build, locks and removed local-MCP guide | Main removed those Python modules and `.[chat]` extra. Open WebUI is the replacement; update active instructions without restoring retired code. |
| MCP README begins “Five tools” | server.py registers seven; transfers.py intentionally exposes only two. |
| Historical GAP-02/GAP-04 and A3 remain broadly open | Supplier approval carries invoiceNumber; exact cents, redirect refusal, timeouts and bounded bodies are implemented. Remaining uncertain-outcome/idempotency and integration semantics still need review. |
| Red-team pack calls supplier/line-item grounding gaps | Those gaps remain on main; there is an unintegrated T06b branch. Do not mark fixed from the branch alone. |
| Security assessment counts and V-05 | Historical baseline retained; redirect is fixed on main, Python-launcher code/probe removed. Recompute B24 counts rather than copying old 79/43/11/25 assertions. |
| security README installs `.[chat]`; payment README ends with retired `w3node chat` | Follow current Python gateway requirements and build the HTTP bridge; executable setup instructions must match current pyproject/source. |
| Shared README says memos anchor each payment | Helpers exist; actual memo construction, submission and independent anchor verification remain B07/B19. |
| Onboarding intro still says CLI not on main | CLI exists; live administrator deployment still needs B28 evidence. |
| Some status rows contain literal backslash-n | Repair Markdown structure without losing historical evidence labels. |

## Requirement coverage map

| PRD requirement | Existing slice / remaining tickets |
|---|---|
| FR-01 auth / FR-12 revocation | D04/D05/D09; B04/B08/B10/B26 |
| FR-02 suppliers / FR-11 exceptions | D02/D06; B05/B06/B12 |
| FR-03 extraction / FR-04 untrusted content | D02/D03/D07; B02/B16/B17/B25 |
| FR-05 authoritative policy / FR-09 signing / FR-10 asset | D09 has only coordinator-level checks; B07/B08/B09/B10/B11/B22 |
| FR-06 strict schemas / FR-16 deterministic reporting | D01/D02/D04/D05; B01/B13/B14 for integration |
| FR-07 caps/budget / FR-08 durable deduplication | D09 for manual transfer intents, D06 for mock only; B02/B03/B08/B11/B20 |
| FR-13 reconciliation / FR-14 audit | D01/D09; B07/B11/B19/B27 |
| FR-15 owner UI | B04/B05/B06/B12 |
| FR-17 demonstration | D07/D10; B15/B22/B23/B24/B25 |
| FR-18 developer reproducibility | D11/D12; B13/B14/B15/B25/B28/B29 |
| FR-19 context | D13; B29 |
| FR-20 transfers / FR-21 schedule / FR-22 lockout | D09; B03/B04/B07/B08/B09/B11/B12/B21/B26 |

Audit coverage: R2→B18; R1/R4/R5→B30 (R4 configuration hardening also B26/B28);
R6→B09/B26; R3's transitive dependency-script assertion was refuted for pinned
pnpm 10, so do not reopen that defect merely from old prose. A1→B17; A2→B01/B11;
A3→D04 plus B01/B24 for remaining contract/evidence; A4→B05/B06; A5→D01/D04;
A6→B19. X1–X6→B07–B11/B22/B23, X7→B35, X8→B08/B11/B21.
P1/P4→B07/B08/B09/B11; P2→B02; P3→B40. L1–L9 research exists in D13;
operational/specialist work is B31–B35. Features A/B/C/D/E map to B36/B19/B20/B38/B39.

## Markdown review register

Every file below was read in full at the pinned main revision. This register is
coverage evidence, not a statement that every assertion in a file is current.
Source inspection resolves conflicts; test execution/deployment were not part
of this review. Line counts refer to the reviewed files before adding this backlog.

| Markdown file | Lines | Main purpose / tickets |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | 88 | Authority boundaries and evidence rules; all tickets |
| [README.md](../README.md) | 48 | Current WebUI entry point and separation from finance; B13/B14/B29 |
| [SECURITY_ASSESSMENT.md](../SECURITY_ASSESSMENT.md) | 440 | Historical vulnerabilities and integration update; B07–B11/B16–B19/B24/B26 |
| [SESSION_START.md](../SESSION_START.md) | 34 | Session continuity; D13/B29 |
| [docs/AUDIT_COLLAB.md](../docs/AUDIT_COLLAB.md) | 509 | R/X/A/P/L findings and feature proposals; coverage map above |
| [docs/FINANCE_TRUST_FRAMEWORK.md](../docs/FINANCE_TRUST_FRAMEWORK.md) | 262 | Governance, regulatory/Sharia scope and release evidence; B09/B10/B26/B31–B36 |
| [docs/PRD.md](../docs/PRD.md) | 238 | FR-01–22, AC-01–07, product gates; all core tickets |
| [docs/PROJECT_STATUS.md](../docs/PROJECT_STATUS.md) | 224 | Historical status and newer updates; B24/B29 |
| [docs/SUPPORTING_STATEMENT.md](../docs/SUPPORTING_STATEMENT.md) | 15 | Scoped design rationale; B23/B31/B33 |
| [docs/TEAM_HANDOFF.md](../docs/TEAM_HANDOFF.md) | 92 | Collaboration, direct-push instructions and old branch references; B01/B10/B29 |
| [docs/TECHNICAL_SPEC.md](../docs/TECHNICAL_SPEC.md) | 260 | Contract/authority/state-machine target; B01–B11/B19/B29 |
| [docs/onboarding.md](../docs/onboarding.md) | 226 | Individual access and root sync; D11/B28 |
| [docs/open-webui.md](../docs/open-webui.md) | 105 | Model workspace and absent tool hookup; D12/B13/B14/B15 |
| [docs/team-workflow.md](../docs/team-workflow.md) | 88 | Team permissions and retired model workflow; B26/B28/B29 |
| [fixtures/red-team/README.md](../fixtures/red-team/README.md) | 64 | Attack replay/expected gaps; D07/B16/B20/B23 |
| [mcp_gateway/README.md](../mcp_gateway/README.md) | 71 | Stdio backend routes and setup; D08/B01/B13/B29 |
| [packages/shared/README.md](../packages/shared/README.md) | 85 | Schemas, money, log contracts; D01/B01/B07/B19 |
| [security/README.md](../security/README.md) | 63 | Expected-failure runner and evidence limits; D10/B24/B29 |
| [services/agent/TESTING.md](../services/agent/TESTING.md) | 19 | Agent/HTTP boundary tests; D02–D05/B16/B17/B25 |
| [services/mock-backend/README.md](../services/mock-backend/README.md) | 37 | Explicit simulation and fake state; D06/B03/B15 |
| [services/payments/README.md](../services/payments/README.md) | 179 | Coordinator and missing adapters/deployment; D09/B03/B07–B11/B19/B21 |
