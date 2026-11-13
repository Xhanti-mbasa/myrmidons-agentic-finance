# Issue 33: weekly/category purchase budgets

13 November 2026. Branch baseline `47b6c55`. This implements a separate local
purchase-budget coordinator, not a deployed signer, FX service, or ledger payment.
Issue: https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/33

## Implemented interfaces and authority

`packages/shared/src/purchase-budgets.ts` exports strict schemas and six-decimal
fixed-point helpers through `@shucamoxa/shared`. Existing `Amount`, cents helpers,
transfer policy and cumulative/no-rollover accounting are unchanged.

`services/payments/src/purchase-budgets.ts` exports `PurchaseBudgetService`:

- Constructor: private SQLite path, required trusted quote/outcome adapters,
  optional clock for controlled tests.
- `setPolicy(principal, policy)`: owner-only. Categories bind per-purchase ZAR
  cap, weekly ZAR cap, merchant allowlist and optional automatic purchases.
  Only Africa/Johannesburg is currently supported; omitted timezone defaults
  to it. Empty categories deny all new purchases.
- `reserve(principal, request)`: strict purchase ID, merchant/category, resource
  hash, exact RLUSD price and fee allowance, and trusted quote ID. An agent
  requires `autoPurchase`; owner reservation is explicit pay approval. Identity
  comes from authenticated middleware, never an HTTP/tool body.
- `authorize(principal, purchaseId)`: independent signing integration must call
  immediately before new authority. Rechecks kill switch, policy version and
  quote expiry, then atomically marks the purchase unknown. A second call cannot
  grant new authority. A process crash after this point requires reconciliation.
- `recordOutcome(principal, purchaseId, evidence)`: only the injected verifier's
  independently checked evidence can settle/reject. An unverified/unknown result
  retains capacity. Returning a string from a model must never be the deployed
  verifier. Tests deliberately use a fake verifier, not live ledger evidence.
- `remaining(principal, categoryId)`: current period start plus ZAR spent,
  reserved and remaining, as canonical six-decimal text. Oversubscribed policy
  edits display zero remaining rather than negative money.

No public HTTP endpoints, credentials, quote provider or wallet implementation
are added. `Principal` is a trusted in-process host contract; callers must not
expose its construction to the agent. The database, module and adapters belong
in independent backend/policy isolation. Injecting an unrestricted callback or
allowing the agent to modify the database defeats this isolation.

## Period, edits and uncertainty

Weeks start Monday 00:00 Africa/Johannesburg (UTC+02:00), end at the next Monday,
and do not accumulate unused capacity. The service uses synchronous SQLite
`BEGIN IMMEDIATE`, WAL and FULL synchronous writes. All unresolved reservations,
including previous weeks, count against current capacity across connections and
restarts. A late verified settlement converts that carry-forward reservation
into spend in the week reconciliation confirms settlement, conservatively
retaining its cost in current-week usage. The original period and budget digest
remain unchanged; `settledPeriodStart` is recorded separately.

Policy edits increment version, preserve all reservations/history and invalidate
existing unexecuted authorizations. Lowering limits does not forgive old usage.
Disabled policy denies new reserve/authorize calls. Neither a timeout, week
rollover, expired quote nor policy edit releases a reservation. A trusted verifier
must establish definitive non-payment/rejection before release. There is no
automatic retry or admin reset that clears unknown spending.

Idempotency is scoped by owner and purchase UUID: the same canonical request
returns the persisted record, changed bindings fail, terminal purchases cannot
be authorized again. The x402 caller must assign stable purchase identity and
prevent a retry from becoming a new purchase ID.

## FX, precision and fees

Amounts use integer micro-units (`bigint`) and at most six decimal places on the
wire; no float/exponent input. This is a deliberately separate contract from
cent-based invoice/transfer payments. ZAR budget is not RLUSD settlement value.
A trusted adapter resolves the supplied quote ID into source, issued/expiry time
and ZAR per RLUSD. Future-issued, expired, mismatched or malformed quotes fail
closed. No exchange rate from invoice/model text is accepted.

The charge is `ceil((priceRlusdMicros + feeRlusdMicros) * zarPerRlusdMicros /
1000000)` ZAR micros. R0.10 with a controlled rate of R20 per RLUSD therefore
permits 0.005 RLUSD before fees, not 0.10 RLUSD. The rounded charge is frozen at
reservation; unused fee allowance is not refunded. Rate changes affect new
reservations, while any quote expiring before authorization blocks execution.
No actual FX trade, peg assumption or market-rate guarantee is supplied.

The quote adapter remains an integration blocker: production must select and
validate an authenticated source, validity duration and total fee allowance.
This module accepts an RLUSD-denominated total fee allowance only. XRPL XRP fees
or another fee asset require a trusted conservative conversion/fee ceiling in
the execution integration; do not deploy a path that omits those costs or permits
an adapter to exceed the bound amount/fees. No current live rate is claimed.

## Validation and integration gaps

Observed local evidence: Node 22.23.5, pinned pnpm 10.28.0; `pnpm typecheck`
passed; `pnpm exec vitest run --project payments test/purchase-budgets.test.ts`
passed eight tests. Tests cover final allowed/first blocked purchase, category
isolation, two SQLite connections, restart deduplication, owner/merchant controls,
FX/fee changes, upward rounding, week boundary, unknown rollover, late settlement,
policy edits/revocation/quote expiry, verified rejection and no reauthorization.
These are simulated adapters and local database tests, not signer deployment or
validated XRPL settlement. Run `pnpm test` and tracked-path guard on integration.

Issue 32 owns the x402 bridge and challenge-to-reservation binding. The bridge
must resolve trusted quote/fees outside model inputs, carry `budgetDigest` into
exact independent signer authorization, and reconcile identical payment evidence.
The new weekly budget supplements the existing cumulative transfer budget; its
presence is not permission to skip that global control. Issue 31 owns independent
policy/signer enforcement. No live provider, independent ledger signing topology,
merchant purchase, market FX source, owner UI or end-to-end integrated evidence is
claimed here. Keep issue 33 open until those acceptance gaps are demonstrated.
