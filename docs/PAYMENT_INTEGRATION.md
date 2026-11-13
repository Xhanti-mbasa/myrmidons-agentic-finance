# Payment integration handoff: issues #31–#33

13 November 2026. Testnet only. This guide supersedes the earlier handoffs for
the source changes described here, not their live-release evidence requirements.

## What now exists

| Component | Implementation | Evidence boundary |
|---|---|---|
| Transfer wallet | `services/backend/src/transfer-wallet.ts` | Actual XRPL signing, independent Ed25519 permit verification, final policy check under the revocation DB lock, durable transaction identity and validated-ledger verification. Tests use generated local keys and scripted ledger responses. |
| Purchase executor | `services/backend/src/x402-execution.ts` | Constructs a presigned Testnet RLUSD Payment, binds invoice/resource/budget, checks trusted merchant destination again, and sends the v2 signed payload to the merchant. The merchant handles its facilitator. No default Mainnet network or arbitrary signing endpoint. |
| Periodic budgets | `services/payments/src/purchase-budgets.ts` | Daily/weekly/monthly Johannesburg categories plus an owner-wide cumulative RLUSD purchase-wallet allowance. Unknown reservations carry forward. Failed validated payments retain their conservative XRP fee valuation. |
| Rate/fee trust | `purchase-quotes.ts`, `purchase-quote-sign.ts` | An owner-controlled publisher attests the RLUSD/ZAR rate, XRP fee ceiling and converted fee allowance with Ed25519. The host verifies the public key and a maximum five-minute validity. This is not an automatic market-price feed or an assumption of USD/RLUSD parity. |
| Private HTTP host | `purchase-main.ts`, `purchase-host.ts` | Fixed authenticated owner/agent identities, owner-registered resources, private durable binding storage, owner-only policy and approval routes. Tokens, amounts, URLs and keys cannot be overridden by tool arguments. |
| Agent tools | `mcp_gateway/purchases.py` | `purchase_resource`, `reconcile_purchase`, `read_purchased_resource`. Strict schemas reject prices, addresses, URLs and owner/policy overrides. Content is marked untrusted. |
| Service isolation | `deploy/shucamoxa-purchases.service` | Installable Linux unit under a distinct OS identity with private state, read-only code and protected key/config paths. Not installed or verified on the owner's PC by this change. |

The purchase wallet is **dedicated and separate from the invoice-transfer
treasury**. Its aggregate allowance covers all purchase categories. It does not
silently draw down the two-decimal transfer coordinator's budget. Do not share a
key between these hosts, other signers, or personal/Mainnet wallets. The existing
invoice `/payments`, transfer `/transfers/*`, and purchase `/purchases/*` contracts
remain distinct. The purchase host does not pretend to implement invoice routes.

## Transaction and recovery behavior

1. The host obtains and binds a 402 challenge from a configured HTTPS origin.
   Resource IDs and bindings are durable: retrying the same resource recovers
   its original purchase ID, even after a lost HTTP response.
2. The purchase coordinator persists its binding and claims single-attempt
   execution **before** calling separately committed budget adapters.
3. The independent budget service reserves price plus fee allowance using the
   verified quote and current owner policy. It marks the reservation unknown
   before execution. The signer checks the same reservation and merchant again.
4. The final synchronous signing callback runs while policy changes are locked
   out. No asynchronous work occurs inside that policy check/sign operation.
5. The executor persists the signed transaction identity before sending the
   signed payload to the merchant. One unresolved source-account sequence is
   allowed at a time. No automatic re-signing or payment resubmission occurs.
6. HTTP success, a facilitator claim or an echoed hash is insufficient. The
   fixed Testnet ledger must report validation, the expected signed transaction
   hash and fields, `tesSUCCESS`, and the exact delivered RLUSD amount.
7. Content may be buffered internally but is not exposed through the host or
   tools until that ledger evidence is verified. Delivery retries use the same
   signature and purchase, never another payment.
8. If a crash occurred before signing, recovery records a durable no-sign
   tombstone under the signer journal lock. The same purchase can never sign
   later; its reservation can be rejected/released. Late reservations from
   another process can still be reconciled without reopening the purchase.
