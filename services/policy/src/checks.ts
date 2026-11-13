import type { CosignRequest, RuleCode, Rules } from "@shucamoxa/shared";

export type PolicyCheckContext = {
  decodedTx: Record<string, unknown>;
  request: CosignRequest;
  rules: Rules;
  treasuryAccount: string;
  agentAccount: string;
};

export type PolicyCheck = (ctx: PolicyCheckContext) => RuleCode | null;

/** Check 1: Kill switch is off. */
export const checkKillSwitch: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  if (ctx.rules.killSwitch) {
    return "KILL_SWITCH_ON";
  }
  return null;
};

/** Check 2: TransactionType is Payment and Account is the treasury. */
export const checkPaymentFromTreasury: PolicyCheck = (ctx: PolicyCheckContext): RuleCode | null => {
  if (ctx.decodedTx.TransactionType !== "Payment" || ctx.decodedTx.Account !== ctx.treasuryAccount) {
    return "FORBIDDEN_TX_FIELDS";
  }
  return null;
};

/** Ordered check pipeline for T20. Ships checks 1 and 2. */
export const DEFAULT_POLICY_CHECKS: readonly PolicyCheck[] = [
  checkKillSwitch,
  checkPaymentFromTreasury,
];
