import { bindPurchase, decodePaymentRequired, type Merchant, type PurchaseBinding } from "./x402";

/** Network transport only. The independent signer supplies a payment payload after policy approval. */
export class X402MerchantClient {
  constructor(private readonly merchant: Merchant, private readonly fetcher: typeof fetch = fetch) {}
  /** Re-resolve merchant terms at the signer, independently of the caller's binding digest. */
  validate(binding:PurchaseBinding):void {
    const rebuilt=bindPurchase({purchaseId:binding.purchaseId,ownerId:binding.ownerId,categoryId:binding.categoryId,
      requestedUrl:binding.resourceUrl,challenge:binding.challenge,merchant:this.merchant,
      receivedAt:new Date(Date.parse(binding.expiresAt)-binding.challenge.accepts[0]!.maxTimeoutSeconds*1000)});
    if(rebuilt.digest!==binding.digest)throw new Error('PURCHASE_MISMATCH');
  }

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
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
    try {
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > 1_000_000) { await reader.cancel(); throw new Error('DELIVERY_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    return bytes;
  }
}
