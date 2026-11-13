# @payguard/shared

The contracts every PayGuard service imports: Zod 4 schemas, money maths, the audit log hash chain and
XRPL Testnet constants. Import from here instead of redefining a shape, so no two workstreams can
disagree about a field, a rule code, an amount or a hash.

Workstreams: W1 agent, W2 policy service, W3 payment service and XRPL, W4 backend API and audit log,
W5 owner dashboard.

## Exports

| Export | Module | What it is | Consumed by |
|---|---|---|---|
| `Amount` | money | Positive decimal string, up to 12 integer digits and 2 decimals | W1, W2, W3, W4, W5 |
| `NonNegativeAmount` | money | Same format, zero allowed (spent, reserved, remaining) | W4, W5 |
| `toCents`, `fromCents` | money | Decimal string to `bigint` cents and back (`"30"` to `3000n` to `"30.00"`) | W1, W2, W3, W4 |
| `compareAmounts`, `addAmounts` | money | Exact comparison and sum, no floats | W1, W2, W4, W5 |
| `InvoiceNumber` | ids | `^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$`, ASCII only | W1, W2, W3, W4, W5 |
| `SupplierId` | ids | `^sup_[a-z0-9_]{1,48}$` | W1, W2, W3, W4, W5 |
| `SupplierName` | ids | 1 to 120 characters (code points), NFKC-normalised, no control, invisible or blank-lookalike characters | W1, W4, W5 |
| `Reason` | ids | 1 to 200 characters, no control or invisible characters, no `<` or `>` | W1, W3, W4 |
| `XrplAddress` | ids | Classic address, checksum verified by `ripple-address-codec`; the three black-hole accounts refused | W2, W3, W4, W5 (W1 for `propose_supplier` only) |
| `PayRequest` | agent-api | `pay` tool input and `POST /payments` body (strict) | W1, W3 |
| `PayResult` | agent-api | `POST /payments` answer: settled, blocked or pending_approval | W1, W3 |
| `ExtractedInvoice` | agent-api | Stage 1 extraction output | W1 |
| `Rules` | agent-api | `GET /rules` answer; suppliers are `{id, name}` only, strict | W1, W4, W5 |
| `SupplierLookup` | agent-api | `GET /suppliers?q=` answer: a match with confidence, or `{notFound: true}` | W1, W4 |
| `LogFilter` | agent-api | `GET /log` query | W1, W4, W5 |
| `AgentDecision`, `AgentExplanation` | agent-api | `{decision, ruleCode, explanation, invoiceNumber}`; `paid` exactly when `ruleCode` is `OK` | W1, W4, W5 |
| `SupplierApprovalPayload`, `PaymentApprovalPayload` | approvals | The two approval payloads | W1, W4, W5 |
| `ApprovalRequest` | approvals | `POST /approvals` body: `{kind: "supplier" \| "payment", payload}` | W1, W4 |
| `ApprovalResponse` | approvals | `{approvalId, status: "pending"}` | W1, W4 |
| `RuleCode`, `ruleExplanation` | policy | The 13 rule codes and one fixed sentence per code | W1, W2, W3, W4, W5 |
| `Sha256Hex` | policy | 64 lower-case hex characters | W2, W3, W4 |
| `HexBlob` | policy | Signed transaction blob in hex | W2, W3 |
| `CosignRequest`, `CosignResponse` | policy | `POST /cosign` body and answer; `allow` has `OK` and a blob, `block` has neither | W2, W3 |
| `LogEvent`, `Actor` | log | The 13 log events; `agent`, `payment`, `policy`, `owner`, `system` | W2, W3, W4, W5 |
| `LogEntry` | log | One audit log row (strict; every field is covered by the hash) | W1, W2, W3, W4, W5 |
| `canonicalJson` | log | Sorted-key JSON that refuses floats, `undefined`, functions, class instances and cycles | W4, W5 |
| `hashLogEntry` | log | `sha256(prevHash + canonicalJson(rowWithoutHash))`, lower-case hex, async | W2, W3, W4, W5 |
| `verifyChain` | log | First bad `seq` in an oldest-first log (row fails `LogEntry`, seq not 1, 2, 3..., broken link or hash), or `null` | W4, W5 |
| `toHex`, `fromHex` | log | UTF-8 text to upper-case hex and back, for memo fields | W2, W3 |
| `RLUSD_CURRENCY_HEX`, `RLUSD_TESTNET_ISSUER` | constants | RLUSD on Testnet | W2, W3 |
| `XRPL_TESTNET_WSS` | constants | Public Testnet WebSocket endpoint | W2, W3 |
| `MEMO_TYPE` | constants | `"payguard/log"` (put `toHex(MEMO_TYPE)` on the ledger) | W2, W3 |
| `LAST_LEDGER_WINDOW` | constants | 20 ledgers | W2, W3 |
| `RATE_LIMIT` | constants | `{count: 5, windowMs: 60000}`, frozen | W2 |
| `RESERVATION_TTL_MS` | constants | 120000 | W2, W3 |
| `GENESIS_HASH` | constants | 64 zeros, the first row's `prevHash` | W4, W5 |

