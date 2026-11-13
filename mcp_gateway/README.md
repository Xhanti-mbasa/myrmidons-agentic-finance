# Shucamoxa MCP gateway

Five tools, one MCP server, no wallet keys. This is a runnable adapter, not an XRPL payment backend. Backend integration remains unverified until a compatible backend is available.

## Run

Python 3.11+:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r mcp_gateway/requirements.txt
export SHUCAMOXA_BACKEND_URL=http://127.0.0.1:8080
export SHUCAMOXA_BACKEND_TOKEN='your-development-backend-token'
export SHUCAMOXA_BUSINESS_SCOPE='your-development-business-id'
.venv/bin/python mcp_gateway/server.py
```

The server speaks MCP over stdin/stdout; it does not display a chat prompt. Your agent harness must launch it using the MCP SDK's stdio client, discover tools, give their schemas to the model, execute selected calls and return results to the model. Ollama does not directly connect to MCP servers. `.env.example` is a configuration reference; this server does not auto-load dotenv files. Pass credentials through the subprocess environment and never commit real values.

## Proposed backend contract

Agree these routes with the backend developer before connecting. The server's bearer token identifies and scopes the business; neither model arguments nor the business-scope string grant authority.

| Tool | Backend route |
|---|---|
| get_mandate | GET /v1/mandate |
| get_balance | GET /v1/balance |
| get_invoice(invoice_id) | GET /v1/invoices/{invoice_id} |
| pay_invoice(invoice_id, reason) | POST /v1/invoices/{invoice_id}/payment |
| get_payment_status(invoice_id) | GET /v1/invoices/{invoice_id}/payment |

All responses are JSON objects. Monetary amounts must be decimal strings, not binary floating-point values. The invoice record holds its supplier, amount, asset and version. The backend resolves the approved supplier address; invoices or model text must not override it.

POST carries only `{"reason": "..."}` and a stable `Idempotency-Key` header derived from business scope and invoice ID. The backend must enforce uniqueness for the authenticated business/invoice, including concurrent calls, atomically reserve budgets, and reuse the original operation on a duplicate request. Invoice IDs are case-sensitive, immutable and never reused. Corrections require a new invoice ID. The backend must check invoice version and policy immediately before signing.

Payment responses should include `invoice_id`, `payment_id`, `status`, `code`, `reason`, and nullable `tx_hash`. Suggested statuses: `not_requested`, `blocked`, `pending`, `validated`, `failed`, `unknown`. A policy rejection is a normal 200 response with `status: blocked`. `validated` requires a validated ledger transaction with a successful transaction result; submission or a hash alone is insufficient. Backend errors must not include credentials, stack traces or private keys. Bound returned invoice text and treat it as untrusted data.

POST transport errors and unexpected HTTP responses produce an unknown outcome. Check status by invoice ID instead of blindly retrying. The adapter does not retry POST requests automatically.

## Security boundaries

The backend must authorize every call, independently enforce supplier/asset/spending rules and revocation, deduplicate payments, reserve budgets, sign and submit, reconcile validated outcomes and write audit records. Read tools and schema validation do not enforce spending authority. There are no tools for changing mandates, approving suppliers, arbitrary signing or executing shell commands. Tool annotations are hints, not authorization.

The model server and MCP gateway are different processes. Run this gateway in your development environment for now. If it later runs inside a restricted container, the backend address must be reachable under that container's network policy; add only the specific required route. Never disable isolation just to connect the backend. Remote non-loopback backends require HTTPS. Configure backend tokens for XRPL Testnet only during development.

## Validation

```bash
.venv/bin/python -m unittest discover -s mcp_gateway -p 'test_*.py' -v
```

Tests use simulated backend responses: they do not move funds or establish that a real backend implements the policy and idempotency contract.

## Stored transfer intents

The gateway also exposes `pay(intent_id)` -> `POST /transfers/pay` with
`{intentId}`, and `get_transfer_status(intent_id)` -> `GET /transfers/{intentId}`.
These use the new `services/payments/` coordinator and are not aliases for the
legacy invoice routes above. Configure a host that serves the needed routes;
no such host is started by launching this MCP subprocess. Owner creation of
intents, policy updates, recipient approval and unlock are never model tools.

An intent binds the approved source, recipient, RLUSD amount and optional
schedule outside the model. A timeout is unknown and is not retried. Wallet
and independent-policy adapters remain to be integrated; see
[the payment core guide](../services/payments/README.md).

For a transfer-only host, use `transfers.py` and
`config/mcp.transfers.example.json`. This low-level SDK server exposes only the
two transfer tools and rejects extra fields/invalid IDs before HTTP dispatch.
The integration test uses a real MCP subprocess and a scripted HTTP backend.
