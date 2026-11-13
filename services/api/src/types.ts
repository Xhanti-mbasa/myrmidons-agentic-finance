import type { PayRequest, RuleCode } from "@shucamoxa/shared";
import type { ShucamoxaDb } from "@shucamoxa/db";
import type { ApiServerConfig } from "./config";

export type PaymentRelayResult =
  | { status: "settled"; txHash: string }
  | { status: "blocked"; ruleCode: RuleCode; reason?: string };

export interface PaymentRelayer {
  relay(request: PayRequest, reservationId: number): Promise<PaymentRelayResult>;
}

export interface ApiDeps {
  db: ShucamoxaDb;
  config: ApiServerConfig;
  paymentRelayer?: PaymentRelayer;
}
