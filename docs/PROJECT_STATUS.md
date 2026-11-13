> **Branch-wide baseline review, 13 November 2026:** [Assigned Kanban](BASELINE_KANBAN.md) and [progress/evidence](BASELINE_PROGRESS.md) cover all 31 remote heads, including Cameron’s latest `feat/testnet` uploads. Scheduling and ledger history are now baseline; browser extensions are deferred. Review is pinned to `main@47b6c55`; historical results below were not rerun for this documentation assessment.

# Shucamoxa implementation status and handoff

> **Implementation review, 13 November 2026:** See [the current ticket backlog](IMPLEMENTATION_BACKLOG.md) for a source-checked inventory at `47b6c55`. It covers all 21 Markdown files, 13 completed implementation slices and 40 remaining tickets. Older sections below are historical snapshots and contain retired commands; they are not a current deployment inventory. No runtime or ledger tests were run for this documentation review.

Updated: 13 November 2026 (Africa/Johannesburg).
Source-inspection baseline commit: `c808928f075f5bc50c737924f3c480a9f56dd73b`.
This snapshot records evidence available while writing the PRD. It is not live
monitoring, a backlog completion claim or a replacement for inspecting current
source/tests. See [PRD](PRD.md) and [technical specification](TECHNICAL_SPEC.md).

## Status labels

- **Source present:** implementation/schema exists; operation is not necessarily verified.
- **Simulated test evidence:** exercised against scripted models/fake APIs or fixture data.
- **User-reported live:** supplied terminal output shows the action in the user's environment.
- **Not evidenced:** no sufficient source/deployment proof in the inspected repository/session.
- **Proposed:** a decision or target requirement, not an installed capability.

## Current inventory

| Component | Evidence / status | What this does not establish |
|---|---|---|
| Shared contracts | Source present in `packages/shared/src/`; schema, money, constants and log helper tests present. Current name is `@shucamoxa/shared`. | Deployed services actually validate every response or implement every declared rule. |
| TypeScript invoice agent | Source present in `services/agent/src/`; extraction/planning and six guarded tools; scripted-model/fake-backend tests. | Live autonomous XRPL payment or a compatible deployed backend. |
| Legacy local terminal/MCP host | Removed on the Open WebUI feature branch. | Open WebUI is a UI, not a verified live model or payment runtime. |\n| Shared model instance | User-reported live SSH as `xhanti`, workspace write test and Ollama `/api/tags` listing `qwen3:1.7b-q4_K_M`. Earlier supplied output also shows a generated model response. | A live payment system, strong service isolation, current uptime or automatic team onboarding deployment. |
| Legacy Qwen profiles/import | Removed on the Open WebUI feature branch. | No weights are bundled; users choose their own model. |\n| Legacy model artifact manifest | Removed on the Open WebUI feature branch. | Does not delete models cached on team devices. |\n| Team onboarding | Client requests and bounded root sync/timer/cron definitions in source. Xhanti account/access configured interactively in supplied output. | Server sync installed/enabled with verified credentials, preapproved identities and working automatic invitations. |
| Python payment MCP gateway | Source present in `mcp_gateway/`; seven tools and simulated backend tests. New transfer tools use a separate coordinator API. | Compatible real backend, live payment integration or policies enforced merely by tool annotations. |
| Independent policy/signing service (W2) | `CosignRequest`/`CosignResponse`, rule codes and target invariants present as shared contracts. | A deployed co-signer or ledger configuration making its approval mandatory. |
| Payment service / XRPL execution (W3) | Shared contracts and target constants exist. | Live signer, durable operation store, submit/reconcile implementation or final Testnet settlement proof. |
| Backend/auth/audit service (W4) | Client expectations, schema/log primitives and fake backend tests exist. | Running authenticated owner/agent APIs, atomic reservations or durable audit persistence. |
| Owner control surface (W5) | Required in PRD. | Implemented owner dashboard, settings/approval UI or deployed web app. |
| Privy / Ghostsig / OWS | Workshop resources and public documentation were reviewed; Privy considered as candidate. | Vendor accounts, installed integrations, configured policies, raw signing authority or confirmed signer decision. |

