# Issue #32: restricted x402 purchase prototype

**Later integration:** [PAYMENT_INTEGRATION.md](PAYMENT_INTEGRATION.md) records
the presigned payload executor, authenticated host/MCP tools, crash/no-sign
recovery and exact ledger verification. Durable binding/attempt records and
signer tombstones address the earlier orphan-reservation window. Uncertain signed
transactions still require reconciliation, never speculative release.

13 November 2026. The source adds a strict XRPL Testnet RLUSD x402 v2 challenge parser, merchant and resource binding, a durable single-attempt purchase coordinator, and a bridge to the weekly category budget service. The code is a local prototype with required injected execution, budget, quote and outcome adapters. It contains no wallet keys, live facilitator client or actual merchant integration.

`packages/shared/src/x402.ts` accepts only the selected exact/sequence Testnet RLUSD profile. `services/payments/src/x402.ts` binds the challenge to a configured HTTPS merchant origin, destination, resource URL, expiry and purchase digest. It supports decline, owner pay and agent automatic purchase only when the budget adapter allows it. Duplicate resource purchase IDs are refused. Unknown execution retains state for lookup without another payment; delivery failures can retry content access without paying again. The execution adapter must independently validate the exact signed transaction, payer fees, policy permit, current revocation, facilitator response and ledger outcome. It must enforce no redirects on content delivery and preserve the transaction identity before network I/O.

`services/payments/src/x402-budget.ts` maps a bound purchase into the separate `PurchaseBudgetService`. The two services currently use separate SQLite transactions. The coordinator now checks durable budget state on retry; a previously reserved or unknown purchase is treated as unknown and never executed again. A crash can still leave an orphan reservation that needs reconciliation, so a production recovery worker and independently verified no-submission proof remain release blockers. The transfer coordinator's cumulative budget is also not composed here; its policy must be enforced at the signer. The demo's fake adapters do not establish this.

Local validation: TypeScript typecheck passed. An earlier payment run passed 66 tests; the latest sandbox run passed 65 and could not start the loopback HTTP test (`listen EPERM`). Tests use fake execution, outcome and quote adapters and a controlled merchant fixture. No validated XRPL transaction, actual paid resource access or blocked ledger attempt was observed. Current SDK/facilitator compatibility must be verified before enabling a live client. Merchant terms must be reviewed: paid access alone grants no redistribution or crawler reuse permission.

Next: close the cross-database recovery gap, integrate the transaction workstream's independently constrained Testnet wallet and real facilitator, bind aggregate and weekly budgets at the signer, then demonstrate one delivered resource and an independently blocked overspend with ledger and audit evidence. Keep the issue open until those acceptance criteria are met.

## Controlled merchant transport update

`services/payments/src/x402-merchant.ts` now fetches a pinned HTTPS resource with
manual redirects and a timeout, accepts only a bounded `PAYMENT-REQUIRED` 402
challenge, and binds it to the configured merchant. After an independently
verified settlement, the caller may present its signed x402 payload in
`PAYMENT-SIGNATURE` to retrieve a bounded article response. Redirects, changed
origins, missing challenges and oversized content are rejected. The transport
contains no signing key and cannot decide settlement. The required signer and
settlement adapter must supply the payload and verified receipt; no live
facilitator transaction or real article unlock is claimed.

Validation on this branch: `pnpm typecheck` and 70 payment-project tests passed
with loopback access, including controlled merchant transport and owner-period
edit accounting. The merchant tests use a scripted fetch response.
