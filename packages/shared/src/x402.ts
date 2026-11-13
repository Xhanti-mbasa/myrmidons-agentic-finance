import { z } from 'zod';
import { XrplAddress } from './ids';
import { PositiveMicroAmount } from './purchase-budgets';
import { RLUSD_CURRENCY_HEX, RLUSD_TESTNET_ISSUER } from './constants';

/** Deliberately restricted v2 profile: Testnet RLUSD, sequence, exact and payer fees. */
export const X402Requirements = z.strictObject({
  scheme: z.literal('exact'), network: z.literal('xrpl:1'),
  asset: z.literal(RLUSD_CURRENCY_HEX), payTo: XrplAddress,
  amount: PositiveMicroAmount,
  maxTimeoutSeconds: z.number().int().min(1).max(120),
  extra: z.strictObject({ issuer: z.literal(RLUSD_TESTNET_ISSUER), areFeesSponsored: z.literal(false).optional(),
    assetTransferMethod: z.literal('sequence').optional(), invoiceId: z.string().min(1).max(128),
    sourceTag: z.number().int().min(0).max(4294967295).optional(),
    destinationTag: z.number().int().min(0).max(4294967295).optional() }),
});
export type X402Requirements = z.infer<typeof X402Requirements>;
export const X402Challenge = z.strictObject({ x402Version: z.literal(2),
  resource: z.strictObject({ url: z.url().max(2048), description: z.string().max(256).optional(),
    mimeType: z.string().max(128).optional() }), accepts: z.array(X402Requirements).length(1) });
export type X402Challenge = z.infer<typeof X402Challenge>;
export const X402_CODES = ['CHALLENGE_INVALID', 'MERCHANT_MISMATCH', 'RESOURCE_MISMATCH',
  'CHALLENGE_EXPIRED', 'AWAITING_OWNER', 'DECLINED', 'UNKNOWN', 'DELIVERED', 'DELIVERY_FAILED',
  'PURCHASE_MISMATCH', 'BLOCKED'] as const;
