import { describe, expect, it, vi } from "vitest";
import { X402MerchantClient } from "../src/x402-merchant";
import { RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER } from "../../../packages/shared/src/constants";

const url = "https://merchant.example/article/1";
const merchant = { id: "demo", origin: "https://merchant.example", payTo: RLUSD_TESTNET_ISSUER,
  facilitator: "https://x402.org/facilitator" as const, termsUrl: "https://merchant.example/terms" };
const challenge = { x402Version: 2, resource: { url }, accepts: [{ scheme: "exact", network: "xrpl:1",
  asset: RLUSD_CURRENCY_HEX, payTo: RLUSD_TESTNET_ISSUER, amount: "0.005", maxTimeoutSeconds: 60,
  extra: { issuer: RLUSD_TESTNET_ISSUER, areFeesSponsored: false, assetTransferMethod: "sequence", invoiceId: "article1" } }] };
const required = new Response(null, { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") } });
const input = { purchaseId: "11111111-1111-4111-8111-111111111111", ownerId: "owner", categoryId: "articles", resourceUrl: url };

describe("controlled merchant transport", () => {
  it("binds the 402 challenge and unlocks content with a signed payload only after caller authorization", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(required).mockResolvedValueOnce(new Response("article", { status: 200 }));
    const client = new X402MerchantClient(merchant, fetcher);
    const binding = await client.challenge(input, new Date("2026-11-13T12:00:00Z"));
    expect(binding.challenge.accepts[0]?.amount).toBe("0.005");
    expect(new TextDecoder().decode(await client.deliver(binding, "c2lnbmVk"))).toBe("article");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ headers: { "payment-signature": "c2lnbmVk" }, redirect: "manual" });
  });
  it("refuses redirects, other origins, missing challenges, and oversized content", async () => {
    const redirect = new X402MerchantClient(merchant, vi.fn().mockResolvedValue(new Response(null, { status: 302 })));
    await expect(redirect.challenge(input)).rejects.toThrow("CHALLENGE_INVALID");
    await expect(redirect.challenge({ ...input, resourceUrl: "https://evil.example/article/1" })).rejects.toThrow("MERCHANT_MISMATCH");
    const missing = new X402MerchantClient(merchant, vi.fn().mockResolvedValue(new Response(null, { status: 402 })));
    await expect(missing.challenge(input)).rejects.toThrow("CHALLENGE_INVALID");
    const oversized = new X402MerchantClient(merchant, vi.fn().mockResolvedValue(new Response("x", { status: 200, headers: { "content-length": "1000001" } })));
    const binding = await new X402MerchantClient(merchant, vi.fn().mockResolvedValue(required)).challenge(input);
    await expect(oversized.deliver(binding, "c2lnbmVk")).rejects.toThrow("DELIVERY_TOO_LARGE");
  });
});
