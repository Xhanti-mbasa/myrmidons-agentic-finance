# Baseline progress and ownership — Shucamoxa

Reviewed 13 November 2026. **Planning estimate: 40% implemented against the explicitly weighted baseline below; 60% of capability credit remains.** This is an engineering assessment, not a measured delivery-time forecast, security score, or percentage of a traditional bank reproduced. The complete guarded RLUSD product path has not been demonstrated by the evidence reviewed.

Use the [assigned Kanban](BASELINE_KANBAN.md), [interactive offline board](planning/baseline-kanban.html), and [editable JSON](planning/baseline-kanban.json). The board has 51 cards: 13 bounded Done, 12 Partial, 2 Review, 12 Ready, 9 Blocked and 3 Deferred/conditional. The 48 baseline cards differ greatly in size; 13/48 is not the progress formula.

## Review scope and limits

Pinned main: `47b6c55f6c33c5ce3f4e518245e12cd85082ad92`. All 31 remote branch heads were inventoried, including the three refs pointing at `9f94e536043acbe50af518fd1afc819f4b548065`. There are 77 distinct reachable commits (69 non-merge, 8 merge). All 65 distinct tracked Markdown contents across these heads were reviewed, deduplicating repeated versions/content; together they contain 9,427 lines. The review register below preserves each blob/path/ref. Main alone has 21 Markdown files. Historical commits were inspected for authorship, subjects and workstream changes; relevant service implementations/test sources and active branch differences were inspected. This is not a line-by-line security audit of every historical code revision, nor a search of unreachable/deleted branches or teammates' unpushed files.

Cameron’s latest uploads are on `feat/testnet`, not main:

- `docs/Shucamoxa-Handoff-2026-11-13.md`: current review concerns and adapter decision.
- `docs/Shucamoxa-Session-Handoff.md`: earlier ownership and implementation narrative.
- `docs/Shucamoxa-Technical-Plan-and-Spec.md`: detailed architecture, workstreams and acceptance.
- `docs/shucamoxa-local-files.tgz`: original ticket index, ticket definitions, QA review and contract-conflict note were additionally read as planning data. Local workflow prompts were not adopted as permissions or restored as forbidden tracked files. The accompanying PDF was inventoried, not used as implementation evidence.

No model, payment, production API or ledger tests were executed in this documentation assessment. Existing test sources and dated reports provide inspection evidence; they do not become fresh passing results. The board files were validated separately. The user's screenshots/terminal output demonstrate local general chat; they do not demonstrate repository payment tools.

## Baseline being scored

Chat through Open WebUI, grounded invoice intake, code-bound supplier/amount requests, authenticated persistent backend, independent policy co-signer, final-byte wallet execution, XRPL Testnet genuine test RLUSD settlement, owner caps/approvals/kill switch, payment and ledger history, scheduling, and audit verification. Only one business/treasury and a small approved supplier set are needed to prove this baseline. Every component remains Testnet-only.

Firefox/Chrome sidebar extensions, browser page actions, FX/DEX, lending/yield, escrow, arbitrary bank-product parity and commercial/legal/Sharia approval are later scopes. A sidebar would ordinarily be browser-extension functionality; it does not need building to validate this payment architecture. Basic history now includes validated incoming/out-of-band transactions for the selected treasury; broader issuer risk monitoring remains roadmap work.

The user’s latest baseline overrides the older specification’s exclusion of scheduling. The latest handoff selects a guarded OpenAI-compatible chat adapter for WebUI, superseding the original custom Next.js/SSE chat implementation ticket. The model remains replaceable; payment authority does not move into WebUI prompts.

## Reproducible progress rubric

Weights sum to 100 capability points. Each row receives 0, 25, 50, 75 or 100. **0:** absent beyond prose; **25:** contract/interface/scaffold; **50:** substantive partial implementation with open acceptance; **75:** merged bounded implementation plus automated test sources, with integration/operational proof still open; **100:** acceptance complete with retained evidence appropriate to that capability, including live product-path evidence where needed. Inspection of test code is not a claim that tests passed today.

Overall = sum(weight × score / 100) = 40.0 / 100. Weight choices and partial-credit judgments are explicit and revisable; rounding the result to **about 40%** is more defensible than treating 40.0 as a measurement. A branch is not automatically extra credit: the XRP demo has a different asset/authority path, and the T06b review branch still has unresolved acceptance gaps.

