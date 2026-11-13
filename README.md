# Myrmidons Agentic Finance / W3Node

Shared agent schemas, invoice-agent development, and team tooling for the existing model instance.

## Start a new LLM session

Read [AGENTS.md](AGENTS.md), the [product requirements](docs/PRD.md),
[technical specification](docs/TECHNICAL_SPEC.md), and
[current implementation status](docs/PROJECT_STATUS.md) before working on the product.
For a chat client without automatic repository context, use [SESSION_START.md](SESSION_START.md).
The PRD is a draft baseline; implementation status is evidence-based and dated.

## Team onboarding and model tooling

For interactive model chat, local MCP setup, and editing model profiles/weights from
VS Code, start with [the terminal/MCP walkthrough](docs/local-mcp-chat.md).

* `w3node users add NAME`: generate/reuse a local SSH key and submit an onboarding request.
* `w3node users connect NAME`: connect to the container with the Ollama tunnel.
* `w3node admin sync`: provision preapproved GitHub identities and email Tailscale device invites.
* `w3node model pin/pull`: version model component references and selectively download verified artifacts.

See [onboarding](docs/onboarding.md) for installation and one-time server configuration, and
[model/team workflow](docs/team-workflow.md) for artifact versioning. The shared container,
`shucamoxa-dev`, runs Ollama with `qwen3:1.7b-q4_K_M`. Automated onboarding still requires
an administrator to install the sync, configure the member allowlist and supply private credentials.

## Develop

Requires Node 22 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm typecheck
pnpm test
```

`services/agent/TESTING.md` explains how the agent tests work: a scripted hostile model and a fake backend that records every request.

## CI

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. It has two jobs:

- **test**: fails if git tracks an env file other than `.env.example`, or a local-only path (`CLAUDE.md`, `CLAUDE.local.md`, `CONTEXT.md`, `.scratch/`, `docs/agents/`, `docs/adr/`). Then it runs `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`.
- **secrets**: downloads the official gitleaks release, checks its SHA-256, confirms `.gitleaks.toml` catches a fake XRPL seed, then scans the full git history of the commit under test (which includes `main`).

The workflow token is read-only and every action is pinned to a commit SHA.

## Secret scanning

Never commit a seed, private key, token or database URL. Each service keeps its secrets in its own `.env`, which git ignores.

`.gitleaks.toml` adds three rules to gitleaks' defaults:

- XRPL family seeds (`s` plus 28 to 30 base58 characters)
- XRPL hex private keys (`ED` or `00` plus 64 hex characters)
- bare 64-hex keys. A line that says `hash`, `digest`, `sha256` or `checksum` is let through, so transaction hashes don't fail the scan.

The only allowlist covers the two documented fake seeds in `services/agent/test/config.test.ts`. If your test needs a fake seed, build it at runtime (see `scripts/test/gitleaks-config.test.ts`). Don't add a file to the allowlist.

### Pre-commit hook

`pnpm install` runs `git config core.hooksPath .githooks`, which turns on `.githooks/pre-commit`. On every commit the hook:

1. refuses staged env files and local-only paths (it needs only git), and
2. runs `gitleaks git --staged --redact` on the staged changes if gitleaks is installed. If gitleaks is missing, it prints a one-line warning and lets the commit through.

Install gitleaks 8.19 or later so the hook can scan:

```bash
brew install gitleaks                 # macOS or Linux with Homebrew
# or download a release binary from https://github.com/gitleaks/gitleaks/releases and put it on your PATH
gitleaks version
```

To scan the whole history yourself, run `gitleaks git --config .gitleaks.toml --redact --no-banner .`.

`git commit --no-verify` skips the hook, but CI runs the same checks on the pull request.

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
