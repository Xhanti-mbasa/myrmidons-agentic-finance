# Shucamoxa implementation status and handoff

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

Developer RLUSD CLI working tree update: `services/backend/src/rlusd-demo.ts`
provides reusable local Testnet wallets, trust-line setup, balance reads and a
single-signature 1 RLUSD send with pre-submission tracking. On 13 November 2026,
live Testnet setup confirmed both trust lines. After the sender was funded, the
developer CLI confirmed a validated `tesSUCCESS` transfer of 1 RLUSD with matching
issuer, recipient and delivered amount: transaction
`85D9384CD5A42DCCC34830E8E0FACB0F53E286F7A2B9463930F1B8E5D5E77DE1`.
The CLI is separate from the product and does not establish independent signing,
policy enforcement, or agent payment acceptance (AC-01).

Wallet adapter work in the current working tree adds `prepare-transfer.ts` to
construct a bounded Testnet RLUSD transaction from a coordinator transfer,
including its audit memo. This has simulated unit-test evidence only. It is not
a wallet adapter: signing, authorization verification, durable transaction
tracking, submission and reconciliation are still unimplemented for the
coordinator. The policy co-sign and transfer-permit contracts remain distinct.

| Component | Evidence / status | What this does not establish |
|---|---|---|
| Shared contracts | Source present in `packages/shared/src/`; schema, money, constants and log helper tests present. Current name is `@shucamoxa/shared`. | Deployed services actually validate every response or implement every declared rule. |
| TypeScript invoice agent | Source present in `services/agent/src/`; extraction/planning and six guarded tools; scripted-model/fake-backend tests. | Live autonomous XRPL payment or a compatible deployed backend. |
| Local terminal/MCP host | Source present in `src/w3node/chat.py`; real SDK subprocess tests for empty discovery/echo plus scripted Ollama CLI tests. | The user's live Qwen selected/executed a tool correctly in a completed real-model test. |
| Shared model instance | User-reported live SSH as `xhanti`, workspace write test and Ollama `/api/tags` listing `qwen3:1.7b-q4_K_M`. Earlier supplied output also shows a generated model response. | A live payment system, strong service isolation, current uptime or automatic team onboarding deployment. |
| Model profiles/import | Source present in `model_build.py`; profile and GGUF blob flow tested with simulated APIs. | Fine-tuning, tensor editing, successful import of a real trained GGUF or actual live model rebuild. |
| Component manifests | Source present in CLI `model pin/pull`; selective checksum verification/cache tests. | A populated registry/manifest for all deployed model bytes; initial downloader supports unauthenticated HTTPS only. |
| Team onboarding | Client requests and bounded root sync/timer/cron definitions in source. Xhanti account/access configured interactively in supplied output. | Server sync installed/enabled with verified credentials, preapproved identities and working automatic invitations. |
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
transaction `C965811C463F2E5E019A4EA379F4A1F61E0F4544431F001FF5A31BFA34AD2E8E`.
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