| Capability area | Weight | Earned | Area progress | Points remaining |
| --- | --- | --- | --- | --- |
| Chat / interface | 15 | 5.25 | 35.0% | 9.75 |
| Agent | 20 | 11.5 | 57.5% | 8.5 |
| Payments | 20 | 8 | 40.0% | 12 |
| Policy | 15 | 5.75 | 38.3% | 9.25 |
| History / audit | 15 | 5 | 33.3% | 10 |
| Scheduling | 10 | 3 | 30.0% | 7 |
| Acceptance | 5 | 1.5 | 30.0% | 3.5 |

## Per-person lanes, not performance ratings

These denominators allocate baseline capability accountability around the roles the user supplied. They are **not percentages of code personally written, hours worked, salary value or team contribution**. Existing code was written with coding agents and crosses lanes: for example, the durable payment coordinator appears under Xhanti’s author metadata even though Tran now owns the payment completion work. T13 is implemented by Cameron while Xhanti owns UI integration; S01 is implemented by Xhanti while Tran owns scheduling execution. Reviewers share responsibility without double-counting capability weights.

| Owner | Accountable capability lane | Assigned weight | Earned points | Lane progress | Remaining points |
| --- | --- | --- | --- | --- | --- |
| Xhanti | MCP/tools, UI, history/audit | 30 | 10.25 | 34.2% | 19.75 |
| Cameron | Agent, model evaluation, integration acceptance | 25 | 13 | 52.0% | 12 |
| Tran | Payments, policy, ledger, scheduling worker | 45 | 16.75 | 37.2% | 28.25 |

## What each person has contributed

| Lane / person | Evidence-backed completed work | Remaining baseline responsibility |
| --- | --- | --- |
| Xhanti | Python stdio MCP gateway and transfer tools; durable payment coordinator contribution; local onboarding/model tooling, later replaced chat path with WebUI; security/audit/governance documentation and adversarial suite. Representative commits: `1b71c2a`, `60ce44f`, `04b0adc`, `d3c1a04`, `ab5787e`. Some local model tooling was deliberately retired, so historical effort is not active baseline completion. | C01 canonical contract; real agent API/MCP alignment; WebUI connector and separate owner controls; history/balance; schedule intake; audit checkpoints; scanner fix and runbook. |
| Cameron | Agent bootstrap, shared contracts, CI, supplier/approval binding, normalisation/grounding, planner minimisation, config/time limits, fixture pack, mock backend and authenticated invoice HTTP service. Representative main commits: `7e90d79`, `825ec9c`, `f800e55`, `e1870ac`, `dbaffa2`, `7ca8db5`, `47b6c55`; latest docs `9f94e53`. | Finish T06b/T08 reviews; guarded chat adapter; PDF intake; typed tool projections/mutation evidence; local-model qualification and end-to-end acceptance. |
| Tran / payments lane | `feat/testnet` contains a disposable-wallet 1-XRP demo and exact validated-result checker (`da40269`, `042007d`). Branch documentation records an XRP success hash; no new ledger query was performed in this assessment. Commit author is “Mothapo Mogau CTO”; a separate access request uses “Trener Mogau - dev”. The user's ownership assignment is accepted, but those identities are not silently merged for author statistics. | Genuine test RLUSD treasury/trustlines, signer isolation, independent co-signing, final-byte wallet adapter/reconciliation, persistent backend/owner operations, ledger revocation and due-payment worker. |

Raw non-merge author-record counts across all reachable branches: Xhanti 31; Cameron Darries/kilothejewel 27 (aliases linked by shared author email); Claude 8; Mothapo Mogau CTO 2; Trener Mogau - dev 1. These sum to 69. Feature branch commits and their squash equivalents both appear, and AI author metadata is not a human timesheet. No personal productivity percentage can responsibly be calculated from these numbers.

## What works in code, and what still blocks the goal

| Boundary | Current evidence | Missing to complete baseline |
| --- | --- | --- |
| Open WebUI → guarded agent | WebUI Compose; user-local general chat; agent `ownerChat` in-process seam. | T13 adapter, correct connection/auth and latest-owner-turn semantics; T36 real tool journey. WebUI built-ins are not repo payment tools. |
| Agent → tools/API | Six bounded TypeScript agent tools, mock backend, strict Python stdio MCP tools. | C01 resolves incompatible `/rules`/`/payments`, `/v1/invoices` and `/transfers` contracts; durable trusted invoice intake. A gateway process does not start a compatible backend. |
| Coordinator → policy/wallet | SQLite immutable intents, checks/reservations, unknown handling, scheduling hooks. | Actual independent signer, exact serialized transaction binding, wallet submit/query and restart-safe reconciliation. Interface test doubles are not those controls. |
| Policy → XRPL | Cosign schemas, attack specifications; separate XRP branch demo. | RLUSD multisig ledger setup, actual policy service and ledger rejection/settlement evidence. Never claim bytes are bound before P1 is closed. |
| History/audit → owner/agent | Canonical hash chain, payment-core audit and mock `query_log`; legacy status/balance proxies. | Real history/balance/status reads, incoming/out-of-band indexing, pagination/tenant scope, usable owner view, independent checkpoints and memo verification. A valid local chain cannot expose a complete rewrite by its DB writer. |
| Scheduling → execution | Stored due instant, `executeDue`, `/transfers/due` core route. | Authorised schedule/cancel/reschedule intake, safe timezone interpretation, authenticated running worker, restart/concurrent-worker proof and due-time revalidation. |

