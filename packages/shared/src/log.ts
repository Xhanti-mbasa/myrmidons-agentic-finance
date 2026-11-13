import { z } from "zod";
import { Amount } from "./money";
import { InvoiceNumber, SupplierId } from "./ids";
import { RuleCode, Sha256Hex } from "./policy";
import { GENESIS_HASH } from "./constants";

/** The 13 audit log events in the spec. */
export const LogEvent = z.enum([
  "invoice_received",
  "invoice_extracted",
  "payment_requested",
  "policy_allowed",
  "policy_blocked",
  "payment_settled",
  "payment_failed",
  "approval_requested",
  "approval_decided",
  "rules_changed",
  "kill_switch_on",
  "kill_switch_off",
  "signer_list_changed",
]);
export type LogEvent = z.infer<typeof LogEvent>;

export const Actor = z.enum(["agent", "payment", "policy", "owner", "system"]);
export type Actor = z.infer<typeof Actor>;

/** One audit log row as stored and as returned by GET /log. Strict: every field is covered by the hash. */
export const LogEntry = z.strictObject({
  seq: z.int().positive(),
  ts: z.iso.datetime(),
  actor: Actor,
  event: LogEvent,
  invoiceNumber: InvoiceNumber.nullable(),
  supplierId: SupplierId.nullable(),
  amount: Amount.nullable(),
  ruleCode: RuleCode.nullable(),
  explanation: z.string().max(500),
  txHash: z.string().regex(/^[0-9A-Fa-f]{64}$/, "expected a 64-hex XRPL transaction hash").nullable(),
  ledgerResult: z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "expected an XRPL result code like tesSUCCESS").nullable(),
  prevHash: Sha256Hex,
  hash: Sha256Hex,
});
export type LogEntry = z.infer<typeof LogEntry>;

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit (the same order as RFC 8785), no whitespace.
 * Accepts only null, booleans, strings, safe integers, arrays and plain objects. Throws on undefined,
 * functions, symbols, bigints, NaN, Infinity, non-integer or unsafe numbers (money must be a string),
 * array holes, class instances such as Date or Map, and cycles. Never silently drops a value.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set());
}

function encode(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new TypeError("canonicalJson: numbers must be safe integers; write money as a string");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: cannot encode a ${typeof value}`);
  }

  const obj = value as object;
  if (ancestors.has(obj)) throw new TypeError("canonicalJson: cycle detected");
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(obj, i)) throw new TypeError("canonicalJson: arrays must not have holes");
        parts.push(encode(obj[i], ancestors));
      }
      return `[${parts.join(",")}]`;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) throw new TypeError("canonicalJson: only plain objects can be encoded");
    if (Object.getOwnPropertySymbols(obj).length > 0) throw new TypeError("canonicalJson: symbol keys cannot be encoded");
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key], ancestors)}`).join(",")}}`;
  } finally {
    ancestors.delete(obj);
  }
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

/** Shared hash preimage for invoice and transfer audit chains; suitable for synchronous DB writers. */
export function auditHashInput(prevHash: string, entryWithoutHash: { prevHash: string }): string {
  if (!LOWER_HEX_64.test(prevHash) || entryWithoutHash.prevHash !== prevHash ||
      Object.prototype.hasOwnProperty.call(entryWithoutHash, "hash")) {
    throw new TypeError("auditHashInput: invalid chain link or unexpected hash field");
  }
  return prevHash + canonicalJson(entryWithoutHash);
}

/**
 * hash = SHA-256(prevHash + canonicalJson(entry)) as 64 lower-case hex characters. The entry is the row
 * without its hash and includes its own prevHash, seq and ts. Async because it uses Web Crypto
 * (globalThis.crypto.subtle), which exists in Node 20+ and in browsers in a secure context (HTTPS or localhost).
 */
export async function hashLogEntry(prevHash: string, entryWithoutHash: Omit<LogEntry, "hash">): Promise<string> {
  if (typeof prevHash !== "string" || !LOWER_HEX_64.test(prevHash)) {
    throw new TypeError("hashLogEntry: prevHash must be 64 lower-case hex characters");
  }
  if (Object.prototype.hasOwnProperty.call(entryWithoutHash, "hash")) {
    throw new TypeError("hashLogEntry: pass the entry without its hash field");
  }
  if (entryWithoutHash.prevHash !== prevHash) {
    throw new TypeError("hashLogEntry: entry.prevHash must equal the prevHash being chained from");
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("hashLogEntry: Web Crypto is unavailable (needs Node 20+ or a browser secure context)");
  const bytes = new TextEncoder().encode(auditHashInput(prevHash, entryWithoutHash));
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Checks a whole log, oldest first, starting from GENESIS_HASH. Returns the seq of the first row that
 * doesn't parse as a LogEntry, whose seq isn't the previous seq plus 1 (starting at 1), whose prevHash
 * doesn't link to the row before it, or whose hash doesn't recompute. Returns null if the log is intact.
 * A deleted or reordered row shows up at the row after the gap. Truncating the newest rows can't be
 * seen from the log alone; the memo on each settled payment anchors the chain on the ledger.
 * A row too malformed to have a numeric seq is reported as the seq it should have had.
 */
export async function verifyChain(entries: readonly LogEntry[]): Promise<number | null> {
  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const raw of entries) {
    const parsed = LogEntry.safeParse(raw);
    if (!parsed.success) return typeof raw?.seq === "number" ? raw.seq : expectedSeq;
    const entry = parsed.data;
    if (entry.seq !== expectedSeq) return entry.seq;
    if (entry.prevHash !== expectedPrev) return entry.seq;
    const { hash, ...rest } = entry;
    // A parsed row always canonicalises, so this only throws for a missing Web Crypto, which is an
    // environment error to surface, not a broken log.
    if ((await hashLogEntry(entry.prevHash, rest)) !== hash) return entry.seq;
    expectedPrev = hash;
    expectedSeq += 1;
  }
  return null;
}

/** UTF-8 text to upper-case hex, as XRPL memo fields are written (MemoType = toHex(MEMO_TYPE)). */
export function toHex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Hex (either case) to UTF-8 text. Throws on odd length, non-hex characters or invalid UTF-8. */
export function fromHex(hex: string): string {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(hex)) {
    throw new TypeError("fromHex: expected an even-length hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
