# Myrmidons Agentic Finance / W3Node (Shucamoxa)

Owner-controlled agentic invoice payments with independent policies, shared
contracts, approvals, and an XRPL Testnet target. Payment execution remains
a separate team integration; the general chat UI must not authorize payments.

## Open WebUI workspace

The old custom Python Ollama/Qwen chat, model-build, model-lock, and local
sandbox-MCP experiment was removed. Replace it with a self-hosted Open WebUI
workspace and **your own selected local or remote model**. No default model
or weights are included.

**Quick start:** [Install, run, connect PC LLMs and use agents](docs/open-webui.md).

```bash
cp deploy/open-webui.env.example .env
# Replace WEBUI_SECRET_KEY using: openssl rand -hex 32
docker compose --env-file .env -f deploy/open-webui.compose.yml up -d
# Visit http://localhost:3000
```

Open WebUI is the agent workspace, while the guarded TypeScript agent continues
to use its own `MODEL_BASE_URL` and `MODEL_NAME` as defined in
`services/agent/.env.example`. Inference is interchangeable; mandates and
signing authority are not.

## Product and team development

Current source-checked work inventory: [implementation backlog and tickets](docs/IMPLEMENTATION_BACKLOG.md).

Read [AGENTS.md](AGENTS.md), [PRD](docs/PRD.md),
[technical specification](docs/TECHNICAL_SPEC.md), and
[implementation status](docs/PROJECT_STATUS.md).
Team SSH onboarding: [docs/onboarding.md](docs/onboarding.md).
The independent payment core: [services/payments/README.md](services/payments/README.md).
XRPL demos and the draft wallet adapter: [services/backend/README.md](services/backend/README.md).
Payment MCP gateway (not exposed to Open WebUI): [mcp_gateway/README.md](mcp_gateway/README.md).

Requires Node 22 and pnpm for finance services:

```bash
pnpm install
pnpm typecheck
pnpm test
```

No checkout/model installation grants payment authority. Never commit wallet
seeds, private keys, provider credentials, database URLs or local WebUI secrets.
CI and pre-commit checks are described in `.github/workflows/ci.yml` and
`.githooks/pre-commit`.

## Developer-only XRPL Testnet demonstration

With Node 22 and the pinned pnpm version, run `pnpm install --frozen-lockfile`
then `pnpm xrpl`. The command needs access to the official XRPL Testnet and
its faucet. It creates and funds two temporary in-memory wallets, signs a 1 XRP
payment locally, prints the hash before submitting, and checks the validated
ledger result and payment fields. Keys are discarded at exit. It uses test XRP,
not RLUSD, and is separate from the application payment endpoint.

If submission times out or fails, the outcome may be unknown: use the printed
hash and Testnet explorer to reconcile it; do not automatically send a new
payment. This single-wallet demo has no product policy or independent signer;
the later payment flow requires additional signing and policy controls.

## Assigned baseline plan

See the [team Kanban](docs/BASELINE_KANBAN.md), [progress and evidence review](docs/BASELINE_PROGRESS.md), and [interactive offline board](docs/planning/baseline-kanban.html). The review includes all remote branch heads and Cameron’s latest handoff uploads; percentages are dated planning estimates, not live readiness metrics.

## Developer-only Testnet RLUSD

Run with Node 22 and the pinned pnpm version:

```sh
pnpm xrpl:rlusd setup
pnpm xrpl:rlusd balances
pnpm xrpl:rlusd send
```

`setup` creates or reuses two wallets, funds their XRP reserves as needed and
confirms their official Testnet RLUSD trust lines. Request test RLUSD for the
printed sender address at https://tryrlusd.com/ before sending. `balances` reads
validated XRP and RLUSD balances; `send` submits exactly 1 RLUSD and checks the
validated transaction and delivered amount. This is isolated from the agent and
does not implement the product's independent signing or policy controls.

Wallet seeds and payment tracking are stored in the Git-ignored
`services/backend/wallets/` directory, restricted to the current user. Other
processes running under that same OS user may still access them; use a separate
backend identity for isolation. Never copy these files into the agent environment.
The command uses only the fixed Testnet endpoint. The pending payment record is
written before submission; if the outcome is unknown, a new send is blocked.
Run `send` again to check the same hash: a confirmed payment is recorded and the
command stops without sending again. For other outcomes, reconcile the hash and
expiry using validated ledger history before manually resolving the pending file;
never delete it merely because a timeout elapsed. An interrupted process can
leave `rlusd.lock`; after confirming no command is running, remove only that lock.
