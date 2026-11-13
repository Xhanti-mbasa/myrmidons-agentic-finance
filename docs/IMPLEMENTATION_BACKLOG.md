# Implementation backlog: payment controls and paid resources

Snapshot: 13 November 2026. Source baseline `47b6c55`; inspect current branches
and handoffs before using this snapshot as implementation evidence. These issues
extend the invoice-payment MVP; paid-resource work does not silently replace its
release criteria. No Mainnet or real-value execution is authorized here.

| Issue | Work and evidence | Remaining gate |
|---|---|---|
| [#30](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/30) | Verification and [shared handoff](HANDOFF_ISSUE30.md) complete. Cumulative RLUSD caps, budget and disable semantics checked; typecheck and 67 payment-project tests passed on `c9d415b`. | Actual independent signer and Testnet evidence belong to #31; simulated tests do not establish deployment. |
| [#31](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/31) | Signed permit and wallet guard source integrated locally; simulated tests pass. | Exact transaction-bound authorization, signer isolation, approved provider integration and live Testnet allowed/blocked evidence. Privy remains with the transaction workstream. |
| [#32](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/32) | Restricted x402 parser, purchase coordinator, budget bridge and pinned-origin merchant transport integrated locally; scripted tests pass. [Handoff](HANDOFF_ISSUE32.md). | Compose independent signing and periodic budgets; controlled merchant successful access/blocked overspend and explicit retry/delivery-failure behavior. |
| [#33](https://github.com/Xhanti-mbasa/myrmidons-agentic-finance/issues/33) | Owner-selected daily/weekly/monthly category budget coordinator integrated locally; simulated tests pass. [Handoff](HANDOFF_ISSUE33.md). | Trusted FX/fee quote provider, independent signing integration and live rollover evidence. |

All four workstreams require honest separation of source inspection, fake-adapter
tests, local HTTP/model evidence and actual validated ledger transactions. Owner
controls and deployment isolation must be enforced outside the model. The current
invoice APIs and transfer/purchase extensions require explicit adapters.