No release claim should be based only on an enum, comment, mock response, older
test count or earlier assistant statement. Run the current checks and record the
actual commit and results when working on the relevant area.

### Developer XRP demonstration (13 November 2026)

Working tree based on `cb3b4bd`: `services/backend` adds an isolated single-signature
Testnet XRP demonstration with temporary wallets and validated-result checks.
This is not an RLUSD or agent payment and does not satisfy AC-01 or GAP-05/06.
The confirmation predicate has simulated tests. A live Testnet run validated
`tesSUCCESS` for 1 XRP, with matching sender, recipient and delivered amount:
transaction hash `C965811C463F2E5E019A4EA379F4A1F61E0F4544431F001FF5A31BFA34AD2E8E`.
An earlier validated payment exposed the API's `DeliverMax` field and the demo
correctly refused to claim success until the check was updated. Typecheck and
391 shared/agent/backend tests passed on Node 24; 24 tests were skipped. The full
suite failed 46 script tests on Windows, including missing `sh` on PATH and
POSIX file-mode assumptions; the tracked-path guard passed using Git's shell. Next:
implement durable reconciliation and the independently enforced policy/signing
boundary before connecting a product payment flow.

## Known integration gaps at this baseline

| ID | Gap | Required next action |
|---|---|---|
| GAP-01 | TypeScript agent uses `/rules`, `/suppliers`, `/payments`, `/approvals`, `/log`. Python gateway expects a separate `/v1` stored-invoice API and different statuses. | Agree adapter/migration and tests; preserve shared contracts as the primary internal baseline until an explicit change. |
| GAP-02 | Shared `SupplierApprovalPayload` requires `invoiceNumber`, but current agent `propose_supplier` tool's schema/payload does not provide it. | Align producer with the shared contract and add a consumer-boundary integration test. |
| GAP-03 | Agent uses a local minimal rules parser and partial supplier-match check rather than fully validating shared `Rules`/`SupplierLookup`. | Validate shared boundary schemas/redaction; test malformed replies and accidental address fields. |
| GAP-04 | Agent amount comparison code still uses local `Number`/cents logic while the shared package provides exact `bigint` helpers. | Adopt shared helpers and test equivalent decimal representations/boundary amounts before financial integration. |
| GAP-05 | No authoritative backend/policy/payment vertical slice is evidenced in the source tree. | Build and test authenticated/durable services before claiming end-to-end payment behavior. |
| GAP-06 | Signing topology/vendor selection is not finalized or verified on ledger. | Document keys/roles/thresholds, revocation/recovery and how direct bypass is prevented; then implement/Testnet-test it. |
| GAP-07 | Reservation TTL is a constant, not an implemented reconciliation algorithm. | Specify durable operation states and ledger-aware release rules; never free uncertain funds just on elapsed time. |
| GAP-08 | A public onboarding request already exists in the repo. Its presence is not evidence of instance authorization. | Check private server policy/state and actual user/key ownership; never authorize someone from a merged JSON file alone. |
| GAP-09 | Session context did not have a single tracked product/spec baseline. | This documentation adds it; keep it updated with implemented changes and evidence. |

These are observed mismatches or missing evidence, not code fixes performed by
this documentation change. Reinspect before fixing: another workstream may have
changed them since the baseline commit.

## Next milestones in dependency order

1. **Contract and authority checkpoint:** confirm product/name/customer baseline,
   align the two payment APIs, resolve GAP-02 through GAP-04, and decide the
   mandatory independent signing topology. Do not weaken policy to speed up a demo.
2. **Non-model vertical slice:** authenticated backend, trusted supplier/payable
   records, durable idempotency/reservations, independent policy, signer and ledger
   reconciliation. Demonstrate deterministic success/refusal without relying on
   a model prompt as enforcement.
3. **Agent integration:** connect W1 using the shared schemas. Validate the live
   local-MCP/Qwen developer flow separately from the finance pipeline; attach a
   harmless tool first, then scoped read tools, then test-only payment requests.