9. If a transaction was signed or may have reached the network, missing lookup
   evidence remains unknown. No wall-clock expiry frees those reservations.
   Complete-ledger proof of signed-transaction expiry is still a separate
   recovery integration, not implemented by guessing from `txnNotFound`.

An already signed transaction cannot be recalled by a later kill-switch change.
The switch blocks **new signing**, with a bounded four-ledger transaction window.
Permission revocation and signing serialize on the private budget/transfer DB.
No claim of on-ledger multi-sign deployment or final Privy integration is made.

The live ledger transport uses the fixed official Testnet HTTPS JSON-RPC endpoint
`https://s.altnet.rippletest.net:51234/`, with no redirects, bounded responses and
a startup `server_info` check requiring network ID 1. It is not dependent on
WebSocket availability. The network marker remains the shared Testnet constant.

## Private host setup on the operator's machine

Prerequisites: Node 22.23+, pinned pnpm 10.28.0, Python 3.11+ with
`mcp_gateway/requirements.txt`, and a dedicated wallet funded with Testnet XRP
and genuine test RLUSD. Both payer and publisher must have the needed RLUSD
trust lines. Never upload or commit the wallet seed.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
node --import tsx services/backend/src/purchase-main.ts --preflight
```

The preflight loads no wallet and submits no payment. A successful connection
is not a claim about a funded wallet or a working merchant.

Use `config/purchases.host.example.json` as the configuration shape. It contains
placeholders, not real credentials or a working publisher. Replace the merchant
URL, address and terms only after independently verifying the intended Testnet
merchant. Files containing the host configuration, wallet seed or tokens must
be regular files with mode `0600`; the state directory must have mode `0700`.
Startup rejects symlinks and group/world-readable private files. The quote public
key is not secret. The owner and agent tokens must be distinct, at least 32
characters long, and generated independently.

For the service unit's standard layout, an administrator provisions a dedicated
`shucamoxa-purchases` user, read-only reviewed checkout under `/opt/shucamoxa`,
private config under `/etc/shucamoxa/purchases`, and state under
`/var/lib/shucamoxa-purchases`. Keep the owner token and quote-publisher private
key inaccessible to the agent OS identity. The quote-publisher private key should
also be inaccessible to the payment-host identity; that host needs only its
public key. Install the unit only after adjusting its Node path to the actual
Node 22 installation and verifying ownership/permissions.

### Quote publication

The operator's quote publisher needs an Ed25519 keypair. For example, run these
under its private directory (not in the checkout or the agent environment):

```sh
umask 077
openssl genpkey -algorithm ED25519 -out quote-private.pem
openssl pkey -in quote-private.pem -pubout -out quote-public.pem
```

Prepare a claims JSON file with these fields:

```json
{
  "quote": {
    "id": "operator_quote",
    "source": "operator-reviewed rate source and timestamp",
    "zarPerRlusd": "20.000000",
    "issuedAt": "REPLACE_WITH_CURRENT_UTC_ISO_TIMESTAMP",
    "expiresAt": "REPLACE_WITH_UTC_EXPIRY_WITHIN_FIVE_MINUTES"
  },
  "maxFeeDrops": "100",
  "feeRlusd": "0.000100"
}
```

The numerical values above are illustrative, **not current market quotes**.
Review the actual RLUSD/ZAR rate and a conservative RLUSD equivalent of the
maximum payer XRP fee. Do not equate XRP drops, RLUSD, USD or ZAR. The host
refuses fee configuration changes until restarted; ordinary refreshed rate
quotes with unchanged fee ceilings may be atomically published to the same file.

```sh
node --import tsx services/backend/src/purchase-quote-sign.ts \
  /private/claims.json /private/quote-private.pem /private/quote.json
