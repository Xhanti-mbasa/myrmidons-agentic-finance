# Deterministic transfer core

This is a Testnet transfer coordinator, private HTTP adapter and MCP `pay` bridge.
The concrete permit-verified Testnet wallet adapter now lives in
`services/backend/src/transfer-wallet.ts`; signed policy adapters live in
`src/signing.ts`. A trusted private host must compose and configure them.
See [payment integration](../../docs/PAYMENT_INTEGRATION.md) for signing,
quote/merchant setup and recovery, and [harness demo](../../docs/HARNESS_DEMO.md)
for the owner console, scoped OpenAPI/MCP tools and WebUI registration.

The local harness demo uses the real coordinator with an explicitly simulated
ledger. Source adapters and generated-key tests do not establish deployed
independent signing, funded-wallet settlement or an on-ledger signer topology.
Use Node 22 and private local SQLite storage. Nothing in this module listens or
moves funds by default.

## Pay flow

1. An authenticated owner UI resolves the intended recipient and displays the
   canonical source, recipient, asset, amount and schedule. Only after explicit
   authorization does it call `createIntent` with an owner credential. The agent
   never receives that credential. A trusted invoice/mandate backend may later
   implement another authorization path; that integration is not present here.
2. `pay({intentId})` references the stored intent. There is no free-form prompt,
   destination, amount, role, owner ID, SQL or policy override in the tool input.
3. In a SQLite `BEGIN IMMEDIATE` transaction, the core verifies audit links,
   checks scope, expiry, lockout, approved account/recipient binding, current
   policy/cap/budget, reserves capacity and persists an unknown/in-progress
   operation **before any async authorization or signing**.
4. The mandatory independent policy adapter authorizes the exact prepared
   payment digest. The coordinator rechecks policy version, kill switch,
   recipient binding and expiry after the await, then records submission start.
5. The wallet adapter independently validates the authorization and actual
   transaction, signs/submits, and returns a receipt. The core never supplies
   private keys to the agent. Signing authority must require independent policy
   approval even if somebody bypasses this HTTP endpoint.
6. Only an adapter-verified, validated `tesSUCCESS` receipt with the matching
   prepared-payment digest can produce `settled`. A submit response, malformed
   receipt or timeout is not settlement. Status/reconciliation never resubmit.

Audit records surround the flow; audit is not a signer or a forwarding hop.
Pre-submit audit/storage failure stops execution. If storage fails after a
submission may have begun, durable unknown state/reservations remain for recovery.

## Trusted host integration

Import `PaymentService` and `createTransferServer` into the backend host. Supply
`PaymentAdapters` implemented by the wallet/policy workstreams. Construct the
service with a private database path and map independently generated scoped
Bearer credentials to fixed `{ownerId, subjectId, role}` principals. Bind the
returned server to loopback/private networking with HTTPS for remote clients.
The server factory does not bind a port and does not generate credentials.

Owner routes:

| Method | Path | Body / meaning |
|---|---|---|
| POST | `/transfers/accounts` | `{id,address}`; trusted wallet registration, not proof of on-chain ownership. |
| POST | `/transfers/recipients` | Approved person/vendor `{id,kind,address,destinationTag?}` or internal `{id,kind:"internal",accountId}`. |
| PUT | `/transfers/policy` | `{enabled,perPaymentCap,totalBudget,recipientCaps}`. Amounts are decimal strings. |
| POST | `/transfers/intents` | `{sourceAccountId,recipientId,amount,reference,executeAt,expiresAt}`. Explicit owner authorization. |
| POST | `/transfers/unlock` | `{subjectId}`; only the owner can unlock payment authority. |
| GET | `/transfers/audit` | Full owner-scoped chain, including wallet address evidence; never expose to the model. |

Agent/scoped worker routes:

| Method | Path | Meaning |
|---|---|---|
| POST | `/transfers/pay` | `{intentId}`; execute the stored intent or register its future schedule. |
| GET | `/transfers/{intentId}` | Read status without changing/retrying execution. |
| POST | `/transfers/{intentId}/reconcile` | `{}`; query ledger evidence, never sign a new payment. |
| POST | `/transfers/due` | `{}`; process up to 100 due scheduled intents for this authenticated owner. |

These are **new transfer routes**, not replacements for the existing agent's
invoice `/payments` or gateway `/v1/invoices/...` contracts. They are not silently
interchangeable. The strict transfer-only MCP process `mcp_gateway/transfers.py` exposes
`pay(intent_id)` and `get_transfer_status(intent_id)`; it rejects unknown
arguments and malformed/invisible IDs before contacting the backend.
Use `config/mcp.transfers.example.json` for this process.
The older combined `server.py` also forwards these calls for compatibility;
owner mutation tools are never registered in MCP. Configured token scope, not
`SHUCAMOXA_BUSINESS_SCOPE` supplied by the client, determines backend authority.

For example, the owner's approved directory can bind `johnson` to a verified
destination. The owner creates a `100.00` intent for `johnson`; the agent receives
only its ID and calls `pay`. Names/semantic confidence never authorize a payment.
Contact search and identity proofing must be integrated separately. The explicit
approved channel in this implementation is owner configuration.