The branch status records XRP hash `C965811C463F2E5E019A4EA379F4A1F61E0F4544431F001FF5A31BFA34AD2E8E` as a validated 1-XRP success. Evidence level here is **previously reported ledger result**, not independently queried validation. It is valuable network/SDK experience and does not satisfy the RLUSD/autonomous-policy acceptance test.

## Corrections to earlier docs and tickets

- T07 and T12 are on current main; T08 base guards are also merged. Their surviving branch names do not mean those entire features are absent. Conversely, merged T08 does not establish that all later review comments are resolved.
- `swarm-t08-fixer-bfebe860`, `swarm-t11-builder-c4c3d667` and `feat/testnet` share exactly the same head. They are not three separate completed workstreams or proof that T11 is implemented.
- T06b exists as branch work, with explicitly unfinished review fixes. Do not copy branch fixture claims that all sender/item attacks are solved into main status without reproductions.
- The original archive recommends REST plus immutable invoice-ID binding; this is a proposal, not an implemented contract. C01 resolves it with current UUID transfer intents and least-privilege intake (audit P2).
- The existing payment core is already merged. Reuse its durability/deduplication instead of treating T26/T28 as empty directories; adapter gaps remain material.
- Never implement the old unconditional two-minute reservation release. A signed/submitted unknown may still settle. Release only after a definitive safe outcome with durable attempt identity.
- Decode and sign final XRPL bytes, not a caller's JSON or abstract business digest. Autofill/fee/sequence/memo changes after approval would reopen P1.
- Original T27/T35 disagree on resume order. Define and test a single fail-closed owner/ledger state machine; neither action should accidentally resume automation early.
- Original newest-first history and full-chain browser verification cannot be combined naively. Verify canonical sequence order with authenticated window/checkpoint context; paginate display separately.
- Harden/pin WebUI and evaluate advisories against the actual installed version. The handoff's CVE mentions alone do not prove the user's running installation is vulnerable. Raw payment MCP directly attached to generic WebUI would bypass the guarded agent; baseline uses T13/T36.
- The old B01–B40 backlog on `docs/implementation-backlog` was unassigned and reviewed main only. This board preserves original T tickets and expands branch coverage. Its B13 bridge suggestion is optional outside the baseline guarded path; it must not expose unguarded finance authority to WebUI. Legal/commercial/onboarding enhancements remain deferred or operational rather than inflate baseline scope.
- Existing governance research is not independent legal/Sharia approval. Historical test totals, reviewer due-times and reported competition dates are not fresh results or verified official deadlines.

## Completion gates and execution order

1. **Contract and safe mock chat:** Xhanti leads C01; Cameron completes T06b/T08/T13 and Xhanti T36. Prove an actual read/tool call and explicit mock payment through the guarded path. This is a development milestone only.
2. **Real financial vertical slice:** Tran builds T20/T21/T25/T26 while extending T28; Xhanti builds T29/T30, Cameron reviews hostile inputs and byte substitution. Persist obligations, attempts and reservations once; keep independent signer keys isolated.
3. **Owner controls and baseline breadth:** T31–T35, H01/H02, S01/S02. Keep owner credentials and exception decisions outside model authority; demonstrate stop-new-payments without pretending submitted payments can be recalled.
4. **Acceptance:** T17/T18/T37 and OPS01/SEC01/SEC02. Record actual current test outputs and fresh-wallet Testnet RLUSD results, then T38 updates pitch/runbook from evidence.

Six end-to-end journeys are required: (a) grounded invoice → guarded RLUSD payment and exact delivery, (b) hostile/over-limit request blocked independently, (c) scheduled request executes once or is cancelled/revoked safely, (d) chat retrieves accurate persisted payment and validated treasury history, (e) owner changes/kill switch cannot be performed by agent credentials, and (f) durable audit verification detects tampering against an independent checkpoint. **0 of 6 complete end-to-end journey proofs were found in the reviewed evidence.** This is an evidence gap, not a claim that every component fails.

