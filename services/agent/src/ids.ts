/** RFC 4648 base32 alphabet (upper case, no padding). */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const cryptoBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/**
 * The invoice number for a payment or approval that comes from owner chat rather than an invoice:
 * `CHAT-<YYYYMMDD UTC>-<8 base32 chars>` from 40 random bits. It can never equal a supplier invoice
 * number, so chat cannot squat on one. Shared with T08 (chat pay); keep the scheme in this one place.
 */
export function chatInvoiceNumber(now: Date = new Date(), randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  const bytes = randomBytes(5);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let suffix = "";
  for (let i = 7; i >= 0; i--) suffix += BASE32[Number((bits >> BigInt(i * 5)) & 31n)];
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `CHAT-${date}-${suffix}`;
}
