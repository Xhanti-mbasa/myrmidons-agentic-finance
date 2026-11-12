# Myrmidons Agentic Finance / W3Node

Team tooling for an existing Linux model instance and versioned model components.

* `w3node users add NAME`: create/reuse a local key and submit an onboarding request.
* `w3node users connect NAME`: SSH into the container with the Ollama tunnel.
* `w3node admin sync`: provision preapproved GitHub identities and email Tailscale device invites.
* `w3node admin users inspect/add/remove`: low-level server administrator commands.
* `w3node model pin/pull`: checksum-pinned component manifests and selective downloads.
* MCP server configuration template for subsequent agent-runtime integration.

Read [onboarding](docs/onboarding.md) for the one-command teammate flow and one-time
server setup, and [model/team workflow](docs/team-workflow.md) for model artifacts.
The existing instance is an Incus Ubuntu container, `shucamoxa-dev`, with Ollama
serving `qwen3:1.7b-q4_K_M`. The server sync still needs installation, an explicit
member allowlist and private GitHub/Tailscale credentials before automation is live.
The finance application, training pipeline and MCP client are not implemented here.
