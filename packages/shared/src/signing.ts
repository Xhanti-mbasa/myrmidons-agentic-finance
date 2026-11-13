import { z } from "zod";
import { Sha256Hex } from "./policy";
import { TransferId } from "./transfers";

/** Public permit claims. The policy signing private key never belongs to the agent or wallet. */
export const SigningPermitClaims = z.strictObject({
  version: z.literal(1), audience: z.literal("shucamoxa-testnet-wallet"),
  paymentDigest: Sha256Hex, intentId: TransferId, policyVersion: z.int().positive(),
  expiresAt: z.iso.datetime(),
});
export type SigningPermitClaims = z.infer<typeof SigningPermitClaims>;