4. **Owner flow:** implement mandate management, exception decisions, kill switch
   and evidence inspection in the owner-facing surface.
5. **Release demo:** record PRD AC-01 through AC-07, including one actual validated
   Testnet payment and independently blocked misuse/duplicate/revocation cases.

The team has not committed dates, individual assignees or a production launch in
this file. W1-W5 are responsibility boundaries, not guesses about who has access.

## Existing developer commands

From a local checkout, see `README.md` for Node/pnpm and
`docs/local-mcp-chat.md` for Python/SDK installation. Typical checks:

```bash
pnpm typecheck
pnpm test
python -m unittest discover -s tests -v
python -m unittest discover -s mcp_gateway -p 'test_*.py' -v
sh scripts/check-tracked-paths.sh
```

Local development: install/start Ollama on the developer computer, then run
`w3node model setup` and `w3node chat` in the checkout/activated venv. Default
MCP has zero tools; `w3node chat --mcp config/mcp.demo.json` opts into echo.
The shared option requires `w3node users connect YOUR_USERNAME` in another
terminal and explicit `--host http://127.0.0.1:11435`. Local stdio MCP needs no
forwarded port.

Commands assume installed tooling and already-authorized access; they do not
grant privileges or install server automation by themselves. Check current docs
for actual arguments. Never copy a teammate's private SSH key.

## Handoff update format

When a task changes product behavior, interfaces or readiness, update the relevant
row/gap above and add a concise entry containing:

- Date and inspected/changed commit or PR.
- Requirement/gap IDs and concrete behavior changed.
- Relevant source paths.
- Validation performed and its evidence level (simulated/local process/live model/
  validated ledger), including any important failures or checks not run.
- Remaining blockers and the next independently actionable task.

Do not append chat transcripts, private invoice contents, credentials or people's
private account details. Keep this file a current summary rather than a growing
dump of every session. A fresh LLM must inspect the current task's source/tests
and report uncertainty instead of treating this dated snapshot as live truth.


## 13 November 2026: local inference workflow

FR-18: CLI chat/build/setup now default to local Ollama 11434; the TypeScript
agent example uses the local `/v1` endpoint. The shared server is an explicit
11435 tunnel option. New `model_setup.py` downloads missing base models, reuses
matching cache and verifies the manifest against `base-model.lock.json`, whose
initial digest is from owner-supplied server output. Profiles and MCP source
remain in Git; large weights remain in Ollama/artifact storage. This is inference
and model import tooling, not training, automatic deployment or streaming output.

Validation: Python tests cover endpoint precedence, cache reuse, streamed pull
flow, digest mismatch and failed/incomplete downloads using scripted Ollama APIs;
existing tests exercise actual local MCP subprocess discovery/echo. Owner output
now confirms a successful local pull and matching digest, followed by zero-tool
MCP discovery. The first live chat failed with a wrapped ExceptionGroup; its
underlying cause is not yet established. The CLI now unwraps nested SDK task
groups to report bounded Ollama HTTP errors, timeout and connection failures.
Regression tests simulate those failures; no successful local inference or
benchmark is claimed. Next: owner pulls this fix, reruns chat and shares the
specific error if it fails; compare `--no-mcp` and direct Ollama inference.

## 13 November 2026: deterministic pay implementation

FR-20/21/22 and part of GAP-05: `services/payments/src/payment.ts` adds a durable
SQLite transfer coordinator; `http.ts` fixes identity/scope from private server
credentials. `packages/shared/src/transfers.ts` defines new strict contracts,
without silently replacing invoice APIs. MCP adds `pay` and transfer status.
The agent references a separately owner-authorized stored intent, not arbitrary
addresses/amounts. Owner-specific caps, cumulative budgets, persistent reservation
and deduplication, due execution, credential lockout, audit and reconciliation
are implemented and covered by simulated tests. No live signer is bundled.