node --import tsx services/backend/src/purchase-main.ts /private/host.json
```

The second command belongs in the isolated host service, never the LLM agent
process. It binds **127.0.0.1:8090 only**. Remote access requires a separately
authenticated private transport/HTTPS deployment; do not expose this listener
publicly or weaken credential checks.

### HTTP and MCP contracts

All HTTP routes require the configured scoped Bearer token. No seed, signed
transaction blob or quote-publisher private key is returned by the host API.

| Method/path | Input | Authority |
|---|---|---|
| POST `/purchases` | `{resourceId, decision:"automatic"}` | Agent purchases within an owner mandate. |
| POST `/purchases` | `{resourceId, decision:"pay"}` | Owner pays explicitly; an agent gets `awaiting_owner`. |
| POST `/purchases/approve` or `/purchases/decline` | `{purchaseId}` | Owner only. |
| PUT `/purchases/policy` | PurchaseBudgetPolicy | Owner only; edits preserve spend and reservations. |
| POST `/purchases/budget` | `{categoryId}` | Scoped read of spent, reserved and remaining ZAR budget. |
| POST `/purchases/reconcile` | `{purchaseId}` | Reconcile without creating another transaction. |
| POST `/purchases/content` | `{purchaseId}` | Return buffered content only after verified settlement. |

Use `config/mcp.purchases.example.json` as a **client configuration template**.
Replace interpreter/path placeholders with values supported by your MCP client.
Give the gateway only `SHUCAMOXA_PURCHASE_AGENT_TOKEN`, never the owner token.
The process speaks stdio MCP; this does not automatically connect it to Open
WebUI or turn it into an HTTP MCP server. Existing WebUI transport integration
must be reviewed separately. The tools may spend Testnet funds after an owner
has enabled automatic purchases. Tool annotations are not authorization.

Purchased content is untrusted model input, even when paid for. Receiving it
does not grant permission to follow instructions to change policies, spend more,
reveal secrets or redistribute the publisher's content.

## Transfer provider handoff for the transaction AI

`createTestnetTransferWallet` accepts the isolated provider's wallet, independent
policy public key, fixed Testnet ledger connection and a synchronous callback to
`PaymentService.withSigningBoundary`. Wrap it into the existing authenticated
transfer host; do not attach raw wallet objects or seed files to model tools.
The existing Ed25519 permit binds the prepared intent; the provider fixes the
fee, sequence, memo, asset and bounded expiry itself and verifies actual signed
ledger bytes on lookup. Cross-service cryptographic co-signing of final XRPL
transaction bytes and any on-ledger signer list remain separate topology work.
The source adapter is not a claim that that final deployment already exists.

Privy remains the transaction AI's provider decision/workstream. No Privy account,
SDK, wallet migration, personal wallet import or production funds are introduced.

Parallel team branches appeared during this integration, including
`feat/t21-policy-tx-checks`, `feat/t22-policy-budget-reservation` and
`feat/t26-payment-service` (the latter uses singular `services/payment/`). They
were not silently merged or overwritten. The updated adversarial probes target
the merged T20 service at main `569829d`, whose default pipeline contains only
kill-switch/type/source checks. Review T21/T22 before describing their extra
checks as present on main. The new guarded adapters do not use that incomplete
T20 `/cosign` endpoint as a live signing gate.

## Live-release evidence still required

- Install and verify the OS isolation on the target host; show the agent cannot
  read state/seeds, access raw provider signing or call owner routes.
- Supply a funded dedicated Testnet payer, approved compatible HTTPS publisher,
  trust lines and independently reviewed fresh rate/fee attestation.
- Record actual allowed RLUSD settlement and content delivery; record blocked
  over-budget, unapproved-merchant and disabled-policy requests without signing.
- Record restart/unknown reconciliation and period-boundary evidence on that
  deployment. Keep the signed-expiry recovery limitation explicit.
- Independently review transaction-byte co-sign topology and issuer risks before
  stronger finance/security claims. There is no Mainnet release authorization.

Keep issues #31–#33 open until their live acceptance evidence exists. Local
generated-key signatures, scripted HTTP/ledger responses and an advertised
facilitator network are different evidence levels from a validated live purchase.

## Protocol references checked

- https://xrpl-x402.t54.ai/docs/xrpl-scheme
- https://xrpl-x402.t54.ai/docs/client-guides/typescript
- https://xrpl-x402.t54.ai/docs/quickstart
- https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_xrpl.md

The current v2 path uses `PAYMENT-REQUIRED` and `PAYMENT-SIGNATURE` with
`accepted` and `payload.signedTxBlob`. Older hash/receipt `X-PAYMENT` examples
are not silently mixed into this wire contract. The parser intentionally accepts
only the bounded Testnet RLUSD exact profile, not arbitrary schemes/extensions.