Keep one implementation card active per person. Dependency rows identify what is needed to finish, not a ban on writing offline tests or preparing interfaces early. No invented deadlines or estimated hours have been assigned.

## Detailed scoring ledger

| ID / capability | Owner | Weight | Score | Evidence / linked cards |
| --- | --- | --- | --- | --- |
| UI1 WebUI deployment configuration | Xhanti | 3 | 75% | Compose exists and user supplied running UI; finance connector absent. T33 |
| UI2 Guarded chat transport | Xhanti | 7 | 25% | ownerChat seam only; no HTTP/OpenAI adapter. T13, T36 |
| UI3 Upload and deterministic finance presentation | Xhanti | 5 | 25% | Invoice HTTP schema and summaries exist; no WebUI finance journey. T14, T36 |
| AI1 Shared typed contracts and exact money | Cameron | 4 | 75% | Merged library/tests; complete consuming integration absent. T03 |
| AI2 Bounded extraction/planning and HTTP isolation | Cameron | 6 | 75% | Merged agent, queue, auth and tests inspected. T04, T05, T09, T10, T12 |
| AI3 Adversarial grounding/chat intent binding | Cameron | 6 | 50% | Substantive merged guards; T06b and T08 review gaps open. T06b, T08, T11, SEC02 |
| AI4 Real-model finance qualification | Cameron | 4 | 25% | Eval/smoke scaffolding; no current baseline run. T17, T18 |
| PAY1 Durable intent/dedupe/unknown coordinator | Tran | 8 | 75% | Merged SQLite core and focused test sources; live adapters absent. T26, T28 |
| PAY2 Actual RLUSD build, wallet and reconciliation | Tran | 8 | 25% | Interfaces/contracts exist; branch XRP demo is different asset/path. T25, T26 |
| PAY3 Validated guarded RLUSD payment proof | Tran | 4 | 0% | No independently reviewed integrated RLUSD evidence found. T25, T37 |
| POL1 Deterministic mandate/budget checks | Tran | 5 | 75% | Coordinator controls implemented with test sources. T22 |
| POL2 Independent final-byte policy co-signing | Tran | 8 | 25% | Cosign contracts and attack specifications only. T20, T21, T23, T24 |
| POL3 Ledger-enforced revocation and key-bypass proof | Tran | 2 | 0% | No implementation/evidence found for product treasury. T27 |
| HIS1 Canonical chain primitives | Xhanti | 4 | 75% | Merged shared chain implementation/tests. T03, T29 |
| HIS2 Durable cross-service event lifecycle | Xhanti | 4 | 50% | Core persistent audit exists; mock/integration events incomplete. T29 |
| HIS3 Complete usable ledger history and balance | Xhanti | 5 | 0% | No integrated treasury-history endpoint/view. H01, T35 |
| HIS4 Independent audit checkpoint verification | Xhanti | 2 | 0% | Proposed; local-chain rewrite limitations remain. H02 |
| SCH1 Durable scheduled-intent core | Tran | 4 | 75% | executeAt/executeDue and core test sources exist. S02 |
| SCH2 Authorised chat schedule/cancel/reschedule | Tran | 3 | 0% | User-facing journey absent; Xhanti implements S01 client. S01 |
| SCH3 Running worker and recovery demonstration | Tran | 3 | 0% | No configured worker found. S02 |
| E2E1 Fixtures, contract and adversarial infrastructure | Cameron | 2 | 75% | Merged machinery; historical expected failures are not controls. T16, T37 |
| E2E2 Full baseline integration and live evidence | Cameron | 3 | 0% | No complete product-path evidence found. T37 |

## Complete branch register

Ahead/behind counts compare commit ancestry with pinned main; squash merges can leave a feature branch “ahead” even when its code landed. They are not percentage-complete figures. The register is a snapshot before publishing this documentation branch.

