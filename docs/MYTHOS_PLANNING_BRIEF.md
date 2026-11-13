# Mythos planning brief: Shucamoxa on Open WebUI

Owner request, 13 November 2026, Africa/Johannesburg. **Planning input, not an
approved implementation plan.** Mythos is to propose the plan first. Sol/Opus or
an explicitly coordinated agent swarm may implement the accepted plan afterward.
Do not start the WebUI rewrite from this brief alone.

## What the owner wants

Make Open WebUI the main application shell for Shucamoxa: a finance assistant
whose inference model can be replaced while payment authority remains controlled
outside the model. One startup command should bring up a coherent, discoverable
demonstration. A presenter should not need to assemble credentials, tool servers,
network overrides, model presets and separate commands during the presentation.

The owner is not asking for another general chat clone or a claim that an LLM
cannot make mistakes. The user-facing experience should clearly connect:

- Organization-specific assistant instructions and owner configuration.
- Approved tools/functions, with accurate installed/enabled states.
- Connected payment backend/account status and available payment operations.
- Mandates, allowed suppliers, amounts, budgets, eligibility evidence and approvals.
- Payment requests, scheduling, status/history and audit evidence.
- Model selection, responsive streamed chat and visible action outcomes.
- A short guided demonstration with allowed and refused scenarios.

Firefox/Chrome sidebar extensions remain a later feature. Existing optional
bridge quotes are not cross-chain payment execution. Do not let extra features
displace the grounded payment/history/scheduling baseline.

## Read and inspect before proposing the plan

Read AGENTS.md and its linked requirements/spec/status/governance/handoff docs.
Then inspect source and tests, including:

- `deploy/open-webui.compose.yml`, `deploy/harness.Dockerfile`.
- `scripts/start-local-demo.py`, `scripts/start-harness-demo.sh`,
  `scripts/setup-webui-harness.py`, `config/harness-system-prompt.txt`.
- `services/backend/src/harness/{main,http,core,demo,adapters,ui}.ts`.
- `services/agent`, `services/payments`, `services/payment`, `services/policy`,
  `packages/shared`, `packages/db`, and the MCP gateways. Singular/plural payment
  directories and invoice/transfer/purchase contracts are not interchangeable.
- `docs/HARNESS_DEMO.md`, `docs/DEMO_TEST_GUIDE.md`,
  `docs/PAYMENT_INTEGRATION.md`, `SECURITY_ASSESSMENT.md`, `docs/AUDIT_COLLAB.md`.
- All current relevant branches and the actual pinned Open WebUI upstream source,
  license, branding/distribution terms and security advisories.

Repository snapshot at brief preparation: `main@ecabd27` (full SHA
`ecabd270cf384d0166d0b200879e045de8af64a5`). Re-check main before planning;
this is not a guarantee that the repository or deployment stayed unchanged.
The user's running WebUI reported version 0.13.3; Compose still references the
mutable `:main` image. Pin and verify the actual version before reasoning from
upstream defaults or adding a patch.

## Current evidence and unresolved problems

The current launcher provisions missing local files, repairs Linux loopback
reachability, waits for health, registers a finance preset and harness tools,
reuses a private WebUI admin session, and attempts model warmup. It has optional
owner-token rotation. Session credentials are outside the harness state mount;
passwords are not retained. It still needs verification as a complete workflow
on the user's machine and needs clearer onboarding/presentation behavior.

The harness has payment/policy/eligibility/audit primitives, optional automation
and bridge routing, an owner console, OpenAPI tools and stdio MCP. Its default
demo runs the real durable coordinators with **simulated settlement/content**.
`pnpm demo:check` exercises twelve isolated scenario groups through actual local
HTTP. This does not establish real XRPL settlement, real publisher delivery,
complete on-chain history, production isolation or scheduled-worker deployment.
Substantial payment/policy/wallet code now exists: inspect it rather than rebuild
it from earlier status tables. Its deployment and ledger evidence remain separate.

