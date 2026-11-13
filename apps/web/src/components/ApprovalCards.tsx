"use client";

import React, { useState } from "react";

export type SupplierProposalCardProps = {
  approvalId: string;
  supplierName: string;
  address: string;
  evidence: string;
  invoiceNumber: string;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
};

export function SupplierProposalCard({
  approvalId,
  supplierName,
  address,
  evidence,
  invoiceNumber,
  onApprove,
  onReject,
}: SupplierProposalCardProps) {
  const [typedSuffix, setTypedSuffix] = useState("");
  const suffix = address.length >= 6 ? address.slice(-6) : address;
  const prefix = address.length >= 6 ? address.slice(0, -6) : "";
  const isMatch = typedSuffix.trim() === suffix;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              background: "#eff6ff",
              color: "#2563eb",
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            Supplier Proposal
          </span>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#0f172a",
              margin: "6px 0 2px 0",
            }}
          >
            {supplierName}
          </h3>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            Invoice: {invoiceNumber}
          </span>
        </div>

        <span
          style={{
            fontSize: 12,
            fontFamily: "monospace",
            color: "#94a3b8",
            background: "#f8fafc",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {approvalId}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
          Proposed XRPL Address:
        </div>
        <div
          data-testid="proposed-address"
          style={{
            fontFamily: "monospace",
            fontSize: 14,
            background: "#f8fafc",
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
            wordBreak: "break-all",
          }}
        >
          <span>{prefix}</span>
          <mark
            data-testid="highlighted-address-suffix"
            style={{
              background: "#fef08a",
              color: "#854d0e",
              padding: "2px 4px",
              borderRadius: 3,
              fontWeight: 700,
            }}
          >
            {suffix}
          </mark>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>
          Extraction Evidence:
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#334155",
            background: "#f1f5f9",
            padding: "6px 10px",
            borderRadius: 4,
          }}
        >
          {evidence}
        </div>
      </div>

      <div
        style={{
          borderTop: "1px solid #f1f5f9",
          paddingTop: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <label
            htmlFor={`confirm-suffix-${approvalId}`}
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "#334155",
              marginBottom: 4,
            }}
          >
            Confirm address suffix (last 6 characters):
          </label>
          <input
            id={`confirm-suffix-${approvalId}`}
            aria-label="Confirm address suffix"
            type="text"
            value={typedSuffix}
            onChange={(e) => setTypedSuffix(e.target.value)}
            placeholder={`Type ${suffix}`}
            style={{
              padding: "6px 10px",
              fontSize: 13,
              fontFamily: "monospace",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              width: 160,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {onReject && (
            <button
              type="button"
              onClick={() => onReject(approvalId)}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                background: "#fee2e2",
                color: "#b91c1c",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Reject
            </button>
          )}

          <button
            type="button"
            disabled={!isMatch}
            onClick={() => onApprove?.(approvalId)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: isMatch ? "#16a34a" : "#94a3b8",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: isMatch ? "pointer" : "not-allowed",
            }}
          >
            Approve Supplier
          </button>
        </div>
      </div>
    </div>
  );
}

export type PaymentApprovalCardProps = {
  approvalId: string;
  amount: string;
  supplier: string;
  invoiceNumber: string;
  reason?: string;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
};

export function PaymentApprovalCard({
  approvalId,
  amount,
  supplier,
  invoiceNumber,
  reason,
  onReject,
}: PaymentApprovalCardProps) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              background: "#fef3c7",
              color: "#b45309",
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            Payment Exception
          </span>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#0f172a",
              margin: "6px 0 2px 0",
            }}
          >
            {supplier}
          </h3>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            Invoice: {invoiceNumber}
          </span>
        </div>

        <span
          style={{
            fontSize: 12,
            fontFamily: "monospace",
            color: "#94a3b8",
            background: "#f8fafc",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {approvalId}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>
          Amount:
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
          ${amount} RLUSD
        </div>
      </div>

      {reason && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 2 }}>
            Reason:
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#334155",
              background: "#f1f5f9",
              padding: "6px 10px",
              borderRadius: 4,
            }}
          >
            {reason}
          </div>
        </div>
      )}

      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: 12,
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Signing Instruction (T32):
        </div>
        <code
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            color: "#0369a1",
            background: "#e0f2fe",
            padding: "4px 8px",
            borderRadius: 4,
            display: "inline-block",
          }}
        >
          Run pnpm owner:sign {approvalId}
        </code>
      </div>

      {onReject && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => onReject(approvalId)}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "#fee2e2",
              color: "#b91c1c",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Reject Request
          </button>
        </div>
      )}
    </div>
  );
}
