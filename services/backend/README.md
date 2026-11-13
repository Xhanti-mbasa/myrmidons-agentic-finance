# XRPL payment backend

This package is the W3 XRPL workstream: prepare transactions, coordinate
signing, submit to XRPL Testnet and check the final ledger result. It contains
two developer demos and a **draft** wallet adapter. It does not implement an
agent-facing payment endpoint, a policy service or an owner application.

The RLUSD demo has sent 1 test RLUSD on Testnet. The adapter has only been
tested with a fake signer and mocked ledger responses. No real independent
signer, policy integration or agent-initiated payment is demonstrated by this
package. In particular, it does not satisfy PRD AC-01 or AC-02 on its own.

## How the pieces fit

```text
Payment coordinator -> policy decision -> wallet adapter -> trusted signer
                                            |                    |
                                            +---- signed blob ---+
                                            |
                                            -> XRPL Testnet -> validated result
```

This is the intended integration, not a deployed flow. The coordinator's wallet
interface is in `services/payments/src/payment.ts`. The adapter and signer must
remain outside the agent's security boundary. The agent cannot hold seeds or
obtain all signing authority. See the [payment coordinator](../payments/README.md),
[PRD](../../docs/PRD.md) and [technical specification](../../docs/TECHNICAL_SPEC.md).

| File | Purpose |
|---|---|
| `src/xrpl-demo.ts` | Disposable XRP wallets and a single XRP Testnet payment. |
| `src/confirmation.ts` | Checks the demo's validated XRP payment. |
| `src/rlusd-demo.ts` | Reusable local test wallets, trust lines, balances and a 1 RLUSD transfer. |
| `src/rlusd-confirmation.ts` | Confirms the demo's specific 1 RLUSD transaction. |
| `src/prepare-transfer.ts` | Builds a bounded Testnet RLUSD transaction for a coordinator `PreparedTransfer`. |
| `src/wallet-adapter.ts` | Draft coordinator wallet adapter, SQLite operation journal and ledger lookup. |
| `test/` | Unit and simulated adapter tests; no real policy signer is tested. |

## Run the Testnet demos

