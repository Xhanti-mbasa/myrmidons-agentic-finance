# Issue #30: existing spending controls verified

13 November 2026. Baseline inspected: `47b6c55` on main. This is local
source/test evidence, not a deployed payment or validated ledger transaction.

## Existing behavior preserved

`services/payments/src/payment.ts` already enforces authenticated owner-only
policy changes and account/recipient approval. HTTP scope comes from a server-side
credential map, never request JSON. Agent credentials cannot edit policy or
create owner authorization. Deployment must protect that credential map, DB and
service code from the agent.

Transfer amounts, caps and cumulative budget are decimal RLUSD-unit strings with
at most two decimal places, calculated with shared integer-cent helpers. They are
not ZAR amounts. One owner-wide cumulative budget spans registered source
accounts. A recipient cap replaces the default per-payment cap, whether higher
or lower; it cannot replace aggregate budget or the enabled flag.

The admission test is `spent + reserved + amount <= totalBudget` inside SQLite
`BEGIN IMMEDIATE`. Policy edits preserve spent and reserved; there is no calendar
rollover, automatic reset or reservation TTL release. Lowering a budget below
existing commitments blocks further spending rather than erasing commitments.
Future schedules reserve only when due. Policy edits while independent
authorization is awaited block the old version before submit.

Disable blocks new authority, including a scheduled execution and a payment
awaiting policy authorization. It cannot recall a submitted payment. Unknown
submissions retain reservations even after disable, expiry and restart.
Reconciliation may confirm their settlement while policy is disabled, without
creating new authority. A definitely unsubmitted blocked request releases its
reservation. Verified rejection releases it; verified settlement moves it to
spent. Receipts in these tests are fake adapter responses.

Owner/reference uniqueness and durable intent state prevent a second submit for
the same intent across connections/restarts. A new reference remains a new owner
authorization, so the caller must retain business identity correctly.

## Changes and reproducible evidence

Added six tests in `services/payments/test/payment.test.ts` covering stricter
recipient override, exact budget boundary and first over-budget cent; combined
spent/unknown reservations through edits/restart/calendar advancement; independent
connections contending for capacity; enabled-policy version changes while
awaiting authorization; and disable with an already uncertain submission.
The HTTP test also verifies agent policy PUT denial; a rejection test verifies
reservation release exactly once across repeated reconciliation/pay requests.
No production interface, configuration or dependency changed for this issue.

On Node `v22.23.5`, pnpm `10.28.0`:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec vitest run --project payments
python -m unittest discover -s mcp_gateway -p 'test_*.py' -v
sh scripts/check-tracked-paths.sh
```

Initial typecheck and 26 payment tests passed. After #31 integration and the
review additions, typecheck and 40 payment/signing tests passed. All 10 gateway
tests and the tracked-path guard passed. The full pre-integration suite had two
failures in unchanged ownerChat server tests (1,416 passed, 39 skipped). Tests use
temporary SQLite databases, fake policy/wallet adapters and a loopback HTTP
server. Two live SQLite connections are tested, rather than two independently
running OS processes or a deployment crash drill.

## Gaps and next step

Independent provider/signing deployment, signer bypass prevention, source-control
verification and actual Testnet success/blocked ledger evidence remain required.
The independent policy workstream (#31) must implement its boundary without
weakening these tests. Weekly/category micropayment budgets (#33) are a separate
extension and must preserve these cumulative transfer semantics. x402 (#32)
requires an explicitly composed purchase path; the invoice APIs are separate.

No keys, provider account or production configuration are added here. Next run
the coordinator suite against the integrated policy branch, then collect live
Testnet evidence through the approved wallet workstream.
