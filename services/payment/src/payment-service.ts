import {
  decode,
  hashes,
  multisign,
  Wallet,
  type Payment,
} from "xrpl";
import {
  compareAmounts,
  LAST_LEDGER_WINDOW,
  MEMO_TYPE,
  RLUSD_CURRENCY_HEX,
  RLUSD_TESTNET_ISSUER,
  ruleExplanation,
  toHex,
  type CosignRequest,
  type LogEntry,
  type PayRequest,
  type PayResult,
  type RuleCode,
} from "@shucamoxa/shared";
import type {
  AuditLogStore,
  PaymentServiceOptions,
  PolicyClientLike,
  RulesStore,
  XrplClientLike,
} from "./types";

export class PaymentService {
  private readonly agentWallet: Wallet;
  private readonly treasuryAccount: string;
  private readonly policyAccount: string;
  private readonly maxFeeDrops: bigint;
  private readonly pollIntervalMs: number;
  private readonly rulesStore: RulesStore;
  private readonly auditLog: AuditLogStore;
  private readonly policyClient: PolicyClientLike;
  private readonly xrplClient: XrplClientLike;

  private readonly storedResults = new Map<string, PayResult>();
  private readonly inFlight = new Map<string, Promise<PayResult>>();

  constructor(options: PaymentServiceOptions) {
    this.agentWallet = Wallet.fromSeed(options.agentSeed);
    this.treasuryAccount = options.treasuryAccount;
    this.policyAccount = options.policyAccount;
    this.maxFeeDrops = BigInt(options.maxFeeDrops ?? "2000");
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.rulesStore = options.rulesStore;
    this.auditLog = options.auditLog;
    this.policyClient = options.policyClient;
    this.xrplClient = options.xrplClient;
  }

  async pay(request: PayRequest): Promise<PayResult> {
    const { invoiceNumber } = request;

    // 1. Idempotent on invoiceNumber: repeat returns stored result
    const stored = this.storedResults.get(invoiceNumber);
    if (stored) {
      return stored;
    }

    // 2. Concurrent duplicate waits for first; never a second submit
    const pending = this.inFlight.get(invoiceNumber);
    if (pending) {
      return await pending;
    }

    const promise = this.executePayment(request);
    this.inFlight.set(invoiceNumber, promise);
    try {
      const result = await promise;
      this.storedResults.set(invoiceNumber, result);
      return result;
    } finally {
      this.inFlight.delete(invoiceNumber);
    }
  }

