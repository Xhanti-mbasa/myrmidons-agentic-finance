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

| Component | Evidence / status | What this does not establish |
|---|---|---|
| Shared contracts | Source present in `packages/shared/src/`; schema, money, constants and log helper tests present. Current name is `@shucamoxa/shared`. | Deployed services actually validate every response or implement every declared rule. |
| TypeScript invoice agent | Source present in `services/agent/src/`; extraction/planning and six guarded tools; scripted-model/fake-backend tests. | Live autonomous XRPL payment or a compatible deployed backend. |
| Local terminal/MCP host | Source present in `src/w3node/chat.py`; real SDK subprocess tests for empty discovery/echo plus scripted Ollama CLI tests. | The user's live Qwen selected/executed a tool correctly in a completed real-model test. |
| Shared model instance | User-reported live SSH as `xhanti`, workspace write test and Ollama `/api/tags` listing `qwen3:1.7b-q4_K_M`. Earlier supplied output also shows a generated model response. | A live payment system, strong service isolation, current uptime or automatic team onboarding deployment. |
| Model profiles/import | Source present in `model_build.py`; profile and GGUF blob flow tested with simulated APIs. | Fine-tuning, tensor editing, successful import of a real trained GGUF or actual live model rebuild. |
| Component manifests | Source present in CLI `model pin/pull`; selective checksum verification/cache tests. | A populated registry/manifest for all deployed model bytes; initial downloader supports unauthenticated HTTPS only. |
| Team onboarding | Client requests and bounded root sync/timer/cron definitions in source. Xhanti account/access configured interactively in supplied output. | Server sync installed/enabled with verified credentials, preapproved identities and working automatic invitations. |
| Python payment MCP gateway | Source present in `mcp_gateway/`; five tools and simulated backend tests. | Compatible real backend, live payment integration or policies enforced merely by tool annotations. |
| Independent policy/signing service (W2) | `CosignRequest`/`CosignResponse`, rule codes and target invariants present as shared contracts. | A deployed co-signer or ledger configuration making its approval mandatory. |
| Payment service / XRPL execution (W3) | Shared contracts and target constants exist. | Live signer, durable operation store, submit/reconcile implementation or final Testnet settlement proof. |
| Backend/auth/audit service (W4) | Client expectations, schema/log primitives and fake backend tests exist. | Running authenticated owner/agent APIs, atomic reservations or durable audit persistence. |
| Owner control surface (W5) | Required in PRD. | Implemented owner dashboard, settings/approval UI or deployed web app. |
| Privy / Ghostsig / OWS | Workshop resources and public documentation were reviewed; Privy considered as candidate. | Vendor accounts, installed integrations, configured policies, raw signing authority or confirmed signer decision. |

No release claim should be based only on an enum, comment, mock response, older
test count or earlier assistant statement. Run the current checks and record the
actual commit and results when working on the relevant area.

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
existing tests exercise actual local MCP subprocess discovery/echo. No model was
downloaded or benchmarked on the owner's computer in this session. Next: owner
runs local setup/chat and echo, then records hardware and observed latency.
