import { bindPurchase, decodePaymentRequired, type Merchant, type PurchaseBinding } from "./x402";

/** Network transport only. The independent signer supplies a payment payload after policy approval. */
export class X402MerchantClient {
  constructor(private readonly merchant: Merchant, private readonly fetcher: typeof fetch = fetch) {}

  private url(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== this.merchant.origin || url.username || url.password || url.hash)
      throw new Error("MERCHANT_MISMATCH");
    return url;
  }

  async challenge(input: { purchaseId: string; ownerId: string; categoryId: string; resourceUrl: string },
    receivedAt = new Date()): Promise<PurchaseBinding> {
    const url = this.url(input.resourceUrl);
    const response = await this.fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (response.status !== 402) throw new Error("CHALLENGE_INVALID");
    const header = response.headers.get("payment-required");
    if (!header) throw new Error("CHALLENGE_INVALID");
    return bindPurchase({ purchaseId: input.purchaseId, ownerId: input.ownerId,
      categoryId: input.categoryId, requestedUrl: url.href,
      challenge: decodePaymentRequired(header), merchant: this.merchant, receivedAt });
  }

  /** Call only after independently verified settlement. A signed payload is not a settlement receipt. */
  async deliver(binding: PurchaseBinding, paymentSignature: string): Promise<Uint8Array> {
    const url = this.url(binding.resourceUrl);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(paymentSignature) || paymentSignature.length > 16_384)
      throw new Error("PAYMENT_SIGNATURE_INVALID");
    const response = await this.fetcher(url, { method: "GET", redirect: "manual",
      headers: { "payment-signature": paymentSignature }, signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200 || response.url && response.url !== url.href) throw new Error("DELIVERY_FAILED");
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > 1_000_000) throw new Error("DELIVERY_TOO_LARGE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 1_000_000) throw new Error("DELIVERY_TOO_LARGE");
    return bytes;
  }
}
