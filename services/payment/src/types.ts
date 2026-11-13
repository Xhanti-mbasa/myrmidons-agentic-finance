import type { SubmittableTransaction } from "xrpl";
import type {
  CosignRequest,
  CosignResponse,
  LogEntry,
  PayRequest,
  PayResult,
} from "@shucamoxa/shared";

export interface SupplierRecord {
  id: string;
  name: string;
  address: string;
  destinationTag?: number;
  status: "approved" | "pending" | "removed";
}

export interface RulesStore {
  getSupplier(supplierId: string): Promise<SupplierRecord | null> | SupplierRecord | null;
  reserveBudget?(amount: string, invoiceNumber: string): Promise<boolean> | boolean;
  settleReservation?(amount: string, invoiceNumber: string): Promise<void> | void;
  releaseReservation?(amount: string, invoiceNumber: string): Promise<void> | void;
}

export interface AuditLogStore {
  append(entry: Omit<LogEntry, "seq" | "ts" | "prevHash" | "hash">): Promise<LogEntry>;
  getLog?(): readonly LogEntry[];
}

export interface PolicyClientLike {
  cosign(request: CosignRequest): Promise<CosignResponse>;
}

export interface XrplClientLike {
  isConnected?(): boolean;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  autofill<T extends SubmittableTransaction>(tx: T, signersCount?: number): Promise<T>;
  getLedgerIndex(): Promise<number>;
  submitAndWait(txBlob: string): Promise<any>;
  request(req: { command: string; [key: string]: unknown }): Promise<any>;
}

export interface PaymentServiceOptions {
  agentSeed: string;
  treasuryAccount: string;
  policyAccount: string;
  maxFeeDrops?: string | number | bigint;
  pollIntervalMs?: number;
  rulesStore: RulesStore;
  auditLog: AuditLogStore;
  policyClient: PolicyClientLike;
  xrplClient: XrplClientLike;
}