Tests use temporary SQLite, fake policy/ledger adapters and a real local HTTP
listener. Existing shared/agent and Python tooling tests are checked separately.
This is not evidence of real blockchain settlement, incoming-wallet monitoring,
contact identity verification, legal compliance or OS isolation deployment.
Remaining: friend-owned wallet adapter, mandatory independent policy/signing
verification, trusted owner UI/backend, ledger recovery/anchors and timer
deployment. The existing invoice agent and `/v1` gateway routes still require
explicit integration; the new coordinator does not implement those routes.

Validation for the transfer change: 486 TypeScript tests passed, 24 optional live
evaluations skipped; typecheck passed. The new transfer project contributes 21
tests. Python CLI tests: 47 passed; MCP gateway tests: 10 passed, including a
real strict transfer MCP subprocess against a scripted HTTP backend. Local
installation reported the existing lockfile `ws@8.23.0` minimum-release-age
policy; installed compiler/test binaries were used without changing dependencies
or relaxing that policy. GitHub CI remains the clean-install verification.

## 13 November 2026: finance/Islamic-finance/AI governance research

`FINANCE_TRUST_FRAMEWORK.md` maps international standards, South African
regulatory questions, AAOIFI/IFSB governance and AI assurance to proposed controls
and release evidence. `SUPPORTING_STATEMENT.md` gives the short design rationale.
`TEAM_HANDOFF.md` records the owner's direct-push collaboration instruction and
integration work for the next contributor; no separate Claude-session message
has been received by Codex. Claude-coauthored main commit `3d2acce` was
observed and preserved as the parent baseline; it concerns agent environment
hardening. AGENTS/session guidance links these documents.

Evidence: official-source research and document/link review only; no runtime
behaviour, signing authority, regulatory status or Sharia approval changed.
SARB cross-border proposals remain labelled as drafts in the reviewed sources;
current legal applicability and final instruments require specialist verification.
RLUSD Sharia approval and legal compliance have not been established. At the
research baseline main lacked services/payments; transfer work remained on its
feature branch. Inspect current refs before implementation. Next: agree the
signer/identity/eligibility evidence interfaces and obtain qualified, scoped
legal/Sharia review before production claims or real-value operation.

## 13 November 2026: response to Claude's shared audit

Inspected `main@f780cb2` and the deterministic-transfer branch's integration
guide, and replied to Q1-Q8 in `AUDIT_COLLAB.md`. This supersedes the earlier
research entry's statement that no separate Claude message had been received.
Expanded the finance framework with proposed partner responsibilities, OWASP
LLM01/LLM06, ASVS and CCSS verification targets, scoped SCA case summaries,
issuer/reserve risks and feature tradeoffs. The supporting statement remains
design language, not evidence of controls deployed outside the model.

Evidence: official-source research and documentation checks only; no runtime
code, deployment settings, regulator decisions or Sharia approvals changed.
Main's inspected tree lacks `services/payments/`; its implementation remains
on `feat/deterministic-pay-tool` with abstract policy/wallet adapters. SQLite is
that branch's local coordinator choice, not a confirmed multi-host backend.
No universal 4xx no-submission guarantee, final signer topology, competition
deadline or rubric weights have been verified. Next: integrate and independently
verify the Testnet policy/signing/payment path, preserving each contract's exact
authority and recovery semantics; keep high-severity audit findings open.

## Open WebUI replacement (feature branch, 13 November 2026)

Compose configuration, install guide, and removal of the Python chat/model experiment are source changes only. The UI has **not** been proven running on the user's PC. The finance TypeScript agent remains separate and requires an OpenAI-compatible upstream model and an authorized backend. Existing payment gateway API mismatch remains unresolved; no payment MCP tools are auto-registered.

## 13 November 2026: adversarial-suite merge repair

PR #20 integration exposed an obsolete NET-01 expected-vulnerability marker after
T10 disabled redirects. Updated it to a blocked regression with a positive check
that POST /payments reached the redirecting server and no request reached the
capture server. Generated reports now identify the checked-out commit; the
original assessment snapshot remains explicitly historical.

