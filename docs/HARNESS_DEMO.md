# Shucamoxa harness and demo

13 November 2026. Build on `work/harness-open-webui-demo`. This integration includes
the payment workstream plus main's current guarded agent/SSE code. It adds a
model-independent capability host around the existing payment services.

## Start the demo

Use Node 22 and pnpm 10.28.0. No wallet, faucet, model download or funds are needed
for the standalone console. This mode is explicitly **simulated**.

```sh
pnpm install --frozen-lockfile
pnpm harness:demo
```

Open http://localhost:8091. The command prints the **path**, not the contents, of
the private owner token. Read that file locally and paste its token only into
the console's owner login. The token stays in tab memory. The model gets a
separate agent token; never paste owner credentials into chat.

The console offers an allowed 30.00 RLUSD transfer, above-cap 75.00 transfer
(cap 50.00, total budget 200.00), expired eligibility, a research article purchase,
a bridge-route fixture, workflows and audit export. Transfers use the real SQLite
coordinator with a simulated signer/ledger. Purchases use the real durable x402
and weekly category budget coordinators with simulated settlement/delivery. The
article costs a fixture 0.005 RLUSD at a fixture 20 ZAR/RLUSD, consuming the fixture
0.10 ZAR weekly research budget. These are not current exchange rates. The article
contains local sample text. No external publisher or blockchain is contacted.

State and decisions survive restart. Repeated intent/resource IDs remain tied to
the original payment or purchase. A workflow ID executes once; repeats recover
its stored result. To rehearse a completely fresh demo, use a **new** state directory:
`pnpm harness:demo /absolute/new/private-directory`. Existing state is not erased.
Demo grants/intents expire seven days after first setup.

## Open WebUI with the tools already registered

Docker + Compose run both services; Python 3.11+ and an independently running
local Ollama are required. No host Node installation is needed for Docker startup. The script preserves existing WebUI history and private configuration.

```sh
sh scripts/start-harness-demo.sh --rebuild
# Later starts reuse images, private credentials, policies and chat history:
sh scripts/start-harness-demo.sh
```

Open http://localhost:3000 and create/sign into the admin account. Connect your
installed model in WebUI as described in `open-webui.md`. The launcher now handles registration automatically: it uses your normal WebUI
admin login privately on first use, and reuses a 0600 session file outside the
harness mount on later starts. It does not require copying an API key. It also
fixes the Linux container-to-host loopback connection, verifies model discovery,
and applies a short-response/no-thinking finance preset. Use `--no-fast` to
preserve existing inference settings. On a first-ever WebUI install, run with
`--containers-only`, create the admin account, then rerun normally.

The standalone manual registration command remains available (replace the model ID):

```sh
python3 scripts/setup-webui-harness.py --base-model YOUR_INSTALLED_MODEL
```

The script prompts privately for an Open WebUI admin API key or session token.
It adds a global OpenAPI connection reachable inside Docker as
`http://harness:8091`, installs the `Shucamoxa · Governed Finance` preset with
native tool calling, and assigns only the harness **agent** token. Unrelated tool
connections and an existing model preset are preserved. No credential is logged
or committed. The WebUI admin key is used for installation only.

For a host-native WebUI, pass `--harness-url http://127.0.0.1:8091`; also pass
`--agent-token-file` with the standalone demo's private `agent.token` path. For a
Docker WebUI with a host-native harness, explicitly configure private host
reachability; a container cannot reach the host's loopback via host.docker.internal.

For a reproducible 12-scenario local HTTP check, plugin locations, manual
chat prompts and performance troubleshooting, see [DEMO_TEST_GUIDE.md](DEMO_TEST_GUIDE.md).

The registration script targets the current official `/api/v1/configs/tool_servers`
and `/api/v1/models/create` APIs. If your WebUI version differs, add the server
through Admin Settings > External Tools/OpenAPI: base URL `http://harness:8091`,
path `openapi.json`, Bearer **agent** token. Attach `server:shucamoxa` to the model
preset and use `config/harness-system-prompt.txt`. Chat model performance and
native tool support still depend on the selected upstream model.

OpenAPI exposes only `/tools/*`, never owner routes. Plugin toggles take effect
at execution even if WebUI cached an older schema. Refresh the connection to
update discovery after disabling or enabling optional plugins.

## Tool inventory

