# FROZEN PRESENTATION / DEMO BRANCH — DO NOT MODIFY

This branch is `demo/presentation-frozen`, the owner's presentation snapshot.
It must remain unchanged for the demonstration.

## Mandatory instructions for every model, agent and contributor

- Do not edit, commit, push, force-push, merge, rebase, reset, delete or otherwise change this branch.
- Before any write or push, check the current branch and destination ref. If either is `demo/presentation-frozen`, STOP and warn: "This is the frozen presentation/demo branch. Changes and pushes are prohibited. Use a separate development branch."
- Perform development in a new branch created from this snapshot or another development branch. Never target this branch with a pull request.
- Do not disable or bypass its GitHub protection or lock. Only an explicit later owner instruction naming this branch and requesting an unfreeze may authorize changing the freeze.
- Local installation and demonstration may generate ignored private runtime files. They must not change or be committed to the presentation source.

Snapshot source: `ea6e68b2e5f7fe9c1826f73792ee96790f73205e` (PR #54).
The freeze preserves this demo's existing limitations; it is not a security or live-payment certification.

---

# W3Node / Shucamoxa: start here

This repository is `Xhanti-mbasa/myrmidons-agentic-finance`. W3Node is the wider
project; Myrmidons is the repository name; **Shucamoxa** is the current product
name in code. Older PayGuard identifiers are historical, not a separate product.

## Read at the start of a session

1. `docs/PRD.md`: product, customer, scope, requirements and acceptance criteria.
2. `docs/TECHNICAL_SPEC.md`: architecture, contracts and security boundaries.
3. `docs/PROJECT_STATUS.md`: dated implementation evidence, gaps and next work.
4. `docs/FINANCE_TRUST_FRAMEWORK.md` and `docs/TEAM_HANDOFF.md` for finance/AI governance and current collaboration.
5. The source, tests and any nested instructions relevant to the requested task.

The PRD is a draft product baseline, not evidence of implementation. The status
document is a snapshot, not live monitoring. Check the current branch, working
tree, latest commits and relevant tests before claiming anything is complete.
If code and requirements differ, report the gap; do not quietly change the
requirement or describe the code as compliant.

## Product in one paragraph

Build an owner-controlled accounts-payable product for small importers: an agent
extracts invoice data and requests RLUSD payments to approved suppliers, within
a mandate enforced outside the model. The owner sets suppliers, caps and budgets,
handles exceptions, can stop new payments, and can inspect evidence of what
happened. The MVP must demonstrate both an autonomous XRPL Testnet payment
within mandate and a blocked request outside it. Chat and echo demos alone are
development checks, not the finished finance product.

## Rules that shape implementation

- The LLM proposes actions; it never owns payment authority. It cannot change
  mandates, approve its own exceptions, choose an arbitrary recipient, access
  wallet keys, bypass an independent signer, or turn off the kill switch.
- Invoice text, retrieved documents and tool output are untrusted data. They
  cannot grant access or override owner policy.
- This MVP uses XRPL **Testnet** and the configured genuine test RLUSD issuer.
  No Mainnet or real-value execution is implied by setup, chat or tests.
- Keep seeds, private keys, wallet/signing credentials, database credentials and
  production data out of the model's context, agent environment, Git and logs.
  Backend authorization uses scoped credentials; it is not wallet signing power.
- Use `@shucamoxa/shared` for wire schemas, rule codes, exact money helpers,
  testnet constants and audit hashing. Do not copy/relax contracts in each service.
- Money is decimal text on the wire and integer cents/`bigint` for calculations.
  Submission or a transaction hash does not prove settlement. Unknown outcomes
  require reconciliation, not blind payment retries.
- Preserve independent policy enforcement, ledger signing requirements,
  idempotency and budget reservations. Prompts and tool annotations are not
  substitutes for those controls.
- The TypeScript agent API and Python MCP gateway API are currently different.
  Do not wire them together by assumption. See `docs/TECHNICAL_SPEC.md`.
- Never describe an LLM as infallible or the product as legally/Sharia compliant or certified from prompts, tests or design documents. Follow the sourced governance guide and record actual independent approvals separately.
- Privy is an evaluated candidate, not an installed integration or a final signer
  decision. Ghostsig is not evidence of unattended signing support.

## Working in this repository

- Use a focused branch/PR for implementation; avoid overwriting other workstreams.
  Follow the user's actual merge instructions; do not infer perpetual permission
  to merge future work from this document.
- Keep this tracked context in `AGENTS.md`, `SESSION_START.md` and `docs/` files
  listed above. The repository guard rejects tracked `CLAUDE.md`, `CLAUDE.local.md`,
  `CONTEXT.md`, `.scratch/`, `docs/agents/`, `docs/adr/`, and non-example env files.
- Use Node 22 and the repository's pinned pnpm version for TypeScript work;
  Python 3.11+ for team onboarding and the independent MCP gateway. Open WebUI
  replaces the legacy Python Qwen chat/model CLI. See docs/open-webui.md. Do not commit local virtualenvs, checkpoints or private state.
- Run checks appropriate to your changes. Typical commands:

  ```bash
  pnpm typecheck
  pnpm test
  python -m unittest discover -s tests -v
  python -m unittest discover -s mcp_gateway -p 'test_*.py' -v
  sh scripts/check-tracked-paths.sh
  ```

- State whether evidence is from source inspection, simulated tests, a live local
  process, the live model, or a validated ledger transaction. Never promote one
  evidence level into another.
- When behavior or readiness changes, update the relevant requirement/spec and
  the status snapshot with the exact change and evidence. End a substantial
  session with what changed, validation, unresolved gaps and the next concrete
  step. Do not put secrets or raw private session transcripts into handoff files.

For a general chat client that does not automatically read AGENTS.md, paste
`SESSION_START.md` and provide the linked files. Repository files do not load
themselves into every LLM product.
