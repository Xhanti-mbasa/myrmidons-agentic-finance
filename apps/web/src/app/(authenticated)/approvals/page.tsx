"use client";

import React, { useEffect, useState } from "react";
import {
  SupplierProposalCard,
  PaymentApprovalCard,
} from "../../../components/ApprovalCards";

type SupplierProposalItem = {
  kind: "supplier";
  approvalId: string;
  supplierName: string;
  address: string;
  evidence: string;
  invoiceNumber: string;
};

type PaymentApprovalItem = {
  kind: "payment";
  approvalId: string;
  amount: string;
  supplier: string;
  invoiceNumber: string;
  reason: string;
};

type ApprovalItem = SupplierProposalItem | PaymentApprovalItem;

const DEMO_APPROVALS: ApprovalItem[] = [
  {
    kind: "supplier",
    approvalId: "apr_sup_8819",
    supplierName: "Stellenbosch Vintners",
    address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    evidence: "Invoice INV-2026-042 extracted matching supplier Stellenbosch Vintners",
    invoiceNumber: "INV-2026-042",
  },
  {
    kind: "payment",
    approvalId: "apr_pay_9021",
    amount: "75.00",
    supplier: "Karoo Textiles",
    invoiceNumber: "INV-2026-099",
    reason: "Requested payment exceeds the per-payment cap ($50.00)",
  },
];

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>(DEMO_APPROVALS);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/approvals")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const parsed: ApprovalItem[] = data
            .map((item: any) => {
              if (item.kind === "supplier" && item.payload) {
                return {
                  kind: "supplier" as const,
                  approvalId: item.id || item.approvalId,
                  supplierName: item.payload.name,
                  address: item.payload.address,
                  evidence: item.payload.evidence,
                  invoiceNumber: item.payload.invoiceNumber,
                };
              }
              if (item.kind === "payment" && item.payload) {
                return {
                  kind: "payment" as const,
                  approvalId: item.id || item.approvalId,
                  amount: item.payload.amount,
                  supplier: item.payload.supplierId,
                  invoiceNumber: item.payload.invoiceNumber,
                  reason: item.payload.reason,
                };
              }
              return null;
            })
            .filter(Boolean) as ApprovalItem[];

          if (parsed.length > 0) {
            setApprovals(parsed);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleApproveSupplier = async (approvalId: string) => {
    try {
      await fetch(`/api/owner/approvals/${approvalId}/approve`, {
        method: "POST",
      }).catch(() => {});
    } finally {
      setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
      setActionNotice(`Approved supplier proposal ${approvalId}`);
    }
  };

  const handleReject = async (approvalId: string) => {
    try {
      await fetch(`/api/owner/approvals/${approvalId}/reject`, {
        method: "POST",
      }).catch(() => {});
    } finally {
      setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
      setActionNotice(`Rejected approval request ${approvalId}`);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0" }}>
        Pending Approvals
      </h1>
      <p style={{ color: "#64748b", margin: "0 0 24px 0", fontSize: 14 }}>
        Owner review queue for out-of-mandate requests and unknown suppliers.
      </p>

      {actionNotice && (
        <div
          role="status"
          style={{
            background: "#dcfce7",
            color: "#166534",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {actionNotice}
        </div>
      )}

      {approvals.length === 0 ? (
        <div
          style={{
            background: "#fff",
            padding: 24,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
            No pending approval requests requiring owner attention.
          </p>
        </div>
      ) : (
        <div style={{ maxWidth: 680 }}>
          {approvals.map((item) => {
            if (item.kind === "supplier") {
              return (
                <SupplierProposalCard
                  key={item.approvalId}
                  approvalId={item.approvalId}
                  supplierName={item.supplierName}
                  address={item.address}
                  evidence={item.evidence}
                  invoiceNumber={item.invoiceNumber}
                  onApprove={handleApproveSupplier}
                  onReject={handleReject}
                />
              );
            }
            return (
              <PaymentApprovalCard
                key={item.approvalId}
                approvalId={item.approvalId}
                amount={item.amount}
                supplier={item.supplier}
                invoiceNumber={item.invoiceNumber}
                reason={item.reason}
                onReject={handleReject}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
