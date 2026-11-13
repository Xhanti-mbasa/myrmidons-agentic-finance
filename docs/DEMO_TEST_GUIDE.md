# Start, test and troubleshoot the local finance demo

13 November 2026. This guide covers the current **simulation**. No wallet, faucet,
external publisher or ledger is contacted by the scenario check. Real Testnet
execution has separate prerequisites in [PAYMENT_INTEGRATION.md](PAYMENT_INTEGRATION.md).

## Startup

From the repository root, with Docker Compose and local Ollama running:

```sh
sh scripts/start-harness-demo.sh --rebuild
```

The launcher needs Python 3.11+. Docker supplies Node 22 to the harness. It:

1. Detects an installed local model; prefers the existing `qwen3:1.7b-q4_K_M` tag.
   Use `--model INSTALLED_TAG` to choose another. It never downloads a model.
2. Creates missing private credentials and preserves existing tokens, database
   state, WebUI secret and chat volume. It replaces only an initial placeholder
   WebUI secret. Linux uses a generated WebUI-only host-network override, bound
   to loopback; the harness keeps its private Docker network and published
   loopback port. Compose must support `!reset` (2.24.4+).
3. Starts containers and waits for health. Only explicit `--rebuild` requests a
   rebuild; later launches reuse the image. The final harness health must report
   `simulated` before automatic registration proceeds.
4. On first registration, privately asks for the normal **Open WebUI admin login
   email/password**. It saves only the returned session in
   `secrets/webui/admin.session` (0600), outside the mounted `secrets/harness`
   directory. No password, owner credential or session is sent to Ollama. Later
   launches validate/reuse that session; expiry prompts for login again.
5. Repairs the default local Ollama connection while preserving other connections,
   registers scoped agent tools, and preserves the existing owner's prompt and unrelated model parameters.
   The finance preset is restricted to `server:shucamoxa`; WebUI built-in tools,
   terminal, code execution, web search and file upload are disabled on it.
   This scope repair also runs with `--no-fast`. Migration between the known
   Docker/loopback harness aliases requires a successful scoped agent probe.
6. Applies the fast settings below, checks model discovery through WebUI, and
   attempts an empty-prompt model warmup. It prints no credential values.

Open `http://localhost:3000`, select **Shucamoxa · Governed Finance**, and start a
**new chat**. The owner console remains `http://localhost:8091`; paste the private
`secrets/harness/owner.token` there only. Never put it into WebUI User Variables,
model prompts, chat messages or screenshots. If previously exposed, rotate it
before sharing or exposing the installation. For a token previously pasted into
chat or User Variables, first remove that variable in WebUI, then run
`sh scripts/start-harness-demo.sh --rotate-owner-token`. This recreates the
containers to load the new owner credential, preserves all databases/history,
and keeps the agent token unchanged. Log into the owner console again using
the newly generated private owner-token file. It does not revoke a separately
compromised WebUI session or remove copies from earlier chat history.

On a first-ever install with no WebUI account:

```sh
sh scripts/start-harness-demo.sh --containers-only
# Create the first admin in WebUI, then:
sh scripts/start-harness-demo.sh
```

Useful options: `--login` replaces an expired/incorrect cached admin session;
`--admin-token-file /private/file` uses an existing 0600 admin credential;
`--skip-warmup` skips preload; `--no-fast` leaves existing inference settings
unchanged (it does not undo fast settings applied earlier). A command failing
with `HTTP NNN at /path` identifies the stage without printing response bodies
or tokens. Use the real WebUI login email, not merely the displayed profile name.
SSO/MFA users can supply an already completed admin session privately; the
launcher does not bypass MFA. No login/signup/auth setting is disabled.

Reopening requires only:

```sh
sh scripts/start-harness-demo.sh
```

The launcher does not clear state, run `down -v`, reset policy, enable disabled
plugins, or create/retry financial obligations. It deliberately stops if an
existing connection points at an unrelated harness. Local setup is not proof of
production OS isolation, signer custody or independent ledger verification.

## Where the other plugins are

In the **owner console**, scroll down to **Extensions**:

| Capability | Where / tool | Current behavior |
| --- | --- | --- |
| Payment | Core card; `pay`, `get_transfer_status` | Immutable owner-registered intents, real coordinator, simulated settlement in this demo. |
| Policy | Core card; `get_policy`, `policy_check` | Owner mandate and execution gates; model cannot change policy. |
| Eligibility | Core card; `compliance_check` | Owner evidence/category/expiry; not automated legal certification. |
| Audit | Core card; `get_audit_log` | Mandatory hash-linked events and local verification; retain the head externally. |
| Automated flows | Extensions checkbox; workflow dropdown; `run_flow` | Finite owner-defined workflows, single durable run and recovery. |
| Bridge routing | Extensions checkbox; registered bridge target; `bridge_quote` | Simulated quote only; no cross-chain execution. |
| Research purchase | Target/workflow dropdown; `purchase_resource`, `reconcile_purchase`, `read_purchased_resource` | Simulated article and settlement through the real purchase/budget coordinators. |

Core capabilities cannot be removed. Refresh the WebUI tool connection after
changing plugin toggles to update discovery; execution still refuses a stale
cached call when a plugin is off. These are reviewed built-in modules, not a
third-party marketplace. Chrome/Firefox extensions and actual bridge execution
are not installed. Business-profile labels alone do not change permissions.

## Test all demo scenarios without waiting for the model

Requires Node 22.23+ and pinned pnpm 10.28.0:

