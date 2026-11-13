"use client";

import React, { useState } from "react";
import { Amount, NonNegativeAmount } from "@shucamoxa/shared";

export type RulesData = {
  perPaymentCap: string;
  totalBudget: string;
  periodStart: string;
  spent: string;
  reserved: string;
  remaining: string;
  killSwitch?: boolean;
};

export type RulesFormProps = {
  initialRules?: Partial<RulesData>;
  onSuccess?: (rules: RulesData) => void;
};

export function RulesForm({ initialRules, onSuccess }: RulesFormProps) {
  const [perPaymentCap, setPerPaymentCap] = useState(
    initialRules?.perPaymentCap ?? "50.00",
  );
  const [totalBudget, setTotalBudget] = useState(
    initialRules?.totalBudget ?? "200.00",
  );
  const [periodStart, setPeriodStart] = useState(
    initialRules?.periodStart ?? new Date().toISOString().split("T")[0]!,
  );
  const [spent, setSpent] = useState(initialRules?.spent ?? "0.00");
  const [reserved, setReserved] = useState(initialRules?.reserved ?? "0.00");
  const [remaining, setRemaining] = useState(
    initialRules?.remaining ?? "200.00",
  );

  const [errors, setErrors] = useState<{
    perPaymentCap?: string;
    totalBudget?: string;
    periodStart?: string;
    spent?: string;
    reserved?: string;
    remaining?: string;
    form?: string;
  }>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const validateCap = (val: string) => {
    const res = Amount.safeParse(val);
    if (!res.success) {
      return res.error.issues[0]?.message ?? "Invalid amount";
    }
    return undefined;
  };

  const validateBudget = (val: string) => {
    const res = Amount.safeParse(val);
    if (!res.success) {
      return res.error.issues[0]?.message ?? "Invalid amount";
    }
    return undefined;
  };

  const validateNonNegative = (val: string) => {
    const res = NonNegativeAmount.safeParse(val);
    if (!res.success) {
      return res.error.issues[0]?.message ?? "Invalid amount";
    }
    return undefined;
  };

  const handleCapChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPerPaymentCap(val);
    const err = validateCap(val);
    setErrors((prev) => ({ ...prev, perPaymentCap: err }));
  };

  const handleBudgetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTotalBudget(val);
    const err = validateBudget(val);
    setErrors((prev) => ({ ...prev, totalBudget: err }));
  };

  const handleSpentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSpent(val);
    const err = validateNonNegative(val);
    setErrors((prev) => ({ ...prev, spent: err }));
  };

  const handleReservedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setReserved(val);
    const err = validateNonNegative(val);
    setErrors((prev) => ({ ...prev, reserved: err }));
  };

  const handleRemainingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRemaining(val);
    const err = validateNonNegative(val);
    setErrors((prev) => ({ ...prev, remaining: err }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    const capErr = validateCap(perPaymentCap);
    const budgetErr = validateBudget(totalBudget);
    const spentErr = validateNonNegative(spent);
    const reservedErr = validateNonNegative(reserved);
    const remainingErr = validateNonNegative(remaining);

    if (capErr || budgetErr || spentErr || reservedErr || remainingErr) {
      setErrors({
        perPaymentCap: capErr,
        totalBudget: budgetErr,
        spent: spentErr,
        reserved: reservedErr,
        remaining: remainingErr,
      });
      return;
    }

    setIsSubmitting(true);
    const payload: RulesData = {
      perPaymentCap,
      totalBudget,
      periodStart,
      spent,
      reserved,
      remaining,
    };

    try {
      const res = await fetch("/api/owner/rules", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        setErrors((prev) => ({
          ...prev,
          form: (errJson as { message?: string }).message || "Failed to save rules",
        }));
      } else {
        setStatusMessage("Rules saved successfully.");
        onSuccess?.(payload);
      }
    } catch {
      setErrors((prev) => ({
        ...prev,
        form: "Network error saving rules",
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "#fff",
        padding: 24,
        borderRadius: 8,
        border: "1px solid #e2e8f0",
        maxWidth: 600,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px 0" }}>
        Mandate & Spending Limits
      </h2>

      {statusMessage && (
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
          {statusMessage}
        </div>
      )}

      {errors.form && (
        <div
          role="alert"
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          {errors.form}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="perPaymentCap"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: "#334155",
            marginBottom: 4,
          }}
        >
          Per-Payment Cap (RLUSD)
        </label>
        <input
          id="perPaymentCap"
          type="text"
          value={perPaymentCap}
          onChange={handleCapChange}
          aria-invalid={!!errors.perPaymentCap}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 14,
            border: errors.perPaymentCap ? "1px solid #dc2626" : "1px solid #cbd5e1",
            borderRadius: 6,
            boxSizing: "border-box",
          }}
        />
        {errors.perPaymentCap && (
          <p style={{ color: "#dc2626", fontSize: 12, margin: "4px 0 0 0" }}>
            {errors.perPaymentCap}
          </p>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="totalBudget"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: "#334155",
            marginBottom: 4,
          }}
        >
          Total Budget (RLUSD)
        </label>
        <input
          id="totalBudget"
          type="text"
          value={totalBudget}
          onChange={handleBudgetChange}
          aria-invalid={!!errors.totalBudget}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 14,
            border: errors.totalBudget ? "1px solid #dc2626" : "1px solid #cbd5e1",
            borderRadius: 6,
            boxSizing: "border-box",
          }}
        />
        {errors.totalBudget && (
          <p style={{ color: "#dc2626", fontSize: 12, margin: "4px 0 0 0" }}>
            {errors.totalBudget}
          </p>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="periodStart"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: "#334155",
            marginBottom: 4,
          }}
        >
          Period Start
        </label>
        <input
          id="periodStart"
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 14,
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div>
          <label
            htmlFor="spent"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              marginBottom: 4,
            }}
          >
            Spent (RLUSD)
          </label>
          <input
            id="spent"
            type="text"
            value={spent}
            onChange={handleSpentChange}
            aria-invalid={!!errors.spent}
            style={{
              width: "100%",
              padding: "6px 10px",
              fontSize: 13,
              border: errors.spent ? "1px solid #dc2626" : "1px solid #cbd5e1",
              borderRadius: 6,
              boxSizing: "border-box",
            }}
          />
          {errors.spent && (
            <p style={{ color: "#dc2626", fontSize: 11, margin: "2px 0 0 0" }}>
              {errors.spent}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="reserved"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              marginBottom: 4,
            }}
          >
            Reserved (RLUSD)
          </label>
          <input
            id="reserved"
            type="text"
            value={reserved}
            onChange={handleReservedChange}
            aria-invalid={!!errors.reserved}
            style={{
              width: "100%",
              padding: "6px 10px",
              fontSize: 13,
              border: errors.reserved ? "1px solid #dc2626" : "1px solid #cbd5e1",
              borderRadius: 6,
              boxSizing: "border-box",
            }}
          />
          {errors.reserved && (
            <p style={{ color: "#dc2626", fontSize: 11, margin: "2px 0 0 0" }}>
              {errors.reserved}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="remaining"
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              marginBottom: 4,
            }}
          >
            Remaining (RLUSD)
          </label>
          <input
            id="remaining"
            type="text"
            value={remaining}
            onChange={handleRemainingChange}
            aria-invalid={!!errors.remaining}
            style={{
              width: "100%",
              padding: "6px 10px",
              fontSize: 13,
              border: errors.remaining ? "1px solid #dc2626" : "1px solid #cbd5e1",
              borderRadius: 6,
              boxSizing: "border-box",
            }}
          />
          {errors.remaining && (
            <p style={{ color: "#dc2626", fontSize: 11, margin: "2px 0 0 0" }}>
              {errors.remaining}
            </p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        style={{
          background: "#2563eb",
          color: "#fff",
          border: "none",
          padding: "10px 18px",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {isSubmitting ? "Saving..." : "Save Mandate"}
      </button>
    </form>
  );
}
