import { Client } from "xrpl";
import { HttpPolicyClient } from "../../payment/src/policy-client";
import { PaymentService } from "../../payment/src/payment-service";
import { assertTestnetWss } from "../../payment/src/config";
import type { PolicyClientLike, XrplClientLike } from "../../payment/src/types";
import type { SettlerFactory } from "./settlement";

export type TestnetSettlerOptions = {
  /** Seed of the payment signer (weight 1 on the treasury signer list). Never given to the agent. */
  paymentSignerSeed: string;
  treasuryAccount: string;
  policyAccount: string;
  xrplWss: string;
  policyUrl: string;
  policyCallerToken: string;
  /** Tests only: replace the ledger and policy connections. */
  xrplClient?: XrplClientLike;
  policyClient?: PolicyClientLike;
};

/**
 * Real settlement: the payment service multisigns an RLUSD Payment from the treasury with the payment
 * signer, asks the independent policy service to co-sign, combines both signatures and submits to XRPL
 * Testnet. The treasury's signer list (quorum 2, master key disabled) means neither signer alone can pay.
 * Every step is written to the store's hash-chained log.
 */
export function testnetSettler(options: TestnetSettlerOptions): SettlerFactory {
  assertTestnetWss(options.xrplWss);
  return (ctx) => {
    const client: XrplClientLike = options.xrplClient ?? new Client(options.xrplWss);
    const service = new PaymentService({
      agentSeed: options.paymentSignerSeed,
      treasuryAccount: options.treasuryAccount,
      policyAccount: options.policyAccount,
      rulesStore: { getSupplier: (id) => ctx.supplier(id) },
      auditLog: { append: (entry) => ctx.append(entry) },
      policyClient: options.policyClient ?? new HttpPolicyClient(options.policyUrl, options.policyCallerToken),
      xrplClient: client,
    });
    return {
      mode: "xrpl-testnet",
      async settle(request) {
        if (client.isConnected && !client.isConnected()) await client.connect?.();
        return service.pay(request);
      },
    };
  };
}