  private async executePayment(request: PayRequest): Promise<PayResult> {
    // Looks up supplier address and tag from rules store (read role).
    // Unknown/pending/removed suppliers blocked with SUPPLIER_NOT_APPROVED without signing.
    const supplier = await this.rulesStore.getSupplier(request.supplierId);
    if (!supplier || supplier.status !== "approved") {
      const logEntry = await this.auditLog.append({
        actor: "payment",
        event: "payment_failed",
        invoiceNumber: request.invoiceNumber,
        supplierId: request.supplierId,
        amount: request.amount,
        ruleCode: "SUPPLIER_NOT_APPROVED",
        explanation: ruleExplanation("SUPPLIER_NOT_APPROVED"),
        txHash: null,
        ledgerResult: null,
      });
      return {
        status: "blocked",
        ruleCode: "SUPPLIER_NOT_APPROVED",
        logId: String(logEntry.seq),
      };
    }

    // Reserve budget
    if (this.rulesStore.reserveBudget) {
      const reserved = await this.rulesStore.reserveBudget(request.amount, request.invoiceNumber);
      if (!reserved) {
        const logEntry = await this.auditLog.append({
          actor: "payment",
          event: "payment_failed",
          invoiceNumber: request.invoiceNumber,
          supplierId: request.supplierId,
          amount: request.amount,
          ruleCode: "OVER_BUDGET",
          explanation: ruleExplanation("OVER_BUDGET"),
          txHash: null,
          ledgerResult: null,
        });
        return {
          status: "blocked",
          ruleCode: "OVER_BUDGET",
          logId: String(logEntry.seq),
        };
      }
    }

    // Writes pending payment_requested log entry
    let pendingLog: LogEntry;
    try {
      pendingLog = await this.auditLog.append({
        actor: "payment",
        event: "payment_requested",
        invoiceNumber: request.invoiceNumber,
        supplierId: request.supplierId,
        amount: request.amount,
        ruleCode: null,
        explanation: `Payment requested for invoice ${request.invoiceNumber}`,
        txHash: null,
        ledgerResult: null,
      });
    } catch (err: any) {
      await this.rulesStore.releaseReservation?.(request.amount, request.invoiceNumber);
      throw err;
    }

    const logEntryHash = pendingLog.hash;
    const logId = String(pendingLog.seq);

    try {
      // Builds Payment with entry hash in memo
      const tx: Payment = {
        TransactionType: "Payment",
        Account: this.treasuryAccount,
        Destination: supplier.address,
        ...(supplier.destinationTag !== undefined ? { DestinationTag: supplier.destinationTag } : {}),
        Amount: {
          currency: RLUSD_CURRENCY_HEX,
          issuer: RLUSD_TESTNET_ISSUER,
          value: request.amount,
        },
        SigningPubKey: "",
        Memos: [
          {
            Memo: {
              MemoType: toHex(MEMO_TYPE),
              MemoData: toHex(logEntryHash),
            },
          },
        ],
      };

      // Calls autofill(tx, 2)
      const currentLedger = await this.xrplClient.getLedgerIndex();
      const autofilled = await this.xrplClient.autofill(tx, 2);

      // Caps LastLedgerSequence at current + 20
      const maxLastLedger = currentLedger + LAST_LEDGER_WINDOW;
      if (!autofilled.LastLedgerSequence || autofilled.LastLedgerSequence > maxLastLedger) {
        autofilled.LastLedgerSequence = maxLastLedger;
      }

      // Aborts if Fee > MAX_FEE_DROPS
      if (autofilled.Fee && BigInt(autofilled.Fee) > this.maxFeeDrops) {
        await this.rulesStore.releaseReservation?.(request.amount, request.invoiceNumber);
        await this.auditLog.append({
          actor: "payment",
          event: "payment_failed",
          invoiceNumber: request.invoiceNumber,
          supplierId: request.supplierId,
          amount: request.amount,
          ruleCode: "LEDGER_REJECTED",
          explanation: `Fee ${autofilled.Fee} exceeds MAX_FEE_DROPS ${this.maxFeeDrops}`,
          txHash: null,
          ledgerResult: null,
        });
        return {
          status: "blocked",
          ruleCode: "LEDGER_REJECTED",
          logId,
        };
      }

      // Signs with agent key (multisign)
      const agentSigned = this.agentWallet.sign(autofilled, true);

      // Calls POST /cosign on policy service
      const cosignPayload: CosignRequest = {
        txJson: autofilled as unknown as Record<string, unknown>,
        agentSignedBlob: agentSigned.tx_blob,
        request: {
          supplierId: request.supplierId,
          amount: request.amount,
          invoiceNumber: request.invoiceNumber,
          logEntryHash,
        },
      };

      let cosignRes;
      try {
        cosignRes = await this.policyClient.cosign(cosignPayload);
      } catch (err: any) {
        await this.rulesStore.releaseReservation?.(request.amount, request.invoiceNumber);
        // If policy service unreachable, propagate 503
        const error = new Error(`Policy service unreachable: ${err?.message ?? "unknown error"}`);
        (error as any).status = 503;
        throw error;
      }

      if (cosignRes.decision === "block") {
        await this.rulesStore.releaseReservation?.(request.amount, request.invoiceNumber);
        await this.auditLog.append({
          actor: "policy",
          event: "policy_blocked",
          invoiceNumber: request.invoiceNumber,
          supplierId: request.supplierId,
          amount: request.amount,
          ruleCode: cosignRes.ruleCode,
          explanation: cosignRes.reason,
          txHash: null,
          ledgerResult: null,
        });
        return {
          status: "blocked",
          ruleCode: cosignRes.ruleCode,
          logId,
        };
      }

      // Checks policySignedBlob decodes to same tx signed by POLICY_ACCOUNT
      const isValidBlob = this.verifyPolicyBlob(cosignRes.policySignedBlob, autofilled);
      if (!isValidBlob) {
        await this.rulesStore.releaseReservation?.(request.amount, request.invoiceNumber);
        await this.auditLog.append({
          actor: "payment",
          event: "payment_failed",
          invoiceNumber: request.invoiceNumber,
          supplierId: request.supplierId,
          amount: request.amount,
          ruleCode: "LEDGER_REJECTED",
          explanation: "Policy signed blob validation failed: transaction mismatch or unexpected signer",
          txHash: null,
          ledgerResult: null,
        });
        return {
          status: "blocked",
          ruleCode: "LEDGER_REJECTED",
          logId,
        };
      }

      // Combines with multisign([agentBlob, policyBlob])
      const combinedBlob = multisign([agentSigned.tx_blob, cosignRes.policySignedBlob]);

      // Calls submitAndWait (or polls by hash on timeout)
      const submitResult = await this.submitAndVerify(
        combinedBlob,
        autofilled.LastLedgerSequence!,
        request.amount,
      );

      if (submitResult.status === "settled") {
        await this.rulesStore.settleReservation?.(request.amount, request.invoiceNumber);
        await this.auditLog.append({
          actor: "payment",
          event: "payment_settled",
          invoiceNumber: request.invoiceNumber,
          supplierId: request.supplierId,
          amount: request.amount,
          ruleCode: "OK",
          explanation: "Payment settled on ledger",
          txHash: submitResult.txHash ?? null,
          ledgerResult: "tesSUCCESS",
        });
        return {
          status: "settled",
          ruleCode: "OK",
          txHash: submitResult.txHash!,
          logId,
        };
      } else {
        await this.rulesStore.releaseReservation?.(request.amount, request.invoiceNumber);
        await this.auditLog.append({
          actor: "payment",
          event: "payment_failed",
          invoiceNumber: request.invoiceNumber,
          supplierId: request.supplierId,
          amount: request.amount,
          ruleCode: "LEDGER_REJECTED",
          explanation: submitResult.reason,
          txHash: submitResult.txHash ?? null,
          ledgerResult: submitResult.ledgerResult ?? null,
        });
        return {
          status: "blocked",
          ruleCode: "LEDGER_REJECTED",
          ...(submitResult.txHash ? { txHash: submitResult.txHash } : {}),
          logId,
        };
      }
    } catch (err: any) {
      await this.rulesStore.releaseReservation?.(request.amount, request.invoiceNumber);
      if (err?.status === 503) {
        throw err;
      }
      await this.auditLog.append({
        actor: "payment",
        event: "payment_failed",
        invoiceNumber: request.invoiceNumber,
        supplierId: request.supplierId,
        amount: request.amount,
        ruleCode: "LEDGER_REJECTED",
        explanation: err?.message ?? "Payment execution failed",
        txHash: null,
        ledgerResult: null,
      });
      return {
        status: "blocked",
        ruleCode: "LEDGER_REJECTED",
        logId,
      };
    }
  }

