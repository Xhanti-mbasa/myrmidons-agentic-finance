import { createHash } from "node:crypto";

/** RFC 4648 base32 alphabet (upper case, no padding). */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * The invoice number for a payment or approval that comes from owner chat rather than an invoice:
 * `CHAT-<YYYYMMDD UTC>-<8 base32 chars>` from sha256(normalised message + date).
 * Deterministic so that Open WebUI "Regenerate" does not create duplicate payments.
 */
export function chatInvoiceNumber(message: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const normalised = (message ?? "").trim().toLowerCase();
  const hash = createHash("sha256").update(normalised + date).digest();
  let bits = 0n;
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(hash[i]!);
  let suffix = "";
  for (let i = 7; i >= 0; i--) suffix += BASE32[Number((bits >> BigInt(i * 5)) & 31n)];
  return `CHAT-${date}-${suffix}`;
}
