# XRPL wallet adapter

`XrplWalletAdapter` implements the `PaymentAdapters.wallet` interface in
`services/payments/src/payment.ts`. It is not connected to the agent or a server.
Construct it in a trusted host with a private durable SQLite path and a
`TrustedSigner`. The signer receives the prepared payment, its digest, the
authorization and the exact XRPL transaction, and returns a signed transaction
blob without broadcasting it. Never supply an always-allow signer outside tests.

The signer is a security boundary: it must independently authenticate and verify
the policy authorization against the payment and transaction, check current
revocation and source control, and ensure XRPL signing requirements actually
make the independent approval mandatory. The adapter cannot establish these
properties by checking that an authorization string is present. The existing
`CosignRequest` and coordinator permit contracts differ; the policy owner must
specify the binding and signer topology before integration. No real trusted
signer or independent policy implementation is included here.

The adapter checks Testnet, reserves and RLUSD trust lines, constructs the
transaction with an audit memo, rejects changed signed fields, persists the hash
and unsigned transaction before broadcasting, and queries the ledger on lookup.
Its per-intent record prevents repeat submission across restarts. An interruption
before a hash is stored also leaves the intent unknown and requires manual
recovery; ledger expiry proof and automatic reopening are not implemented.
Do not delete unknown records merely because time elapsed. `tec` rejection and
settlement require a matching validated transaction. Tests use a fake signer
and mocked ledger, not actual signing infrastructure or policy enforcement.

The signer database must be readable and writable only by the payment identity,
outside agent access. The adapter's local claims do not replace deployed ledger
multisigning, source ownership verification, or revocation enforcement.