### Confirmed model/tool problem (UI-01)

A user-supplied WebUI transcript shows the model entertaining a fake developer/
admin exemption, then successfully invoking `create_tasks` and `update_task`.
Those are unrelated WebUI tools, not the finance harness. A Python environment-
read string sent to a task tool returned an argument error; Python execution,
secret disclosure, persistent effects outside the chat and a payment bypass
were not demonstrated.

Upstream WebUI 0.13.3 defaults built-in tool injection to enabled for native
function calling. Mitigation `7837bb6` disables `meta.capabilities.builtin_tools`
and auxiliary execution capabilities and limits the finance preset's tool IDs
to `server:shucamoxa`, including repair of older presets. `ecabd27` records the
stronger transcript evidence. **Fresh-chat tool discovery and replay on the
user's running WebUI remain unverified; UI-01 is not closed.** A preset flag is
not an independent backend authorization boundary.

### Reported latency problem

The same small local Qwen model appears faster in terminal chat than in WebUI.
The user observed long thinking and repeated irrelevant tool attempts. There is
no controlled benchmark proving the relative contribution of context size,
thinking, tool schemas, repeated generations, cold loading, rendering, streaming,
or CPU/GPU placement. Do not attribute all delay to local hosting or declare a
particular parameter set optimal without evidence.

Current fast defaults: thinking off, temperature 0, 512 output tokens, 8192
context, 30-minute keep-alive. They are a starting profile, not a validated optimum.
The user wants stream/delta/chunk/custom parameters standardized and effective;
the plan must establish which parameters actually reach each provider and which
only affect display. Short token budgets must not silently truncate tool calls.

### Discoverability and governance problem

The owner cannot easily find account/backend connection status, payment flows,
all installed tools/functions, optional plugin controls or organization policy.
Much of the existing owner configuration is in a separate console or JSON.
Make this accessible from WebUI and demonstrate actual policy decisions. A
business-profile label or a system prompt does not enforce a financial rule or
establish legal, AML or Sharia approval. The earlier weighted 40% estimate is a
historical snapshot and must not be reused as current readiness.

## Questions Mythos must resolve

### 1. WebUI customization boundary

Compare configuration, supported extensions, a small maintained patch and a
versioned fork. Recommend the smallest approach that meets the owner experience
and server-side safeguards, with concrete upstream paths/APIs and tradeoffs.
Open WebUI is the main shell; identify how finance navigation, owner controls,
account status and guided scenarios appear there. Preserve updateability and
explicitly distinguish chat from owner-only authorization.

### 2. Threat model and enforcement

Map the actual identities, capabilities, secrets and trust boundaries. Define a
server-side allowed tool registry for the finance experience; prevent implicit
built-ins or arbitrary tools from bypassing it. Test direct service calls,
forged role claims, untrusted invoices/tool output and extra parameters. A prompt
or hidden UI control is not an authorization mechanism. Keep independent policy,
signing, exact money, idempotency, unknown-outcome reservations, audit gates and
owner revocation intact. Explain what an authenticated owner/admin can still do.

The system prompt is public configuration and must contain no secrets. Make
untrusted source text unable to grant authority. Do not claim generic jailbreak
immunity from refusing one sentence or switching to a stronger model.

### 3. Organizations, prompts and locking

Define which settings are organization-specific narrative instructions, which
are enforceable owner mandates, and which are platform security invariants.
Specify authenticated editing, versioning, audit and locking/activation after
onboarding. Ordinary chat/users must not change locked settings; legitimate
owner changes need a deliberate, testable workflow. State the tenant scope and
avoid assuming full multi-tenant isolation if it does not exist.

### 4. Model portability without a surprise bill

Default to existing local inference with no automatic model download or paid
fallback. Propose an optional stronger hosted demo model through a supported
provider, with explicit operator credentials and current verified free-tier/
quota/tool-calling/privacy conditions. Free consumer ChatGPT/Claude access is not
assumed to grant a free API. Never invent free access to a named model.

