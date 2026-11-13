# Open WebUI: local / teammate-hosted model workspace

Open WebUI replaces the old W3Node Python Ollama chat/model-profile experiment.
It provides a browser UI, model presets (agent title, description, system prompt),
conversation history, knowledge and integrations. It does **not** replace
`services/agent` (the guarded finance agent), `services/payments`, backend
policy, owner approvals, or signing. **No real payment is enabled by this install.**

## 1. Install and run

Prerequisites: Docker with Compose; one independently running OpenAI-compatible
LLM server or Ollama on your computer. There are no checked-in model weights.

```bash
cp deploy/open-webui.env.example .env
# Edit .env: use a unique WEBUI_SECRET_KEY from: openssl rand -hex 32
docker compose --env-file .env -f deploy/open-webui.compose.yml up -d
docker compose --env-file .env -f deploy/open-webui.compose.yml logs -f open-webui
```

Visit http://localhost:3000 and create the first admin account.
Signup is disabled for subsequent users. The UI binds localhost only.
Stop with `docker compose --env-file .env -f deploy/open-webui.compose.yml down`.
To delete its chat data separately (irreversible), use `down -v`.

## 2. Connect your own LLM

**Local Ollama:** install/start Ollama separately; run `ollama list` and pull
a model of your choice with `ollama pull MODEL_NAME`. Compose defaults to
`http://host.docker.internal:11434` (Docker host). On Linux, verify the host
daemon listens on a reachable interface for the Docker bridge, without exposing
unauthenticated Ollama to LAN/internet. Alternatively run both services in a
private Docker network and set `WEBUI_OLLAMA_URL` to the Ollama service name.

**Teammate's PC:** reach Ollama over an authenticated SSH tunnel or private VPN,
not a publicly exposed Ollama port. For an SSH tunnel on the Docker host,
forward local port 11435 to the teammate's Ollama 11434 and configure the
container-reachable tunnel endpoint accordingly. The repository's existing
`w3node users connect NAME` onboarding command can establish the team's
local 11435 tunnel. A tunnel bound only to 127.0.0.1 cannot be accessed from
a bridge container through host.docker.internal; use a private-network
deployment/proxy explicitly rather than opening 11434 to the public.

**OpenAI-compatible hosted endpoint:** in Open WebUI admin settings add an
OpenAI-compatible connection with the provider's base URL and API key.
Keep keys in the UI's private storage; never commit them. Ollama uses its
`/v1` base URL for the TypeScript agent, but the Open WebUI Ollama
connection uses the origin *without* `/v1`.

## 3. Create agents

In Open WebUI Workspace > Models, create a model preset. Provide title,
description, a strict system prompt and whichever tools are permitted.
Select the connected base model. Repeat for security/development/finance.
Prompts are **not security boundaries**: never give the general WebUI process
wallet keys, signer credentials, or unrestricted payment-write tools.

## 4. Preserve the existing finance agent interface

`services/agent/src/model.ts` uses the OpenAI-compatible
`MODEL_BASE_URL`, `MODEL_NAME`, and optional `MODEL_API_KEY`.
Configure `services/agent/.env` independently:

```dotenv
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_NAME=YOUR_INSTALLED_MODEL
MODEL_API_KEY=
```

The TypeScript finance agent connects **directly** to the inference server,
not to the Open WebUI chat endpoint. Open WebUI and the finance agent may share
the same upstream model, but they do not share prompts or authorization.
Keep `BACKEND_URL` and `AGENT_BACKEND_TOKEN` as the agent's separate
backend credentials. The payment teammate's server contract must be integrated
and tested before any live Testnet payment claim.

## 5. MCP and payment safety

Open WebUI supports MCP integrations; add compatible authenticated MCP HTTP
servers through its admin/tool settings. The existing `mcp_gateway/server.py`
is a **stdio** MCP server and uses a different API than the TypeScript agent.
It is intentionally **not connected automatically**, because it includes
payment-write methods. An explicit reviewed adapter, access control,
and the backend's independent mandate/approval checks are required before
exposing payment tools to any UI.

## 6. Remove old local Ollama assets (optional, destructive)

After ensuring the model tag is no longer shared or needed:
```bash
ollama list
ollama rm qwen3:1.7b-q4_K_M
# inspect any custom 'w3node-*' names first; remove ONLY those belonging to this experiment
```
Never delete the entire Ollama data directory or Docker volumes shared
with other apps. Removing tracked files in Git does not delete teammates'
local caches/models. This cleanup requires each device owner's action.

## Checks

```bash
docker compose --env-file .env -f deploy/open-webui.compose.yml config -q
python -m unittest discover -s tests -v
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test
```