  private verifyPolicyBlob(policyBlob: string, expectedTx: Payment): boolean {
    try {
      const decoded: any = decode(policyBlob);

      if (decoded.TransactionType !== expectedTx.TransactionType) return false;
      if (decoded.Account !== expectedTx.Account) return false;
      if (decoded.Destination !== expectedTx.Destination) return false;
      if (String(decoded.Fee) !== String(expectedTx.Fee)) return false;
      if (decoded.Sequence !== expectedTx.Sequence) return false;
      if (decoded.LastLedgerSequence !== expectedTx.LastLedgerSequence) return false;

      if (expectedTx.DestinationTag !== undefined && decoded.DestinationTag !== expectedTx.DestinationTag) {
        return false;
      }

      if (typeof expectedTx.Amount === "object" && expectedTx.Amount !== null) {
        const expAmount = expectedTx.Amount as { currency: string; issuer: string; value: string };
        if (typeof decoded.Amount !== "object" || decoded.Amount === null) return false;
        if (decoded.Amount.currency !== expAmount.currency) return false;
        if (decoded.Amount.issuer !== expAmount.issuer) return false;
        if (compareAmounts(String(decoded.Amount.value), expAmount.value) !== 0) return false;
      } else {
        if (decoded.Amount !== expectedTx.Amount) return false;
      }

      // Check Memos
      const expMemos = expectedTx.Memos;
      if (expMemos && expMemos.length > 0) {
        if (!decoded.Memos || decoded.Memos.length !== expMemos.length) return false;
        for (let i = 0; i < expMemos.length; i++) {
          const expM = expMemos[i]!.Memo;
          const decM = decoded.Memos[i]?.Memo;
          if (!decM) return false;
          if (decM.MemoType?.toUpperCase() !== expM.MemoType?.toUpperCase()) return false;
          if (decM.MemoData?.toUpperCase() !== expM.MemoData?.toUpperCase()) return false;
        }
      }

      // Check Signers: must contain POLICY_ACCOUNT
      if (!Array.isArray(decoded.Signers) || decoded.Signers.length === 0) return false;
      const policySigner = decoded.Signers.find((s: any) => s.Signer?.Account === this.policyAccount);
      if (!policySigner || !policySigner.Signer?.TxnSignature) return false;

      return true;
    } catch {
      return false;
    }
  }