Local validation: security and root typechecks passed; 1195 regular TypeScript
tests passed, 39 skipped; 47 Python CLI tests and 10 MCP tests passed. Full
adversarial runner passed: 43 BLOCKED, 11 VULNERABLE, 25 NOT_IMPLEMENTED, with
expected-failure semantics preserved, checksum-pinned gitleaks clean, and zero
validated ledger transactions. Local runtime was Node 24/Python 3.12; repository
Node 22/Python 3.11 verification remains the GitHub CI gate. No financial control
was weakened or new live payment claimed.

## PR #22 conflict and security-check repair (13 November 2026)

Merged current main (`3bb1abd`) into the Testnet demo branch, preserving both
README sections: developer XRP demo and the assigned baseline plan. The original
four demo/handoff commits remain in history.

Both failing checks traced to the same full-history gitleaks finding in
`da40269:docs/PROJECT_STATUS.md:43`: a public transaction identifier, not a key.
A read-only query to the fixed public XRPL Testnet endpoint independently confirmed
that recorded hash as a validated `Payment`, `tesSUCCESS`, with
`delivered_amount = 1000000` drops (1 XRP). No transaction was submitted for this
repair. `.gitleaksignore` excludes only the exact historical commit/file/rule/line
fingerprint; scanner rules and full-history coverage are unchanged. This does
not fix or conceal the separately documented R2 hash-label bypass.

Local checks on Node 24/Python 3.12: root and security typechecks passed;
1,414 regular TypeScript tests passed, 39 skipped. Full adversarial runner passed:
44 BLOCKED, 9 VULNERABLE, 25 NOT_IMPLEMENTED. The latter two remain expected
failures, not successful security controls. Gitleaks 8.30.1 (checksum verified)
scanned the complete merged history clean. Removing the exception reproduced
exactly the known finding; new raw-key/seed canaries and that same public value
outside the historical fingerprint were still detected. Tracked-path and
whitespace checks passed. Node 22/Python 3.11 results are the GitHub CI gate.

## 13 November 2026: issues #30–#33 local integration snapshot

On `work/payment-issues-30-33`, #30 added cap, reservation, policy-edit,
kill-switch and rejection regression checks; #31 added signed permit/guard
source; #33 added a weekly category budget coordinator; #32 added a restricted
x402 purchase prototype. See `HANDOFF_ISSUE30.md` through
`HANDOFF_ISSUE33.md` and `IMPLEMENTATION_BACKLOG.md`.

Local Node 22.23.5/pnpm 10.28.0 typecheck and 66 payment tests passed.
These tests use fake wallet, ledger, quote, merchant and outcome adapters.
The earlier full TypeScript suite had two unchanged `ownerChat` test failures
(1,416 passed; 39 skipped). No validated Testnet transaction, paid resource
access, deployed independent signer, live FX feed or facilitator integration
was observed. The x402 purchase and budget services use separate SQLite
transactions; retry detects existing budget state and refuses a second execution,
but orphan-reservation reconciliation remains unresolved. Existing
transfer cumulative budget is not yet bound to x402 execution. Keep #31–#33
open for the stated end-to-end evidence.

Issue #30 verification was rerun on `c9d415b`: `pnpm typecheck` and all 67
payment-project tests passed with loopback access. This completes the source,
simulated-test and shared-handoff scope of #30. It does not establish deployed
limits or validated Testnet payment; those remain #31 integration gates.

## 13 November 2026: direct #32/#33 implementation update

The x402 work now includes a pinned-origin HTTPS merchant transport for 402
challenge retrieval and bounded article delivery. Owner category period edits
retain settled spending in the newly selected current period. Typecheck and 70
payment-project tests passed locally with scripted merchant, quote, wallet and
ledger responses. This is not actual x402 payment integration: a live signed
payload, verified facilitator/ledger settlement, trusted quote source and real
paid-resource access remain with the wallet and deployment integration.

## PR #34 merge repair (13 November 2026)

