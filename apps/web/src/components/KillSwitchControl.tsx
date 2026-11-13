"use client";

import React, { useState } from "react";

export type KillSwitchStatus = "ACTIVE" | "REVOKED";

export type KillSwitchControlProps = {
  initialStatus?: KillSwitchStatus;
  onStatusChange?: (status: KillSwitchStatus) => void;
  endpoint?: string;
};

export function KillSwitchControl({
  initialStatus = "ACTIVE",
  onStatusChange,
  endpoint = "/api/owner/kill-switch",
}: KillSwitchControlProps) {
  const [status, setStatus] = useState<KillSwitchStatus>(initialStatus);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const isRevoked = status === "REVOKED";

  const handleOpenModal = () => {
    setNotice(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (!isSubmitting) {
      setIsModalOpen(false);
    }
  };

  const handleConfirmToggle = async () => {
    setIsSubmitting(true);
    setNotice(null);

    const willRevoke = status === "ACTIVE";
    const targetStatus: KillSwitchStatus = willRevoke ? "REVOKED" : "ACTIVE";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          on: willRevoke,
          killSwitch: willRevoke,
        }),
      });

      if (!response.ok) {
        let errMsg = `Server returned status ${response.status}`;
        try {
          const errData = await response.json();
          if (errData?.message) errMsg = errData.message;
        } catch {
          // ignore json parse error
        }
        throw new Error(errMsg);
      }

      setStatus(targetStatus);
      if (onStatusChange) {
        onStatusChange(targetStatus);
      }

      setIsModalOpen(false);
      setNotice({
        type: "success",
        message: willRevoke
          ? "Emergency kill switch triggered successfully. All payment authority is revoked."
          : "Payment authority successfully restored. Mandate is active.",
      });
    } catch (err) {
      setNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to update kill switch state.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: isRevoked ? "#fef2f2" : "#ffffff",
        border: `1px solid ${isRevoked ? "#fca5a5" : "#e2e8f0"}`,
        borderRadius: 8,
        padding: 24,
        marginBottom: 24,
        boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
      }}
      data-testid="kill-switch-container"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isRevoked ? "#991b1b" : "#0f172a",
                margin: 0,
              }}
            >
              Emergency Kill Switch
            </h2>
            <span
              data-testid="kill-switch-status"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 9999,
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                backgroundColor: isRevoked ? "#fee2e2" : "#dcfce7",
                color: isRevoked ? "#991b1b" : "#166534",
                border: `1px solid ${isRevoked ? "#f87171" : "#86efac"}`,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: isRevoked ? "#dc2626" : "#16a34a",
                }}
              />
              {status}
            </span>
          </div>
          <p
            style={{
              fontSize: 14,
              color: isRevoked ? "#7f1d1d" : "#64748b",
              margin: 0,
              maxWidth: 600,
              lineHeight: 1.5,
            }}
          >
            {isRevoked
              ? "EMERGENCY STATE: Payment authority is REVOKED. Outgoing XRPL transactions are blocked at the policy and ledger gates."
              : "Payment authority is ACTIVE. Outgoing agent payments execute within mandate caps and approval policies."}
          </p>
        </div>

        <div>
          {isRevoked ? (
            <button
              type="button"
              data-testid="resume-kill-switch-btn"
              onClick={handleOpenModal}
              style={{
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              Re-enable Payment Authority
            </button>
          ) : (
            <button
              type="button"
              data-testid="trigger-kill-switch-btn"
              onClick={handleOpenModal}
              style={{
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 6,
                border: "1px solid #dc2626",
                backgroundColor: "#dc2626",
                color: "#ffffff",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                boxShadow: "0 1px 2px rgba(220, 38, 38, 0.2)",
              }}
            >
              <span style={{ fontSize: 16 }}>🛑</span>
              Stop All Payments Immediately
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          data-testid="kill-switch-notice"
          style={{
            marginTop: 16,
            padding: "10px 14px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            backgroundColor: notice.type === "success" ? "#f0fdf4" : "#fef2f2",
            color: notice.type === "success" ? "#15803d" : "#b91c1c",
            border: `1px solid ${notice.type === "success" ? "#bbf7d0" : "#fecaca"}`,
          }}
        >
          {notice.message}
        </div>
      )}

      {/* Confirmation Modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="kill-switch-modal-title"
          data-testid="kill-switch-modal"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 10,
              padding: 24,
              maxWidth: 480,
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              border: "1px solid #e2e8f0",
            }}
          >
            <h3
              id="kill-switch-modal-title"
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isRevoked ? "#0f172a" : "#dc2626",
                margin: "0 0 12px 0",
              }}
            >
              {isRevoked ? "Confirm Payment Re-enable" : "Confirm Emergency Kill Switch"}
            </h3>

            <p style={{ fontSize: 14, color: "#475569", lineHeight: 1.5, margin: "0 0 20px 0" }}>
              {isRevoked
                ? "Are you sure you want to re-enable payment authority? Autonomous agent payments within mandate caps and rules will resume immediately."
                : "Are you sure you want to stop all payments immediately? This will trigger the kill switch, immediately revoking all payment capability across services."}
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 12,
              }}
            >
              <button
                type="button"
                data-testid="modal-cancel-btn"
                onClick={handleCloseModal}
                disabled={isSubmitting}
                style={{
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#ffffff",
                  color: "#475569",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                data-testid="modal-confirm-btn"
                onClick={handleConfirmToggle}
                disabled={isSubmitting}
                style={{
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: isRevoked ? "1px solid #2563eb" : "1px solid #dc2626",
                  backgroundColor: isRevoked ? "#2563eb" : "#dc2626",
                  color: "#ffffff",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isSubmitting ? (
                  "Processing..."
                ) : isRevoked ? (
                  "Confirm & Re-enable"
                ) : (
                  "Confirm & Stop All Payments"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