Use Node 22.13 or later in the Node 22 series and the pnpm version pinned in the
root `package.json`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm xrpl
pnpm xrpl:rlusd setup
pnpm xrpl:rlusd balances
pnpm xrpl:rlusd send
```

`pnpm xrpl` creates two temporary wallets, funds them with test XRP, sends 1 XRP
and discards their keys when it exits. `xrpl:rlusd setup` creates the sender and
recipient once, reuses them later, funds test XRP when needed, and creates or
checks their RLUSD trust lines. `balances` reads validated account data. `send`
attempts exactly 1 test RLUSD; it is a separate, single-signature developer
exercise, not the product payment flow.

Both demos use the fixed `XRPL_TESTNET_WSS` constant in `@shucamoxa/shared`.
The RLUSD currency and issuer are also shared Testnet constants. The CLI does
not accept a Mainnet endpoint. A trust line permits receiving an issued token;
it does not itself fund the account with RLUSD. After setup, request test RLUSD
at [tryrlusd.com](https://tryrlusd.com/). The XRPL faucet currently requires a
supported wallet connection. A separate Testnet wallet can claim and transfer
test RLUSD to the CLI's printed **Sender** address. Never enter a seed into a
website or share it with a teammate. XRP is also needed for reserves and fees.

The RLUSD CLI keeps seeds and tracking files in `services/backend/wallets/`,
which is Git-ignored. It applies user-only permissions on POSIX and configures
the current Windows account's ACL. This is developer storage, not a production
key vault: other processes under the same OS user may access the secrets, and a
checkout under a synchronized folder may be backed up or synced. Do not put
these files in the agent environment, Git, logs or chat. Testnet can reset, so a
saved account's ledger state and balances may disappear even though its seed
file remains. Re-run setup if that happens; do not silently replace the wallet.

## CLI outcomes and recovery

The CLI prints public addresses, a transaction hash and a Testnet explorer link.
For the 1 RLUSD send it reports success only after a validated `tesSUCCESS`
with the expected hash, sender, recipient, issuer and delivered amount. A hash,
submission response or timeout alone does not prove payment or non-payment.

Before submitting, `send` writes a pending record with the hash, addresses,
sequence and last-ledger expiry. If the result is uncertain, it retains that
record and blocks another send. Run `pnpm xrpl:rlusd send` to look up the
existing hash: if it confirms the expected success, the command archives the
record and stops; it does not create another payment in that run. For other
outcomes, inspect the hash and reconcile it against validated ledger history.
The CLI does not prove expiry or automatically resolve a rejected/absent
transaction. Do not delete the pending record or create a replacement just
because a timeout passed. If a process crashes and leaves `rlusd.lock`, first
confirm no other CLI process is running; then remove only that lock file.

## Draft wallet adapter contract

`XrplWalletAdapter` implements `PaymentAdapters.wallet` in
`services/payments/src/payment.ts`. It is not wired to a host or agent. Its
constructor takes a private durable SQLite path and a `TrustedSigner`; call
`close()` when the host is finished. `:memory:`, empty paths and `file:` URIs
are rejected. The caller must protect the database and SQLite sidecar files;
the adapter does not configure filesystem access controls.

The coordinator calls `submit(payment, permit)` with a `PreparedTransfer`, a
digest and an authorization string. The adapter checks the digest and uses
the fixed Testnet endpoint. It claims the intent in SQLite before asynchronous
work; checks the source account, XRP reserve, RLUSD balances and trust lines;
builds a payment with a fixed 100-drop fee, bounded `LastLedgerSequence` and
audit-hash memo; then requests a signed blob from `TrustedSigner.sign`.

The signer receives the prepared payment, digest, authorization and exact XRPL
transaction. It must **not broadcast**. It must independently authenticate and
verify the policy authorization against the transaction, check current
revocation and source control, and ensure ledger signing requirements make the
independent approval mandatory. Returning a blob after merely checking that the
authorization string exists is not policy enforcement. No such trusted signer
is implemented here; never use an always-allow signer outside tests.

The adapter decodes the signed blob and rejects changes to the prepared
transaction. It stores the hash and unsigned transaction in SQLite before
broadcasting, then queries the ledger. `lookup(payment, digest, txHash?)` checks
the saved operation and retrieves the same hash without creating another
payment. A `settled` receipt requires matching validated transaction fields,
`tesSUCCESS` and the expected delivered RLUSD. A validated matching `tec` result
can produce `rejected`; unavailable, mismatched or uncertain evidence returns
`unknown`. `unknown` does not include a hash in the shared receipt schema; the
adapter retains the hash in its private journal when one was recorded.

The unique intent claim prevents this adapter from submitting the same intent a
second time, including after restart. It is not business-invoice deduplication
across different intents. A crash or failure after the claim but before a hash
is recorded leaves the operation unknown and blocked, even if nothing was sent.
There is no automatic reopening or expiry-proof recovery. The host must retain
the journal and reconcile before resolving uncertain operations. The database
is separate from the coordinator's reservation and audit store.

The existing shared invoice `CosignRequest` and the coordinator's transfer
permit are different contracts. The policy and wallet owners must agree on the
actual integration, permit verification and ledger signer topology before using
this adapter for a protected payment. A callback, a passing mock test, or the
coordinator's local checks do not prove that direct signer bypass is impossible.

## Verification

```sh
pnpm typecheck
pnpm exec vitest run --project @shucamoxa/backend --project payments
```

The adapter test uses a generated test wallet, a fake signer and mocked XRPL
responses. It checks confirmation, repeated intent handling, a changed signed
transaction and timeout/restart lookup. It does not establish live adapter
settlement, signer isolation, ledger-enforced multisigning, policy refusal,
revocation or production readiness. A separate developer CLI transfer was
validated on Testnet; see [project status](../../docs/PROJECT_STATUS.md) for its
hash and evidence level. Do not use these test wallets for real funds.
