import type { PurchaseBudgetService } from './purchase-budgets';
import type { PurchaseBinding, X402Adapters } from './x402';

/** Backend-owned quote and fee valuation, never values supplied by a merchant or model.
 * feeRlusd is a conservative trusted RLUSD equivalent of payer XRP fees, not an on-ledger RLUSD fee.
 * The independent signer must enforce the underlying XRP fee cap and aggregate transfer mandate too. */
export function x402BudgetAdapter(service: PurchaseBudgetService,
  resolveCosts: (binding: PurchaseBinding) => { quoteId: string; feeRlusd: string }): X402Adapters['budget'] {
  return {
    status(ctx,binding) { return service.reservation(ctx,binding.purchaseId)?.state ?? 'none'; },
    reserve(ctx,binding) {
      const costs=resolveCosts(binding);
      return service.reserve(ctx,{purchaseId:binding.purchaseId,merchantId:binding.merchantId,
        categoryId:binding.categoryId,resourceHash:binding.resourceHash,
        amountRlusd:binding.challenge.accepts[0]!.amount,...costs});
    },
    authorize(ctx,binding) { return service.authorize(ctx,binding.purchaseId); },
    reconcile(ctx,binding,evidence) {
      if (!service.reservation(ctx,binding.purchaseId)) return service.reconcileAbsent(ctx,binding.purchaseId,evidence);
      const state=service.recordOutcome(ctx,binding.purchaseId,evidence).state;
      return state === 'settled' ? 'settled' : state === 'rejected' ? 'rejected' : 'unknown';
    },
  };
}
