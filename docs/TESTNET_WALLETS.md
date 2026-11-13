# XRPL Testnet wallet setup

Created locally on 13 November 2026 for controlled testing. These are **public
addresses only**; no seeds, private keys or signer credentials belong in Git.

| Role | Testnet public address | State |
|---|---|---|
| Sender candidate | `rQ3BkZ7NppFkptVu55B2MqhYgQTBeqzUMP` | Keypair generated locally; funding and ledger activation not verified. |
| Receiver candidate | `rLajzTaUFgvkY9bu4ymxoFC5FHY6247QnB` | Keypair generated locally; trust line and ledger activation not verified. |

The local secret files are under the owner's private
`~/.local/share/shucamoxa-testnet/wallets/` directory. Creation verified
directory mode `700` and file mode `600`; this repository does not contain or
load those files. A developer cloning this repository does **not** obtain
payment authority from these addresses. Do not use these keypairs on Mainnet.

Before any payment test: fund the accounts with Testnet XRP, establish and
verify the genuine test RLUSD trust lines and issuer, decide and deploy the
mandatory independent signing topology, and verify that the agent cannot reach
the raw keys. The current payment service still uses abstract wallet adapters.
No funding, RLUSD balance, signing configuration or validated transaction is
claimed here.