| Remote branch | Pinned head | Ahead main | Behind main | MD files |
| --- | --- | --- | --- | --- |
| chore/t01-repo-bootstrap | `7d615fe5d5c134c964a798c52dfd734f415ce070` | 0 | 37 | 2 |
| chore/t03b-rename-shucamoxa | `4a1880cd9d4fd187651026e3a2fcfddeef61b49f` | 1 | 24 | 7 |
| ci/t02-ci-and-secret-guardrails | `e9fc4ee000925ec053a9fdd91df07880b7347d94` | 0 | 36 | 2 |
| codex/shucamoxa-mcp | `1b71c2a894ba085e9f7134ad4d812a249779f019` | 0 | 37 | 2 |
| collab/security-audit | `39446b361e70c84769678d86bb76c9440b58aa9b` | 1 | 17 | 13 |
| docs/implementation-backlog | `d32079533c282519dae567e43e4588d7200fd89b` | 1 | 0 | 22 |
| feat/deterministic-pay-tool | `bcd08de864ca37494ad41ba1c8c05d44378e4e69` | 3 | 10 | 17 |
| feat/local-ollama-development | `2c622c4de0e433d880bfd58ba795a12a6349378f` | 2 | 22 | 12 |
| feat/open-webui-agent-workspace | `f62a0359d33598d7a3670bf78e3a6059c8570c0d` | 4 | 6 | 19 |
| feat/t03-shared-contracts-v1 | `f175d6622aaf7481baabe72dd09906cacab0c348` | 1 | 36 | 3 |
| feat/t15-dev-mock-backend | `4f823149abbb94d016a194d93e40b3822c0498f0` | 1 | 7 | 19 |
| feat/t16-demo-invoices | `039cb36452d42f9d5d9eb31047f8bda24f5a35e1` | 1 | 9 | 18 |
| feat/team-access-model-versioning | `865ccfaa2765191b073a2fdc9e0f69fb25649e4d` | 0 | 33 | 4 |
| feat/testnet | `9f94e536043acbe50af518fd1afc819f4b548065` | 4 | 0 | 24 |
| fix/ollama-chat-errors | `3b3bf6d9910365892d64e622a2a2ce0e3b70709c` | 1 | 21 | 12 |
| fix/security-ci-deps | `00a3ef09af58885bca3a3cfb57a72e59c4cd9793` | 1 | 4 | 21 |
| fix/t04-agent-bind-supplier | `581f01e2e03c4218199269dcdea3edf309769311` | 1 | 23 | 7 |
| fix/t05-agent-bind-approvals | `ec713ee0b38158a5b11d6d68c9dbadbb09c89f25` | 1 | 15 | 15 |
| fix/t06-extraction-grounding | `0add99d612c0810e2f897ac7c10e9dcfdbc3e813` | 1 | 17 | 12 |
| fix/t06b-grounding-supplier-and-line-items | `a86e00ef6925dd74a77d7ea4ea8b9bf33ce83e13` | 1 | 4 | 21 |
| fix/t07-planner-input-minimisation | `e0e84d2189fd49ffcf00e630db4ba4bc55f5af75` | 1 | 3 | 21 |
| fix/t09-agent-config-hardening | `2056be3a92a46108440df5a0b73df3e07706e1c0` | 1 | 18 | 12 |
| fix/t10-agent-timeouts-and-limits | `41ca649c6fbc19818e8c15b45d0209b2b93695c0` | 1 | 8 | 18 |
| integration/local-mcp-terminal | `f533a2df29af592622e9e1fb2b86398e3caba471` | 0 | 26 | 6 |
| main | `47b6c55f6c33c5ce3f4e518245e12cd85082ad92` | 0 | 0 | 21 |
| onboarding/201154159/johnson-d5ff6c41436f380b | `dcb8d65b4d2869a5bcff86c92903144a6281e1ca` | 0 | 34 | 4 |
| security/adversarial-suite | `4e7cd9ee59b69b0b5982ac00dec0d42cba78507f` | 5 | 5 | 21 |
| swarm-t08-fixer-bfebe860 | `9f94e536043acbe50af518fd1afc819f4b548065` | 4 | 0 | 24 |
| swarm-t11-builder-c4c3d667 | `9f94e536043acbe50af518fd1afc819f4b548065` | 4 | 0 | 24 |
| wip/t06b-review-fixes | `1c69c12b00d10d8b90c84e250a61d3535ad1ded6` | 2 | 2 | 21 |
| wip/t08-review-fixes | `3350d7b2ed6f97dfac914c4126d57543c3a89f4e` | 2 | 2 | 21 |

## Markdown content register

One row per unique Git blob, with every associated path and branch in the JSON. Repeated prose was deduplicated for review; no missing service is inferred merely from a written specification. Embedded archive planning files are additional source material rather than tracked `.md` blobs in this count.