## Rules, schedules and duplicates

- One owner-wide cumulative budget covers all registered source accounts.
  `recipientCaps: {johnson: "1000.00"}` overrides a global `500.00` per-payment cap;
  it never overrides the aggregate budget or kill switch. Policy edits preserve
  spent/reserved totals. There is no automatic budget-period rollover.
- Internal means an XRPL transfer between registered wallet accounts in the same
  owner scope, not an off-chain custodial bookkeeping transfer. The trusted wallet
  service must verify account ownership/control before registration and signing.
- Owner + reference is unique across source accounts. Repeating the exact same
  authorized request returns the existing ID; changing its meaning fails. Even
  blocked/rejected operations are not silently reopened or automatically retried.
- Future intents reserve no money until due. A trusted host timer/cron must call
  `/transfers/due`; no cron job is installed by this change. Every due execution
  rechecks current policy, budget, recipient binding and authorization expiry.
- Concurrent requests and restarts cannot cause the coordinator to call submit
  again for the same intent. Unknown/submitted reservations do not expire on a
  wall-clock TTL. Read status, then reconcile the persisted transaction identity.
- Five rejected authenticated pay requests in 60 seconds lock **that credential's
  payment authority**, not the owner's login or another tenant. Unlock is an
  authenticated owner operation. Untrusted invoice prose is not fed to lockout.
  This bounded abuse rule is not a classifier that proves malicious intent.

## Wallet/policy adapter obligations

`PreparedTransfer` contains the exact source/destination/tag, canonical amount,
Testnet endpoint, currency/issuer, policy version and audit hash. Before signing,
the adapter must verify a non-forgeable permit bound to all these fields, current
revocation, source control, account balance/fee capacity, genuine asset issuer,
no partial-payment/deliver-min/extra transaction fields, memo/audit binding,
sequence and bounded LastLedgerSequence. Record signing identity before sending.
The wallet must not expose an alternate unconstrained signing path to the agent.

The adapter must persist the actual transaction hash and expiry before broadcast,
so recovery works if the coordinator never receives a hash. `lookup` verifies the
actual validated ledger transaction and delivered amount against the prepared
payment. It must not trust `engine_result`, token names, an echoed paymentDigest
or a mere `{validated:true}` flag from an unverified service. A mismatched hash
does not replace a persisted hash. Proven validated `tec` rejection releases the
RLUSD reservation; uncertain/absent transactions remain reserved. Expiry-proof
recovery is intentionally not implemented; it requires complete ledger evidence.

The existing `CosignRequest` invoice API is **not** automatically this adapter.
Signed Ed25519 permits, trusted memo construction and fixed Testnet RPC adapters
now exist in the integration guide. Final independently deployed signer topology
and actual ledger acceptance evidence remain required. A permissive fake adapter is suitable only for tests.

XRPL references:

- https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission
- https://xrpl.org/docs/concepts/transactions/finality-of-results

## Isolation and audit limits

Run the agent, payment host and independent signer under different OS identities.
Install reviewed tool code under a root-owned directory such as `/opt/shucamoxa`,
read/execute-only to the agent. Give only the payment identity access to its
private SQLite directory; keep credentials outside Git. A deployment can enforce
`ProtectSystem=strict`, `ReadOnlyPaths=/opt/shucamoxa`, `NoNewPrivileges=yes` and
an explicit payment-service `ReadWritePaths=/var/lib/shucamoxa/payments`.
Do not put the agent in privileged groups or give it writable tools, DB files,
signer sockets or owner credentials. These are deployment requirements, not
permissions installed by this source-only change.

Audit stores source/destination evidence, intent/reference, policy changes,
reservations, decisions, submit outcomes, tx hash and validated ledger details.
It omits signing keys, opaque permits, raw prompts and invoices. Chain hashes use
the shared canonical audit algorithm; verify links before new execution. Full
history verification is linear and intended for the initial local prototype.
Suffix deletion or a complete rewrite requires an independently retained anchor
to detect. No immutable archive/checkpoint or ledger anchor is deployed here.

An independent incoming-transaction/treasury monitor, contact verification,
retention/access policy and jurisdiction-specific compliance requirements remain
separate work. This core audits its own outgoing flow; it does not claim to see
all wallet activity or provide legal compliance.

## Verification

```bash
pnpm typecheck
pnpm exec vitest run --project payments
python -m unittest discover -s mcp_gateway -p 'test_*.py' -v
```

Tests use temporary SQLite files, fake policy and ledger adapters, a real local
HTTP listener and simulated MCP HTTP requests. They cover recipient/amount
binding, role/scope checks, policy refusal, recipient-specific caps, concurrent
reservation/deduplication, restart recovery, schedules, lockout, invalid inputs,
corrupt/unavailable audit storage and conservative settlement. They do not prove
live XRPL payment, independent signer deployment or prompt-injection immunity.

After a trusted host is running with scoped credentials, select the strict MCP
configuration with `w3node chat --mcp config/mcp.transfers.example.json`.
Set the three named backend environment variables first. Owner-authorized
intent IDs come from the UI/backend; never ask the model to invent authority.
Schedule/expiry timestamps are UTC ISO date-times ending in `Z`.
