# Shucamoxa tool picker: actual integration status

Open WebUI is a separate general-purpose chat harness. Shucamoxa is the independent policy and capability host; replacing all of Open WebUI is **not** required to use its existing tool menu.

## One-command diagnostic

From the repository root, once the demo has started and the administrator has completed registration:

```sh
python3 scripts/check-webui-tool-discovery.py
```

It checks local HTTP health, the advertised OpenAPI operations, Open WebUI's global external-tool registration, and whether the finance preset references `server:shucamoxa`. It prints no credentials, does not modify the installation, and reports failures nonzero. It cannot prove a model made a tool call; inspect the actual tool-call trace in a fresh finance chat.

The default WebUI installer registers one **OpenAPI tool server** with the fixed ID `shucamoxa`. The server advertises multiple operations. Open WebUI's chat Tools selector and Workspace/Models model attachment are separate presentation and permission layers. Individual operation toggles are not implemented in this repo. A server being registered is not evidence that the chat UI shows its operations or that a local model can invoke them.

## Current boundaries

- **Core:** payment via immutable pre-authorized transfer intents, policy, eligibility, and audit. No arbitrary payee, amount, or destination may come from the model.
- **Optional:** workflows and simulated bridge quotes are controlled by owner-only policy, not by chat/tool switches. Disabled calls fail at execution even when their old schemas remain in a cached client.
- **Missing from this harness API:** wallet balances, payee discovery, payee proposal, owner approval workflow, free-form intent preparation and real bridge execution. The older MCP invoice gateway has other methods under incompatible backends and is not automatically exposed by the WebUI OpenAPI connector.
- **Proof:** a tool-call trace, the returned structured outcome, and the harness audit record. Testnet blockchain payment needs actual validated ledger evidence. The demo is simulated.

## Product direction

A ChatGPT-like individual-tool switcher should be implemented as a **capability registry** with per-tool metadata, discoverability, user preference and independent owner authorization. User-side toggles can hide or request tools but **must never** grant a financial capability. Avoid modifying upstream WebUI internals until an end-to-end UI/tool integration test confirms its native selector cannot provide the required user experience. Maintain a separate patch/fork if customization proves necessary.

## Reproduction / acceptance

1. Start: `sh scripts/start-harness-demo.sh` (finish the private WebUI administrator login).
2. Run the diagnostic; ensure the server and preset are present.
3. Open the finance preset in a fresh chat and inspect **+ → Tools**.
4. Invoke `get_capabilities`; verify real tool-call execution, not a plausible answer.
5. Invoke an approved simulated payment and an above-cap payment. Expect a simulated settled result and a strict refusal respectively. Verify records in `http://localhost:8091`.
6. In the owner console disable the bridge extension, then try a stale bridge call. It must fail at the harness even if the client still advertises it.

Do not mark the integration complete until steps 3–6 are observed on the operator's machine.