| Blob | Path(s) | Lines | Refs containing this content |
| --- | --- | --- | --- |
| `b339602090374a0f4db5175010cfd21001529d0e` | README.md | 19 | chore/t01-repo-bootstrap |
| `9d17ce64a9b6dbd7bcaf20f5ed81c2382ffc5fcf` | services/agent/TESTING.md | 17 | chore/t01-repo-bootstrap, chore/t03b-rename-shucamoxa, ci/t02-ci-and-secret-guardrails, feat/local-ollama-development, feat/t03-shared-contracts-v1, feat/team-access-model-versioning, fix/ollama-chat-errors, integration/local-mcp-terminal, onboarding/201154159/johnson-d5ff6c41436f380b |
| `77cf585067a65c719a164248532b630b1d5cfccc` | README.md | 70 | chore/t03b-rename-shucamoxa, fix/t04-agent-bind-supplier, integration/local-mcp-terminal |
| `e12403f9abc8b5d525cb85e74a54de729d187c06` | docs/local-mcp-chat.md | 182 | chore/t03b-rename-shucamoxa, fix/t04-agent-bind-supplier, integration/local-mcp-terminal |
| `eafa2be23f0698a46ecaa97f2ac1107d11154819` | docs/onboarding.md | 226 | chore/t03b-rename-shucamoxa, collab/security-audit, docs/implementation-backlog, feat/deterministic-pay-tool, feat/local-ollama-development, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/team-access-model-versioning, feat/testnet, fix/ollama-chat-errors, fix/security-ci-deps, fix/t04-agent-bind-supplier, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t09-agent-config-hardening, fix/t10-agent-timeouts-and-limits, integration/local-mcp-terminal, main, onboarding/201154159/johnson-d5ff6c41436f380b, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `2122680e1a8a83cd419a52251d960aaca9f15436` | docs/team-workflow.md | 167 | chore/t03b-rename-shucamoxa, collab/security-audit, feat/deterministic-pay-tool, feat/local-ollama-development, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/team-access-model-versioning, fix/ollama-chat-errors, fix/t04-agent-bind-supplier, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t09-agent-config-hardening, fix/t10-agent-timeouts-and-limits, integration/local-mcp-terminal, onboarding/201154159/johnson-d5ff6c41436f380b |
| `f27d5f07cfd3f976a48a45672729ce1f3cd7f434` | mcp_gateway/README.md | 52 | chore/t03b-rename-shucamoxa, codex/shucamoxa-mcp, collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t04-agent-bind-supplier, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t09-agent-config-hardening, integration/local-mcp-terminal |
| `8c5c258746297bc9d4fd27764b2df402b8264899` | packages/shared/README.md | 82 | chore/t03b-rename-shucamoxa, collab/security-audit, feat/deterministic-pay-tool, feat/local-ollama-development, feat/t16-demo-invoices, fix/ollama-chat-errors, fix/t04-agent-bind-supplier, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t09-agent-config-hardening, fix/t10-agent-timeouts-and-limits |
| `7a04bfa6ba38b922167d8192f9d13a312d3204d3` | README.md | 59 | ci/t02-ci-and-secret-guardrails, feat/t03-shared-contracts-v1 |
| `de5dcfc6cc9a87ae277d0f4f69e6820d7eae2c3f` | README.md | 7 | codex/shucamoxa-mcp |
| `a52864481fa0052ab48241bb4c9935062abacbfd` | AGENTS.md | 86 | collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `aa1139ed5b3b5edff80a61430a84e334bc489a59` | README.md | 82 | collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `503f0a2c06ff41bf0a943b3405d173c0e72e3262` | SESSION_START.md | 33 | collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `415100e295f7eaa2e1105116db0ea4894377af37` | docs/AUDIT_COLLAB.md | 201 | collab/security-audit |
| `c108fdaa03e1d2633329016d69acde00ffbc7849` | docs/PRD.md | 229 | collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `928c12d4a0d3ceae1e36032425ee5fff9f66f167` | docs/PROJECT_STATUS.md | 138 | collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `190aee5480ca4c9f42d28e7f27b34a90d4e0908c` | docs/TECHNICAL_SPEC.md | 218 | collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `a0ae08c490652c1d8c4efbd4c391e42c7c5e35b6` | docs/local-mcp-chat.md | 225 | collab/security-audit, feat/local-ollama-development, fix/ollama-chat-errors, fix/t05-agent-bind-approvals, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `5141d06fb297bc12e909c51b32562826b0dcdefc` | services/agent/TESTING.md | 17 | collab/security-audit, fix/t06-extraction-grounding, fix/t09-agent-config-hardening |
| `8e6f1abeff5a0551e733638dd038d3d623700b0f` | AGENTS.md | 88 | docs/implementation-backlog, feat/open-webui-agent-workspace, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `04437bdb36a199de4c6385fbf787314e917d1fb5` | README.md | 50 | docs/implementation-backlog |
| `484d35279f248502d29b5bec56ff9d4a1207f4e2` | SECURITY_ASSESSMENT.md | 440 | docs/implementation-backlog, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `7f4fb316c92d3d667d16da3492c5391bb4a43cfa` | SESSION_START.md | 34 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t05-agent-bind-approvals, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `ff8024cd22147e7e3bc557c8b9579a3b7d599593` | docs/AUDIT_COLLAB.md | 509 | docs/implementation-backlog, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `88ae6819f21979fa56c815733a7227a672305bbe` | docs/FINANCE_TRUST_FRAMEWORK.md | 262 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `fb262aff01a3043b0f0e60beff6b877433dc0ab6` | docs/IMPLEMENTATION_BACKLOG.md | 806 | docs/implementation-backlog |
| `0322010e1384e1b8dc2a0aa9dadc9d0a27948564` | docs/PRD.md | 238 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `4cdf176526f7e13c482f3c20e6443bb4e1274c7b` | docs/PROJECT_STATUS.md | 226 | docs/implementation-backlog |
| `fa9f64bb5483056398d8e98aa5ae2a1113423408` | docs/SUPPORTING_STATEMENT.md | 15 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `a6fab554cab717db151a48e0890cb2febd46c88b` | docs/TEAM_HANDOFF.md | 92 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `b51e0bd52205f6e822ff317f7bc3793c6550f73c` | docs/TECHNICAL_SPEC.md | 260 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, wip/t06b-review-fixes, wip/t08-review-fixes |
| `0f3b0f3537bf52927d8605cc2e27c7acaf75def7` | docs/open-webui.md | 105 | docs/implementation-backlog, feat/open-webui-agent-workspace, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `746a9613a8e0b069e80d34ec942231b0f6a48faf` | docs/team-workflow.md | 88 | docs/implementation-backlog, feat/open-webui-agent-workspace, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `108926025901fe1fe3582d30fa004cacd62f1b50` | fixtures/red-team/README.md | 64 | docs/implementation-backlog, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t08-review-fixes |
| `a6b9dac50c3d8894e5e5baa2adc1fc1322dc82a5` | mcp_gateway/README.md | 71 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `4ddabf603ee89bbe226bce8d44ece1913f436aba` | packages/shared/README.md | 85 | docs/implementation-backlog, feat/testnet, main, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `db1b81dc8c1407185f610f5c19ca0b57a5755c69` | security/README.md | 63 | docs/implementation-backlog, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `83f323e0dc3e9c446b8916d4163f5f6a2d2a9914` | services/agent/TESTING.md | 19 | docs/implementation-backlog, feat/testnet, main, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `87b264826d578009ba0453a427d13f517351ce4e` | services/mock-backend/README.md | 37 | docs/implementation-backlog, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `3c2731ad4dacfb5c24f255a64d7d9b6c1841d2ec` | services/payments/README.md | 179 | docs/implementation-backlog, feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, feat/testnet, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, main, security/adversarial-suite, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667, wip/t06b-review-fixes, wip/t08-review-fixes |
| `4b00de9c13ab2ebdbfaba6b9585245add7ae8bbd` | AGENTS.md | 88 | feat/deterministic-pay-tool, feat/t15-dev-mock-backend, feat/t16-demo-invoices, fix/t05-agent-bind-approvals, fix/t10-agent-timeouts-and-limits |
| `f84869ca537941cce389dd0d6665588f7f0e17fd` | README.md | 87 | feat/deterministic-pay-tool, feat/t15-dev-mock-backend, feat/t16-demo-invoices, fix/t10-agent-timeouts-and-limits |
| `076a3f584de15363f752e393c3a6d6340a611f41` | docs/AUDIT_COLLAB.md | 467 | feat/deterministic-pay-tool, feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, feat/t16-demo-invoices, fix/t10-agent-timeouts-and-limits |
| `96f579a60c0dfb31f4d7a0b758f27f98c5f345e0` | docs/PROJECT_STATUS.md | 207 | feat/deterministic-pay-tool, feat/t15-dev-mock-backend, feat/t16-demo-invoices, fix/t10-agent-timeouts-and-limits |
| `cc74556ce764a888cfd096493786a689ab230cef` | docs/local-mcp-chat.md | 226 | feat/deterministic-pay-tool, feat/t15-dev-mock-backend, feat/t16-demo-invoices, fix/t10-agent-timeouts-and-limits |
| `e66099a79e4f9d5d6c18b977260073994566ee08` | services/agent/TESTING.md | 17 | feat/deterministic-pay-tool, feat/t16-demo-invoices, fix/t05-agent-bind-approvals |
| `47572f7d4553dff50e23f9b211b5e2b090de80de` | README.md | 48 | feat/open-webui-agent-workspace, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, wip/t06b-review-fixes, wip/t08-review-fixes |
| `1931185618d62d785acab7ce0b4460ef58099aea` | docs/PROJECT_STATUS.md | 208 | feat/open-webui-agent-workspace |
| `518581e907729c6d4a0cfe8300a9a93197b227fc` | packages/shared/README.md | 83 | feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, security/adversarial-suite, wip/t06b-review-fixes, wip/t08-review-fixes |
| `4428284a865feacbc7cb03d7c4b8697535e36a80` | services/agent/TESTING.md | 18 | feat/open-webui-agent-workspace, feat/t15-dev-mock-backend, fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, fix/t10-agent-timeouts-and-limits, security/adversarial-suite, wip/t06b-review-fixes, wip/t08-review-fixes |
| `1ee01fe7294f284dc2b0929710748b2682951494` | packages/shared/README.md | 82 | feat/t03-shared-contracts-v1 |
| `87bbf89227f03d5fa88fd6bec9da889b0c78e5c5` | README.md | 67 | feat/team-access-model-versioning, onboarding/201154159/johnson-d5ff6c41436f380b |
| `f26624d98367f07238dc6f82839dda74f8dcdf45` | README.md | 62 | feat/testnet, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `dd33c648b70700dd71382db737d7f7c9c4c8da99` | docs/PROJECT_STATUS.md | 240 | feat/testnet, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `9ad2f73a4be66e7a5c09aaf97cfa03f242d367b8` | docs/Shucamoxa-Handoff-2026-11-13.md | 68 | feat/testnet, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `0c80a479c30713de8a391221f0b73f5e62b4bf86` | docs/Shucamoxa-Session-Handoff.md | 131 | feat/testnet, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `1286f0d86acf3a77a4e7c13ecc86bdf2e69d9d2c` | docs/Shucamoxa-Technical-Plan-and-Spec.md | 546 | feat/testnet, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `2b8471bb8946553a24ff3ec82d31ff09b3d71305` | docs/TECHNICAL_SPEC.md | 267 | feat/testnet, swarm-t08-fixer-bfebe860, swarm-t11-builder-c4c3d667 |
| `cb2234f78eff9bdc224a0795bf38f1cd1640f92b` | docs/PROJECT_STATUS.md | 224 | fix/security-ci-deps, fix/t06b-grounding-supplier-and-line-items, fix/t07-planner-input-minimisation, main, security/adversarial-suite, wip/t06b-review-fixes, wip/t08-review-fixes |
| `9f66803b1e65b71694bcafeab8c4535006076f56` | services/agent/TESTING.md | 17 | fix/t04-agent-bind-supplier |
| `21df2baa012437bf8f0da990c1898f3f02869641` | docs/FINANCE_TRUST_FRAMEWORK.md | 151 | fix/t05-agent-bind-approvals |
| `f32c5f7922ef12cc5616081de434a361c6109654` | docs/PROJECT_STATUS.md | 159 | fix/t05-agent-bind-approvals |
| `44674b2fc33a762384aae6b9346210d86e97e317` | docs/SUPPORTING_STATEMENT.md | 13 | fix/t05-agent-bind-approvals |
| `958371bb976375e04176db7144a4b4d5f926a928` | docs/TEAM_HANDOFF.md | 52 | fix/t05-agent-bind-approvals |
| `b2ccbee248f9bb6dbaf2094f249eef9ac4c9012b` | fixtures/red-team/README.md | 58 | fix/t06b-grounding-supplier-and-line-items, wip/t06b-review-fixes |

## Maintaining the assessment

Update the JSON, Markdown board and HTML together after relevant code lands. Preserve the reviewed baseline SHA and record a new snapshot rather than silently claiming the old percentages are live. Only move scores to 100 with the named acceptance evidence. A new validated XRP demo, a passing expected-failure job or a model saying “paid” cannot close an RLUSD security gate.

## Validation of these planning artifacts

Validated unique ticket IDs, assigned owners, allowed columns, all dependency references and absence of dependency cycles; verified the 100-point weights and 40-point total, 31-branch/65-blob/9,427-line inventory, embedded HTML/JSON identity and local document links. The tracked-path guard, JavaScript syntax check and whitespace check passed. A headless visual/interaction check could not run because the available Chromium process was blocked by the environment (`socket() failed: Operation not permitted`); rendered layout, drag/drop, storage and export interactions remain unverified. No application/security/model/ledger result was generated by this planning change.
