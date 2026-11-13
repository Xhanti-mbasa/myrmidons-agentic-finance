# @shucamoxa/mock-backend

> **DEV ONLY. NEVER DEPLOY THIS.** It holds no keys, signs nothing and submits nothing to any ledger.
> It exists so the agent runs end to end before the real payment service (W3) and API (W4) exist.

It refuses to start unless `SHUCAMOXA_MOCK=1` (exactly) is set on the command line, refuses
`NODE_ENV=production`, and listens on `127.0.0.1` only (port `MOCK_PORT`, default 8787).

```sh
cp services/mock-backend/.env.example services/mock-backend/.env   # then set both tokens
pnpm dev:mock
```

## Routes

| Route | Token | What it does |
|---|---|---|
| `GET /rules` | agent | `Rules` from `fixtures/demo-rules.json` plus live spent and kill-switch state; no addresses |
| `GET /suppliers?q=` | agent | `SupplierLookup` by normalised token overlap (`supplierNameConfidence` in `@shucamoxa/shared`); a tie is capped at 0.5 |
| `POST /payments` | agent | Policy checks 1, 3, 7, 8, 9 in cents, serialised in process; idempotent on `invoiceNumber` |
| `POST /approvals` | agent | Appends to `.mock/approvals.jsonl` (gitignored) and logs `approval_requested` |
| `GET /log` | agent | In-memory hash-chained log (`hashLogEntry`), `LogFilter`, newest first, max 50 |

## Owner dashboard (`/owner`)

Open `http://127.0.0.1:8787/owner` and sign in with `MOCK_OWNER_TOKEN`. The login sets an `HttpOnly;
SameSite=Strict; Path=/owner` cookie holding a random session ID (never the token). `/owner/*` never accepts a
bearer token, and the session cookie is never accepted on the agent routes. Every state-changing owner request
must carry the dashboard's own `Origin` (a missing one is refused). Strict CSP, no external resources.

| Route | What it does |
|---|---|
| `GET /owner` | The page (token form until signed in), plus `/owner/app.js` and `/owner/app.css` |
| `POST /owner/login` `{token}`, `POST /owner/logout` | Constant-time token check; session in memory |
| `GET /owner/api/state` | Limits and budget, kill switch, approved suppliers (short address), pending approvals, newest 50 log rows |
| `POST /owner/api/kill-switch` `{on}` | Replaces the old `/dev/kill-switch` |
| `PUT /owner/api/limits` `{perPaymentCap, totalBudget}` | Positive amounts; a budget below spent + reserved is 409 |
| `POST /owner/api/approvals/:id` `{decision}` | Records approve/reject in the log; never pays or adds a supplier |
| `POST /owner/api/invoices` `{text}` | Max 20 KB. Forwards to the agent's `POST /agent/invoices` with `AGENT_INBOUND_TOKEN` and a fresh `invoiceId`; 90 s timeout (504), unreachable or off-contract 502, not configured 503 |
| `GET /owner/api/demo-invoices/01`…`06` | `fixtures/invoices/0N-*.txt`, read-only |

Activity rows carry `explorerUrl` (`https://testnet.xrpl.org/transactions/<hash>`) only for a payment with
`ledgerResult: tesSUCCESS`; mock hashes are shown as text and never linked.

Every response is parsed with its schema before it is sent; an off-contract answer becomes a generic 500.
Every response carries `X-Shucamoxa-Mock: 1`.

## What is fake

- **Tx hashes** are 64 hex characters that decode (`fromHex`) to `MOCK-TX-NOT-ON-LEDGER-<n>`, and the log's
  `ledgerResult` is `MOCK_NOT_SUBMITTED`. No explorer will find them.
- **Supplier addresses** in the seed must equal `mockSupplierAddress(id)`: the account ID `MOCK:<id>`
  padded with NULs. They are checksum-valid but keyless, and never leave the mock. Never fund them.
- **State** is in memory and resets on restart (except the approvals file).

`packages/shared/test-support/contract.ts` (`agentApiContract`) is the contract suite this mock passes;
W4's API (T30) runs the same suite.