  private async submitAndVerify(
    combinedBlob: string,
    lastLedgerSequence: number,
    requestedAmount: string,
  ): Promise<{ status: "settled" | "blocked"; txHash?: string; ledgerResult?: string; reason: string }> {
    let txHash: string | undefined;
    try {
      txHash = hashes.hashSignedTx(combinedBlob);
    } catch {}

    let res: any;
    try {
      res = await this.xrplClient.submitAndWait(combinedBlob);
      txHash = res?.result?.hash ?? txHash;
    } catch (err: any) {
      // Timeout or submit error: poll by hash until LastLedgerSequence passes
      txHash = res?.result?.hash ?? txHash ?? err?.data?.hash ?? err?.result?.hash ?? err?.hash;
      if (txHash) {
        return await this.pollUntilLastLedger(txHash, lastLedgerSequence, requestedAmount);
      }
      return {
        status: "blocked",
        reason: err?.message ?? "Submission failed without transaction hash",
      };
    }

    const meta = res?.result?.meta;
    const resultCode = typeof meta === "object" && meta ? meta.TransactionResult : res?.result?.engine_result;
    txHash = res?.result?.hash ?? txHash;

    if (resultCode !== "tesSUCCESS") {
      return {
        status: "blocked",
        txHash,
        ledgerResult: resultCode,
        reason: `Transaction failed with ledger result: ${resultCode}`,
      };
    }

    // Check delivered_amount
    const deliveredAmount = typeof meta === "object" && meta ? (meta.delivered_amount ?? meta.DeliveredAmount) : undefined;
    const deliveredVal = typeof deliveredAmount === "object" && deliveredAmount !== null ? deliveredAmount.value : deliveredAmount;

    if (deliveredVal === undefined || compareAmounts(String(deliveredVal), requestedAmount) !== 0) {
      return {
        status: "blocked",
        txHash,
        ledgerResult: resultCode,
        reason: `delivered_amount mismatch: received ${deliveredVal}, requested ${requestedAmount}`,
      };
    }

    return {
      status: "settled",
      txHash,
      ledgerResult: "tesSUCCESS",
      reason: "Payment settled on ledger",
    };
  }

  private async pollUntilLastLedger(
    txHash: string,
    lastLedgerSequence: number,
    requestedAmount: string,
  ): Promise<{ status: "settled" | "blocked"; txHash?: string; ledgerResult?: string; reason: string }> {
    while (true) {
      try {
        const txRes = await this.xrplClient.request({
          command: "tx",
          transaction: txHash,
        });

        if (txRes?.result && (txRes.result.validated === true || txRes.result.inLedger)) {
          const meta = txRes.result.meta;
          const resultCode = typeof meta === "object" && meta ? meta.TransactionResult : undefined;

          if (resultCode !== "tesSUCCESS") {
            return {
              status: "blocked",
              txHash,
              ledgerResult: resultCode,
              reason: `Transaction failed with ledger result: ${resultCode}`,
            };
          }

          const deliveredAmount = typeof meta === "object" && meta ? (meta.delivered_amount ?? meta.DeliveredAmount) : undefined;
          const deliveredVal = typeof deliveredAmount === "object" && deliveredAmount !== null ? deliveredAmount.value : deliveredAmount;

          if (deliveredVal === undefined || compareAmounts(String(deliveredVal), requestedAmount) !== 0) {
            return {
              status: "blocked",
              txHash,
              ledgerResult: resultCode,
              reason: `delivered_amount mismatch: received ${deliveredVal}, requested ${requestedAmount}`,
            };
          }

          return {
            status: "settled",
            txHash,
            ledgerResult: "tesSUCCESS",
            reason: "Payment settled on ledger after timeout",
          };
        }
      } catch (err: any) {
        // txnNotFound or similar - check ledger sequence
        const currentLedger = await this.xrplClient.getLedgerIndex();
        if (currentLedger > lastLedgerSequence) {
          return {
            status: "blocked",
            txHash,
            reason: `Transaction expired: current ledger ${currentLedger} passed LastLedgerSequence ${lastLedgerSequence}`,
          };
        }
      }

      const currentLedger = await this.xrplClient.getLedgerIndex();
      if (currentLedger > lastLedgerSequence) {
        return {
          status: "blocked",
          txHash,
          reason: `Transaction expired: current ledger ${currentLedger} passed LastLedgerSequence ${lastLedgerSequence}`,
        };
      }

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }
}
