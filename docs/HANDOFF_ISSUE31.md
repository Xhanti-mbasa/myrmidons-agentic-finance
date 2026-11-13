# Independent authorization adapter handoff — issue 31

**Later integration:** [PAYMENT_INTEGRATION.md](PAYMENT_INTEGRATION.md) records
the concrete Testnet transfer provider, final synchronous revocation/signing gate,
private purchase host and remaining deployment/co-sign topology evidence. The
older scaffolding-only descriptions below are historical.

13 November 2026. This is implemented adapter scaffolding with simulated provider
outcomes, not deployed signing isolation or a validated Testnet payment.

## Changed interfaces

`PreparedTransfer` now includes the owner intent's `expiresAt`; the existing
canonical digest binds source, recipient/address/tag, asset/issuer/network,
amount, reference, policy version, expiry and audit hash. Old stored prepared
transfers without expiry cannot obtain a new signed permit; uncertain historical
submissions must be reconciled rather than recreated.

`SigningPermitClaims` in the shared package is a strict, versioned schema with
fixed wallet audience. `createSignedPolicyAdapter` signs canonical claims using
an injected Ed25519 private KeyObject. `createGuardedWalletAdapter` uses only its
public key, rejects forged/modified/expired claims and checks current authority
before invoking the supplied provider. Keys are injected by the host; no new
key environment variables, persisted keys, dependencies or provider selection
are introduced. Never send private keys through model context or tool input.

`PaymentService.checkSigningBoundary` is a trusted-host method checking the
existing reserved intent, exact digest, audit integrity, expiry, current policy
version/enabled state, recipient binding, cap and aggregate accounting. It
cannot create an intent or reserve budget and is not exposed through HTTP.
Adapters accept a `SigningBoundary` callback; deployments must authenticate and
scope any remote implementation themselves. Failure throws and stops delegation.

## Deployment and remaining gates

Run the policy signing private key and authoritative policy access in a service
unreachable with agent/owner API credentials. Run the wallet provider in another
protected service with the policy public key and authenticated policy reads.
The agent receives only its existing scoped backend credential and cannot access
DB files, signing code/configuration, provider endpoints or keys. Owner settings
must use separate authenticated authority. An in-process callback in tests does
not prove any of these OS/network boundaries.

The provider is still required to construct and validate exact supported XRPL
Payment bytes, disallow alternate transaction types/fields/partial payments/
paths, bound fees and ledger expiry, and verify actual validated ledger outcome
and delivered amount. It must persist one signing/submission identity per intent
and retain unknown outcomes for reconciliation. The guard itself does not
provide a durable replay store: while an intent is pending, a replay of the same
permit must resolve to that existing transaction in the provider, never mint a
second one. Completed intents fail the durable boundary check.

Policy checks immediately before a provider call cannot make remote signing
atomic with revocation. The actual signer must serialize the final current-policy
check with signing and owner revocation. A provider must not sign later from a
cached callback result. A deployment must also prevent direct raw-provider,
master-key and regular-key bypass. No such deployment or live ledger evidence
is supplied here. Privy and wallet topology remain owned by the transaction
workstream. Thus issue 31's live acceptance criteria remain open.

This transfer adapter uses existing cents-based RLUSD contracts. It is not an
x402 micropayment signing adapter and does not convert ZAR budgets into RLUSD.
Coordinate explicit new contracts for issues 32/33 rather than adapting amounts
by assumption.

## Validation and next step

Node 22.23.5, pinned pnpm 10.28.0: `pnpm typecheck` and
`pnpm exec vitest run services/payments/test`. The latter uses a localhost HTTP
listener; a restrictive sandbox must allow that test listener. Tests exercise
real locally generated Ed25519 signatures with a fake wallet: exact payment,
field tampering, wrong key, forged token, expiry, current-authority failure and
replay refusal after a simulated settlement. Existing concurrency, reservations,
unknown outcome/reconciliation and authenticated endpoint tests remain active.
Typecheck passed; all 34 payment/signing tests passed (2 files); the tracked-path
guard passed. No live model, external wallet or ledger transaction was used.

Next: transaction workstream implements the isolated provider contract and
atomic revocation/durable signing identity, then records validated allowed and
blocked Testnet evidence with audit linkage and direct-bypass refusal.