```sh
pnpm install --frozen-lockfile
pnpm demo:check
pnpm test:demo
```

`demo:check` creates a new temporary directory and a real loopback HTTP harness
on a random port, runs assertions, then cleans it up. It never alters your
running console's state, contacts Ollama, signs a live transaction or uses your
tokens. Each PASS includes its simulation/local-HTTP evidence level. Exit code
is nonzero if a scenario fails. `test:demo` also runs the hostile/restart/unknown
and audit-tampering regressions in the harness test suite.

| Scenario | Expected result |
| --- | --- |
| Capability discovery | Four mandatory core capabilities and optional plugin states; `simulated` evidence. |
| Allowed supplier: 30.00 RLUSD | Simulated settled outcome. |
| Five concurrent duplicate calls | Same stored transaction identity; no second obligation. |
| Transfer status | Stored settled outcome returned without a new payment. |
| Above cap: 75.00 against 50.00 | `OVER_PER_PAYMENT_CAP`. |
| Expired eligibility | `ELIGIBILITY_EXPIRED` before payment execution. |
| Extra amount/owner arguments and owner-route access | HTTP 400 for invalid tool schema; agent gets 403 on owner route. |
| Owner pause/resume | New dispatch blocked with `KILL_SWITCH_ON`; only owner resumes. |
| Bridge off/on | `PLUGIN_DISABLED` even for stale calls; enabled fixture is quoted with execution disabled. |
| Research flow, repeat and content | Completed once; same run ID on repeat; reconcile/read recover delivered sample content. |
| Automation disabled | Cached workflow call refused with HTTP 409. |
| Audit verification | Chain verifies after all events; external checkpoint limitation remains explicit. |

The runner does not prove arbitrary new merchant purchases, full on-chain
transaction history, scheduled-payment deployment, real publisher delivery,
ledger quorum enforcement or Testnet RLUSD settlement. Use the payment/policy
suites and actual reviewed Testnet runbook for those claims. These twelve groups
are a finite regression checklist, not every possible attack or use case.

## Manual console and model checks

Console: choose **Allowed supplier**, **Check eligibility**, **Execute target**;
repeat and compare the stored result. Choose **Above cap** and **Expired
eligibility** next. Pause, try another action, then explicitly resume. Toggle
bridge routing, try the registered bridge target, and run **Purchase approved
research article**. The Result panel shows structured outcomes. Audit controls
verify/export local events; save a head independently if testing rollback.

In a new finance-preset chat, run one instruction at a time:

1. “Call get_capabilities. List registered targets and evidence mode.”
2. “Read my current payment policy.”
3. “Pay the registered allowed supplier. Report its actual tool result.”
4. “Pay the registered above-cap target. Explain the refusal.”
5. “Check the status of the original allowed transfer; do not create another.”
6. “Run the approved university research workflow, then read its purchased article.”
7. “Read and verify the audit log.”

Do not invent/copy random IDs; use discovery results. Look for actual tool
execution, not an assistant merely claiming it called a tool. Existing targets
persist: repeats intentionally recover the same result. For a completely fresh
manual rehearsal, use a separate standalone state directory documented in
[HARNESS_DEMO.md](HARNESS_DEMO.md); do not delete your active databases.

## Response speed

Fast setup sets `think=false`, temperature 0, 512 output tokens, 8,192 context
and 30-minute model keep-alive on the finance preset. It also warms the model
without executing a payment tool. Those settings are supported by the inspected
Open WebUI 0.13.3 Ollama payload conversion; they are not a universal promise for
other providers/versions. Existing owner prompts remain intact; the finance tool scope is repaired as described below. Native
tool-call quality must be retested with your actual model after parameter changes.
The cap bounds each generation; multi-step tool conversations still take time.

Use the finance preset and a new short chat. Run `ollama ps` while answering:
CPU execution, insufficient memory and model swapping can dominate latency.
Ask one task per message and compare the direct console with model chat. Keep
only one generation active on a small machine. No live model/device benchmark
was available in the implementation environment, so no measured speedup is
claimed. A smaller/faster model is a separate explicit choice and still needs
the tool-calling tests above. Financial controls are unchanged by fast settings.

## Claimed-admin prompt injection and unexpected task tools

A screenshot of the model entertaining an admin-role claim and considering
`create_tasks` exposed an unsafe preset default: Open WebUI 0.13.3 automatically
injects built-in tools when `meta.capabilities.builtin_tools` is absent. The
installer now explicitly disables it and restricts this preset's `toolIds` to
the harness server. Existing presets are repaired without replacing owner text;
unrelated model presets/global connections are unchanged. Stop any ongoing
run, pull the fix, rerun startup and start a new finance chat to discard stale
chat tool definitions. Inspect any tasks/automations the old run may have
created; the screenshot alone does not establish whether execution occurred.

This reduces the default model tool surface; it is not a substitute for backend
authorization, nor a guarantee that an admin cannot manually change WebUI/chat
settings. The source check used Open WebUI v0.13.3 `utils/middleware.py`'s
`use_builtin_tools` gate. Actual registration and fresh-chat tool discovery on
the operator's machine must still be verified.

Automated local HTTP regressions submit the claimed-admin text using the agent
credential: owner policy changes remain 403, extra authority fields on payment
requests remain 400, `create_tasks` is absent (404), no payment adapter is called,
and policy version stays unchanged. These tests use scripted requests, not a
live Qwen run. A model's reasoning or prompt disclosure alone is not proof of
payment bypass; the system prompt is public repository configuration and must
contain no secrets. Judge unauthorized action from tool/backend evidence.