Integrated main into the payment issues branch. Preserved the complete pinned
B01–B40 backlog alongside the newer #30–#33 payment update, and retained both
branches' status evidence. Fixed two integration typecheck errors: removed an
unused test import of a retired supplier helper and explicitly narrowed the
policy bearer-token regex capture before hashing. Authorization remains fail-closed.

Validation on Node 24.22.1 with pinned pnpm 10.28.0: frozen-lockfile install,
root typecheck and full regular suite passed (1,545 tests passed, 39 skipped).
Tracked-path guard and conflict-file whitespace checks passed. No live payment,
merchant unlock, deployed signer or FX integration was tested; Node 22 CI remains
the repository-runtime gate. No new completion claim for #31–#33 is implied.

## Issues #31–#33: guarded provider and purchase-host integration

13 November 2026. `PAYMENT_INTEGRATION.md` is the current operator/AI handoff.
The new Testnet transfer provider verifies independent Ed25519 permits, signs
under the coordinator's final revocation DB gate, persists one transaction
identity and verifies signed bytes/delivered amount on ledger lookup. The x402
executor constructs a v2 presigned RLUSD payload, independently revalidates the
registered merchant, checks periodic and aggregate purchase-wallet budgets,
and exposes content only after exact ledger evidence. The private host and
strict purchase/read/reconcile MCP tools keep owner policy, URLs, quotes and
wallet keys out of tool arguments. Purchase wallets are separate from transfer
treasuries; neither contract silently replaces the other.

Recovery now persists the purchase binding and execution claim before budget
adapter commits. Durable signer tombstones close a proven no-sign purchase;
unknown signed outcomes remain reserved without re-signing. Confirmed ledger
rejections retain converted payer-fee charges. Owner-signed short-lived quote
packets bind rate and fee ceilings; there is no automatic market feed. Added
private-file checks, deployment unit and configuration examples are source, not
proof that isolation is installed on the operator's machine. Privy is unchanged.

Validation: Node 22.23.5/pnpm 10.28.0 root typecheck and regular tests; Python
3.12 gateway and onboarding tests; full adversarial reproduction with
checksum-verified gitleaks 8.30.1. The current security probes exercise the actual
merged T20 service instead of claiming it is absent: several unsafe mutations
are accepted by its incomplete default pipeline and remain VULNERABLE. These
adapters do not use that endpoint as their live signing gate. Team T21/T22 and
other newly observed branches are separate work, not silently integrated.

Read-only live checks: the fixed official HTTPS RPC reported XRPL Testnet
network ID 1 and the preflight succeeded; t54's public /supported advertised
v2 exact on xrpl:1. The WebSocket attempt failed, so the new transport uses
fixed HTTPS RPC with bounds and no redirects. No wallet was loaded and no
payment was submitted for these checks. A funded dedicated Testnet payer,
approved compatible HTTPS merchant, deployed isolation and actual paid-resource
allowed/blocked evidence are still needed. Keep #31–#33 open until that evidence
exists. Signed-expiry recovery and final on-ledger/cross-service co-sign topology
remain explicit gates; no Mainnet, real-value or blanket security readiness claim.

Final local evidence for this integration: Node 22.23.5/pnpm 10.28.0 typecheck
passed; 1,561 regular TypeScript tests passed, 39 skipped. Python 3.12: 25 CLI/
onboarding tests and 11 gateway tests passed (including a real purchase MCP
subprocess). The adversarial runner completed with 53 BLOCKED, 18 VULNERABLE,
7 NOT_IMPLEMENTED; expected vulnerabilities are not security approvals. Both
staged secret scanning and tracked-path/whitespace guards passed. Live validated
payment count for this integration remains zero.

## 13 November 2026: governed harness and WebUI demo

The focused `work/harness-open-webui-demo` branch adds a runnable owner console,
12 strict tools shared by OpenAPI and stdio MCP, mandatory policy/eligibility/audit
gates, owner-registered actions, optional bridge-route simulation and bounded
workflows with durable claims. It integrates payment source `50be2a9` and main
through `ee40fa3`, preserving the team's new invoice payment, policy, treasury,
kill-switch and DB work. The harness adapters explicitly retain the separate
transfer and purchase contracts. See `HARNESS_DEMO.md` for setup.

