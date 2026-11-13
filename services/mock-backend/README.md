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
| `POST /dev/kill-switch` `{on}` | owner (`MOCK_OWNER_TOKEN`) | Mock only. The agent token gets 403 |

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
