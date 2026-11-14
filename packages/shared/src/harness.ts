import { z } from 'zod';
import { AccountId, TransferId } from './transfers';
import { XrplAddress } from './ids';
import { Amount } from './money';
export const HarnessAction = z.enum(['pay', 'purchase', 'bridge']);
export const HarnessTarget = z.strictObject({ action: HarnessAction, targetId: z.string().min(1).max(64) }).superRefine((v, ctx) => {
  if (!(v.action === 'pay' ? TransferId : AccountId).safeParse(v.targetId).success)
    ctx.addIssue({ code: 'custom', message: 'Invalid target ID' });
});
export const HarnessGrant = z.strictObject({
  action: HarnessAction, targetId: z.string().min(1).max(64), label: z.string().min(1).max(100),
  category: AccountId, eligible: z.boolean(), evidenceRef: z.string().min(1).max(120), expiresAt: z.iso.datetime(),
}).superRefine((v, ctx) => {
  if (!(v.action === 'pay' ? TransferId : AccountId).safeParse(v.targetId).success)
    ctx.addIssue({ code: 'custom', message: 'Invalid target ID' });
});
export const HarnessFlow = z.strictObject({ id: AccountId, label: z.string().min(1).max(100), steps: z.array(HarnessTarget).min(1).max(10) });
export const HarnessPolicy = z.strictObject({
  enabled: z.boolean(), profile: z.enum(['importer', 'university', 'retailer', 'custom']),
  allowedCategories: z.array(AccountId).min(1).max(100),
  plugins: z.strictObject({ automation: z.boolean(), bridge: z.boolean() }),
  grants: z.array(HarnessGrant).max(500), flows: z.array(HarnessFlow).max(100),
}).superRefine((v, ctx) => {
  if (new Set(v.grants.map(g => g.action + ':' + g.targetId)).size !== v.grants.length ||
      new Set(v.flows.map(f => f.id)).size !== v.flows.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate grant or flow' });
});
export type HarnessPolicy = z.infer<typeof HarnessPolicy>;
export type HarnessAction = z.infer<typeof HarnessAction>;
export type HarnessTarget = z.infer<typeof HarnessTarget>;
export const HarnessPolicyUpdate = z.strictObject({ expectedVersion: z.int().positive(), policy: HarnessPolicy });
export const HarnessPay = z.strictObject({ intentId: TransferId });
export const HarnessResource = z.strictObject({ resourceId: AccountId });
export const HarnessPurchase = z.strictObject({ purchaseId: TransferId });
export const HarnessFlowRequest = z.strictObject({ flowId: AccountId });
export const HarnessBridge = z.strictObject({ routeId: AccountId });
export const HarnessEmpty = z.strictObject({});

/* Conversational mandates. The agent can only PROPOSE; the owner confirms outside chat.
 * A confirmed mandate lets the agent pay one approved payee up to a cap per period. */
export const MandatePeriod = z.enum(['daily', 'weekly', 'monthly']);
export type MandatePeriod = z.infer<typeof MandatePeriod>;
const Note = z.string().max(140).optional();
export const ProposePayee = z.strictObject({ name: z.string().trim().min(1).max(60), address: XrplAddress, note: Note });
export const ProposePayment = z.strictObject({ payeeId: AccountId, amount: Amount, executeAt: z.iso.datetime().optional(), note: Note });
export const ProposeMandate = z.strictObject({ payeeId: AccountId, cap: Amount, period: MandatePeriod, note: Note });
export const PayPayee = z.strictObject({ payeeId: AccountId, amount: Amount, note: Note });
export const ProposalDecision = z.strictObject({ proposalId: z.uuid() });