Validation on Node 22.23.0/pnpm 10.28.0: root typecheck and all 1,803 regular tests
passed after the main integration, including the scanner-fixture regression. Python 3.12: 29 onboarding/setup and
12 gateway tests passed. A real local HTTP host plus actual stdio MCP subprocess
discovered all 12 tools, exercised allowed/duplicate/cap/eligibility outcomes,
completed the university purchase workflow, read its local article and verified
13 harness audit events. Settlement and content were simulated. No ledger node,
merchant, faucet or real model was contacted for that smoke run.

T21 required updated adversarial positive controls, not automatic reclassification
from source names. Actual mutation probes now produce 60 BLOCKED,
11 VULNERABLE and 7 NOT_IMPLEMENTED with a successful evidence runner and
checksum-pinned full-history secret scan. A validly shaped substituted audit memo
still passes the co-signer, so XRPL-12 remains VULNERABLE. Existing deployment,
quorum, key custody, intake and audit-anchor gaps remain open. Narrow scanner
fixture allowances apply only to three known public test hashes and exact files.

The five-slide pitch is complete and explicitly labels simulated settlement.
Docker/WebUI registration, UI browser rendering, model-driven tool use and
installation on the owner's PC were not verified: this build environment has
no Docker daemon or connected owner PC. A remote browser could not reach the
build process's localhost. No public demo deployment or live payment is implied.
Dedicated funded Testnet wallets, compatible approved publisher, reviewed fresh
quote, deployed signing isolation and actual allowed/blocked settlement evidence
remain release gates. Live cross-chain bridging and native browser purchasing
remain further integrations; profile labels do not establish legal compliance.

## Local startup and scenario runner (13 November 2026)

`sh scripts/start-harness-demo.sh` now orchestrates local Docker/Ollama readiness,
Linux loopback networking, admin sign-in/session reuse, scoped tool registration,
model discovery and harmless preload. Admin sessions are 0600 files outside the
harness state mount; no password is retained. Existing tokens, DBs, policies,
chat history, unrelated connections and owner prompts/tools are preserved.
Explicit owner-token rotation is available for an exposed console credential;
it does not reset financial state or expose the replacement token in output.
Fast finance-preset parameters disable thinking and bound generation; no model
or laptop speed benchmark is claimed. See `DEMO_TEST_GUIDE.md`.

`pnpm demo:check` passed all 12 isolated simulated scenarios over actual local
HTTP, using fresh temporary state and the existing durable coordinators. No
model, ledger, faucet or merchant was contacted. TypeScript typecheck passed;
1,804 TypeScript tests and 43 Python tests passed. Python startup/installer tests exercise private
session reuse through a real local HTTP fixture, state preservation, secret
separation, model selection, symlink refusal and bounded health waits. Docker
orchestration, actual WebUI 0.13.3 registration, native tool calling and latency
on the owner's machine still require deployment verification. The payment,
policy/signing and ledger controls were not relaxed by this startup change.

## Finance preset tool-scope repair (13 November 2026)

The user's live-model screenshot showed consideration of an asserted admin
exception and `create_tasks`, an unrelated WebUI built-in. It did not show a
successful task creation or payment bypass. Official Open WebUI v0.13.3 source
confirmed built-ins default to enabled on native tool-calling models. The finance
installer now explicitly disables built-in injection and auxiliary execution
capabilities and limits this preset to the harness tool server, including repairs
of existing presets without fast-mode changes. Owner text/unrelated parameters
are preserved; other presets and global tool connections are not changed.

Installer regressions cover fresh/old presets and idempotent scope repair.
Local HTTP regressions carry the actual claimed-admin text: agent owner writes
403, payment authority extras 400, unknown task tool 404, unchanged policy and
zero payment adapter calls. These are simulated/local-service tests, not a new
live-model or ledger demonstration. Verify the new chat's actual tools after
running startup on the owner's PC; cached old chat tools must be discarded.
