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
