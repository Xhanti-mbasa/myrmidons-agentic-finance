import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Client, decode, hashes, xrpToDrops, type Payment } from "xrpl";
import { canonicalJson, compareAmounts, toCents, RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER, XRPL_TESTNET_WSS } from "@shucamoxa/shared";
import type { PaymentAdapters, PreparedTransfer } from "../../payments/src/payment";
import { prepareTransfer } from "./prepare-transfer";

/** The signer must independently enforce policy, revocation and source ownership. It must never broadcast. */
export interface TrustedSigner {
  sign(input: { payment: PreparedTransfer; digest: string; authorization: string; transaction: Payment }): Promise<string>;
}

type Row = { digest: string; hash: string | null; tx: string | null };
const digestOf = (p: PreparedTransfer) => createHash("sha256").update(canonicalJson(p)).digest("hex");
const unknown = (digest: string) => ({ status: "unknown" as const, paymentDigest: digest });

/** Use a private durable database and an independently enforcing signer; never expose this object to the agent. */
type WalletAdapter = PaymentAdapters["wallet"];
export class XrplWalletAdapter implements WalletAdapter {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly signer: TrustedSigner) {
    if (!path || path === ":memory:" || path.startsWith("file:")) throw new Error("A private durable database path is required");
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS wallet_operations (intent TEXT PRIMARY KEY, digest TEXT NOT NULL, hash TEXT, tx TEXT);`);
  }
  close() { this.db.close(); }
  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT digest, hash, tx FROM wallet_operations WHERE intent=?").get(id) as Row | undefined;
  }
  async submit(payment: PreparedTransfer, permit: { paymentDigest: string; authorization: string }) {
    payment = Object.freeze(structuredClone(payment));
    const digest = digestOf(payment);
    if (digest !== permit.paymentDigest || !permit.authorization || payment.network !== XRPL_TESTNET_WSS) return unknown(digest);
    // Claim before any async work. A crash leaves an unresolved operation, never a retry.
    try { this.db.prepare("INSERT INTO wallet_operations(intent,digest) VALUES(?,?)").run(payment.intentId, digest); }
    catch { return unknown(digest); }
    const client = new Client(XRPL_TESTNET_WSS, { timeout: 20000 });
    try {
      await client.connect();
      const info = await client.request({ command: "account_info", account: payment.sourceAddress, ledger_index: "validated" });
      const server = (await client.request({ command: "server_info" })).result.info.validated_ledger;
      if (!server) return unknown(digest);
      const base = BigInt(xrpToDrops(String(server.reserve_base_xrp)));
      const increment = BigInt(xrpToDrops(String(server.reserve_inc_xrp)));
      if (BigInt(info.result.account_data.Balance) < base + increment * BigInt(info.result.account_data.OwnerCount) + 100n) return unknown(digest);
      const sourceLines = (await client.request({ command: "account_lines", account: payment.sourceAddress, peer: RLUSD_TESTNET_ISSUER, ledger_index: "validated" })).result;
      const destLines = (await client.request({ command: "account_lines", account: payment.destination, peer: RLUSD_TESTNET_ISSUER, ledger_index: "validated" })).result;
      if (sourceLines.marker || destLines.marker) return unknown(digest);
      const source = sourceLines.lines.find(l => l.account === RLUSD_TESTNET_ISSUER && l.currency === RLUSD_CURRENCY_HEX);
      const destination = destLines.lines.find(l => l.account === RLUSD_TESTNET_ISSUER && l.currency === RLUSD_CURRENCY_HEX);
      if (!source || !destination || source.freeze || source.freeze_peer || destination.freeze || destination.freeze_peer ||
          toCents(source.balance) < toCents(payment.amount) ||
          toCents(destination.limit) - toCents(destination.balance) < toCents(payment.amount)) return unknown(digest);
      const ledger = await client.getLedgerIndex();
      const transaction = prepareTransfer(payment, info.result.account_data.Sequence, ledger);
      const expectedTransaction = canonicalJson(transaction);
      // The external signer must validate the exact transaction and permit, and must not submit it.
      const blob = await this.signer.sign({ payment, digest, authorization: permit.authorization, transaction: structuredClone(transaction) });
      const decoded = decode(blob);
      const { SigningPubKey: _publicKey, TxnSignature: _signature, Signers: _signers, ...body } = decoded;
      if (canonicalJson(body) !== expectedTransaction) return unknown(digest);
      const hash = hashes.hashSignedTx(blob);
      // SQLite FULL synchronous commit precedes broadcast; only the hash and unsigned transaction are stored.
      const stored = this.db.prepare("UPDATE wallet_operations SET hash=?, tx=? WHERE intent=? AND digest=? AND hash IS NULL")
        .run(hash, canonicalJson(transaction), payment.intentId, digest);
      if (stored.changes !== 1) return unknown(digest);
      await client.submit(blob);
      return await this.lookupWithClient(client, payment, digest, hash);
    } catch { return unknown(digest); }
    finally { if (client.isConnected()) await client.disconnect().catch(() => undefined); }
  }
  async lookup(payment: PreparedTransfer, digest: string, txHash?: string) {
    const row = this.row(payment.intentId);
    if (digestOf(payment) !== digest || !row?.hash || row.digest !== digest || (txHash && txHash !== row.hash)) return unknown(digest);
    const client = new Client(XRPL_TESTNET_WSS, { timeout: 20000 });
    try { await client.connect(); return await this.lookupWithClient(client, payment, digest, row.hash); }
    catch { return unknown(digest); }
    finally { if (client.isConnected()) await client.disconnect().catch(() => undefined); }
  }
  private async lookupWithClient(client: Client, payment: PreparedTransfer, digest: string, hash: string) {
    const row = this.row(payment.intentId);
    if (!row || row.digest !== digest || row.hash !== hash || !row.tx) return unknown(digest);
    const result = (await client.request({ command: "tx", transaction: hash })).result;
    if (!result.validated || result.hash !== hash || !result.ledger_index || !result.meta || typeof result.meta !== "object") return unknown(digest);
    const tx = result.tx_json as unknown as Record<string, unknown>;
    const expected = JSON.parse(row.tx) as Payment;
    const amount = (a: unknown) => {
      if (!a || typeof a !== "object") return false;
      const v = a as Record<string, unknown>;
      if (v.currency !== RLUSD_CURRENCY_HEX || v.issuer !== RLUSD_TESTNET_ISSUER || typeof v.value !== "string") return false;
      try { return compareAmounts(v.value.replace(/(\.\d{1,2})0+$/, "$1"), payment.amount) === 0; } catch { return false; }
    };
    if (tx.TransactionType !== "Payment" || tx.Account !== expected.Account || tx.Destination !== expected.Destination ||
        tx.DestinationTag !== expected.DestinationTag || tx.Sequence !== expected.Sequence || tx.Fee !== expected.Fee ||
        tx.LastLedgerSequence !== expected.LastLedgerSequence || canonicalJson(tx.Memos) !== canonicalJson(expected.Memos) ||
        tx.Paths !== undefined || tx.SendMax !== undefined || tx.DeliverMin !== undefined ||
        (tx.Flags !== undefined && (typeof tx.Flags !== "number" || (tx.Flags & 0x00020000) !== 0)) || !amount(tx.DeliverMax ?? tx.Amount)) return unknown(digest);
    const ledgerResult = result.meta.TransactionResult;
    if (ledgerResult === "tesSUCCESS" && amount((result.meta as { delivered_amount?: unknown }).delivered_amount))
      return { status: "settled" as const, paymentDigest: digest, txHash: hash, validated: true as const, ledgerIndex: result.ledger_index, ledgerResult };
    if (typeof ledgerResult === "string" && /^tec[A-Za-z0-9_]+$/.test(ledgerResult))
      return { status: "rejected" as const, paymentDigest: digest, txHash: hash, validated: true as const, ledgerIndex: result.ledger_index, ledgerResult };
    return unknown(digest);
  }
}