Every schema export also has a TypeScript type of the same name (`type PayRequest = z.infer<...>`).

## Rules of use

- **Money.** Amounts are decimal strings end to end. Compare and add with `toCents`, `compareAmounts`
  and `addAmounts`, never `Number(...)`. `addAmounts` throws rather than return a sum past
  `999999999999.99`. An XRPL `value` such as `"30"` or `"30.00"` is the same amount: compare in cents.
- **Hashing is async.** `hashLogEntry` and `verifyChain` return promises because they use Web Crypto
  (`globalThis.crypto.subtle`). That works in Node 20 and later, and in browsers only in a secure
  context (HTTPS or `localhost`). The dashboard must not be served over plain HTTP on another host.
- **What gets hashed.** The row without `hash`, including its own `seq`, `ts` and `prevHash`.
  `hashLogEntry` throws if the row's `prevHash` differs from the one passed in, or if a `hash` key is
  present. `ts` is hashed as the exact string stored, so store it once (ISO UTC) and never reformat it.
- **Known answer.** `test/log.test.ts` holds a fixed entry and its hash
  (`03de26b9343749d04738c706e3b015f59e2c90233ab56ccac30f9e31b7dced43`, from `GENESIS_HASH`). Any
  service that hashes log rows should assert the same value in its own tests.
- **verifyChain** expects the full log, oldest first, starting at `GENESIS_HASH` with `seq` 1, 2, 3 and
  so on with no gaps. Each row must parse as `LogEntry`. `GET /log` returns newest first, so reverse it.
  A deleted or reordered row is reported at the row after the gap. A missing Web Crypto throws rather
  than reporting a broken log. Cutting
  rows off the end of the log can't be seen from the log alone; each payment's memo anchors it.
- **Memos.** `MemoType` is `toHex(MEMO_TYPE)`. `MemoData` is the pending entry's hash itself (it is
  already 64 hex characters). XRPL returns memo hex in upper case, so lower-case it before comparing
  it with a `Sha256Hex`.
- **Strings.** `InvoiceNumber` may contain `/` and `.`: never use one as a file path. `SupplierName`
  and `Reason` refuse zero-width, bidi-override and other invisible characters, and values made only of
  whitespace, Hangul fillers or braille blanks. `SupplierName` must also be NFKC-normalised, so
  fullwidth lookalikes ("Ａcme"), ligatures, "™" and decomposed accents are refused; normalise a name
  with `name.normalize("NFKC")` before saving it. This also refuses ZWNJ, which a few scripts (such as
  Persian) use. Zod counts lengths in code points.
- **Strict objects.** Agent-facing reads (`Rules`, `SupplierLookup`) and every request body are strict,
  so an address or an unexpected flag in them is a parse error, not something silently passed along.