| Core or extension | Operations | Enforcement |
|---|---|---|
| Payment (core) | `pay`, transfer status, purchase/reconcile/read | Immutable stored IDs; strict schema; backend independently owns budgets, recipient binding, signing and ledger verification. |
| Policy (core) | `get_policy`, `policy_check` | Owner versioned policy; kill switch and category/target checks before dispatch; backend rechecks before financial execution. |
| Eligibility (core) | `compliance_check` | Owner evidence reference, eligible flag, expiry and category. This is an eligibility gate, not automated legal/AML/sanctions/KYC certification. |
| Audit (embedded core) | `get_audit_log` | Verify full local chain before dispatch; append request and outcome. Missing/tampered chain blocks dispatch. Core has no disable/remove tool. |
| Automated flows (optional) | `run_flow` | Owner finite presets, durable single execution claim, gates on every step, stop on unknown/pending/refused outcomes. |
| Bridge routing (optional) | `bridge_quote` | Owner route ID and eligibility. Demo returns an explicitly simulated indicative route. Testnet mode reports provider unavailable. No cross-chain execution. |

`get_capabilities` lists installed capabilities and registered IDs without wallet
addresses or secrets. Both OpenAPI and `mcp_gateway/harness.py` use the same host,
schemas and checks. `config/mcp.harness.example.json` is the stdio MCP template.
No arbitrary third party code, URLs or MCP server is loaded by a model argument.
Business connectors can be installed in reviewed code behind this fixed-ID
interface. A claimed community trust label is not an approval or code audit.

## Testnet mode

Start with `config/harness.host.example.json`, kept in a private 0600 file outside
Git. Provision distinct harness owner, harness agent, backend agent tokens and
0700 state. Configure the existing trusted transfer and/or purchase backend
origins; the harness stores only their scoped agent credentials, never signing
seeds or backend owner tokens.

```sh
pnpm harness:start --config /private/harness.json
```

The initial policy is disabled with no grants. Register existing owner-authorized
intent/resource IDs and reviewed eligibility evidence through the owner console.
The host cannot create backend authority, approve recipients, replenish budgets
or manufacture a funded wallet. The adapters explicitly preserve the separate
`/transfers/*` and `/purchases/*` contracts; they do not point the legacy `/v1`
invoice MCP gateway at an incompatible service. See `PAYMENT_INTEGRATION.md` for
the actual purchase-host and guarded transfer-wallet setup.

The console's pause prevents **new harness dispatches**. It cannot recall an
already dispatched/signed transaction. The payment backend's owner kill switch
must be used to revoke new signing authority. Every backend retains its own
policy/revocation checks and reconciliation identity. A policy preflight is not
a promise that subsequent signing will be allowed.

## Demo sequence (about three minutes)

1. In WebUI: “List your registered targets and tell me your evidence mode.”
2. “Pay the allowed supplier.” Show the simulated result and duplicate behavior.
3. “Pay the above-cap invoice.” Show `OVER_PER_PAYMENT_CAP` from the actual
   transfer coordinator, then show expired eligibility stopping earlier.
4. Pause actions in the owner console. Ask again: `KILL_SWITCH_ON`. Resume.
5. Disable bridge routing. A stale/manual call still returns `PLUGIN_DISABLED`.
   Enable it and show the quote labelled simulation with execution disabled.
6. Run the university research flow. Show the purchase ID and read local content.
   Repeat the flow: its stored result returns without a second purchase.
7. Verify/export the audit chain and independently retain its head.

The optional bridge is a routing demonstration, not a working Monero/fiat/EVM
bridge. Native Chrome/Firefox autonomous purchasing is not installed. Both
browsers can open WebUI; licensed content access still requires an integrated
publisher and backend settlement. No claim of legal, university or Sharia
certification, production isolation, or an “airtight” harness follows from tests.

## Validation and remaining release evidence

TypeScript checks and tests cover role separation, strict tool arguments,
eligibility/expiry/category blocks, mandatory audit integrity, persisted toggles,
workflow concurrency/restart/revocation, unknown outcomes and real coordinator
cap/dedup behavior in simulation. Python verifies actual MCP subprocess discovery
and forwarding plus WebUI installer preservation behavior.

Source and a local HTTP process are different evidence levels from deployment
on the owner's PC, live model tool use or validated Testnet RLUSD settlement.
This build environment has no Docker daemon or connected owner PC/WebUI admin
session. Registration and deployment on that PC therefore remain operator steps.
Funded dedicated wallets, approved HTTPS merchant, fresh reviewed quote,
independent signer/OS deployment, real success/block evidence and final on-ledger
signing topology remain the payment release gates described in
`PAYMENT_INTEGRATION.md`. Existing audited vulnerabilities remain open.

Official integration references inspected:
- https://docs.openwebui.com/features/extensibility/plugin/tools/openapi-servers/open-webui/
- https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/configs.py
- https://github.com/open-webui/open-webui/blob/main/backend/open_webui/utils/tools.py
- https://github.com/open-webui/open-webui/blob/main/backend/open_webui/models/models.py