Show how local and hosted selections use the SAME scoped tools and independent
financial controls. Provider credentials never enter model prompts, agent tool
arguments or Git. Set explicit behavior for exhausted quotas/unavailability;
no automatic paid fallback. Use only synthetic demo data with providers whose
free-tier terms may permit retention/training. Compare model behavior and
backend controls as separate properties.

### 5. Performance measurement and parameters

Propose reproducible comparisons on the owner's hardware: same model/prompt,
terminal vs WebUI/API, cold/warm, thinking on/off, no tools vs scoped tools,
short/long history and controlled generation settings. Report time to first
visible token, prompt-evaluation time, generation rate, total answer time,
number of model/tool iterations and error/truncation rates. Do not store private
chat bodies or credentials in benchmark artifacts.

Keep streaming enabled where supported and explain chunk/display tradeoffs.
Define conservative per-provider profiles and bounds on run time/tool loops.
Neither performance tuning nor benchmarks may weaken financial validation or
retry a payment under a replacement identity. No latency promise until measured.

### 6. Payments and account/backend visibility

Design an obvious account/backend readiness view and payment journey. Show the
actual evidence mode, what is connected, asset/network, funding/trustline status
where genuinely queried, pending/unknown outcomes and next required setup.
Never show a generated demo address as a funded connected wallet. Decide how
the real Testnet configuration is provisioned without routing signer seeds or
backend owner tokens through WebUI/model context. If external funding/account
approval is required, expose that prerequisite honestly rather than fake it.

Map one-time payments, scheduling/cancel/status, ledger/payment history, policy
refusal, owner approval/revocation, purchase content and audit export to real
existing endpoints or explicit implementation tickets. Keep full ledger history
separate from a local outgoing/audit list. Explain submitted transaction limits
of the kill switch and issuer-controlled RLUSD residual risk.

### 7. One-command demonstration

Specify a cold setup, first authenticated onboarding, subsequent startup,
health checks, model selection, tool registration, safe credential handling,
state preservation and recovery from failure. Do not silently erase databases,
chat volumes, policies, keys or unresolved payments to make the demo green.
Avoid repeating manual console/token/network steps during a presentation.
Opening a browser must never itself dispatch a payment.

Design a guided sequence with visible expected outcomes and evidence links:
allowed payment, duplicate recovery, over-cap block, expired evidence, pause,
plugin off/on, approved workflow/purchase content, history and audit. Add
scheduling and actual Testnet checks only when their real dependencies are met.
Provide a clearly labelled offline/simulated path when external services fail.

## Required planner output

Return an actionable plan, not implementation code:

1. Source-checked gap table: existing, partial, missing, evidence still required.
2. Recommended WebUI customization boundary and version/license strategy.
3. Architecture/dataflow and explicit server-side security invariants.
4. Screen/navigation and first-run/demo journeys, including owner vs chat roles.
5. Model/provider/parameter matrix, current free-option evidence and benchmark plan.
6. Ordered milestones with acceptance criteria, exact files/APIs and dependencies.
7. Tickets assigned around Xhanti (MCP/tools/UI), Cameron (AI), Tran (payments),
   with implementation/review responsibilities and unresolved decisions surfaced.
8. Agent execution plan for Sol/Opus or a swarm: isolated ownership, shared
   contract freeze, integration order, independent review and stopping conditions.
   Do not assign multiple agents to edit the same file without coordination.
9. Verification matrix: simulated unit tests, real local services, actual WebUI/
   model run, and fresh-wallet validated XRPL Testnet evidence kept distinct.
10. Rollback/update plan and the short pitch claim justified by the final evidence.

Mark open questions explicitly. Do not use guessed percentages or schedules.
The plan must be available for review before implementation begins. This brief
does not authorize Mainnet, real funds, paid services, repository-setting changes,
secret exposure or disabling independent controls. The existing collaboration
instruction permits direct pushes for authorized implementation without opening
new PRs; preserve concurrent work and the actual owner directions.
