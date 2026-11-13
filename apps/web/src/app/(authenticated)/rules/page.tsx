"use client";

import React, { useEffect, useState } from "react";
import { RulesForm, type RulesData } from "../../../components/RulesForm";

export default function RulesPage() {
  const [rules, setRules] = useState<RulesData>({
    perPaymentCap: "50.00",
    totalBudget: "200.00",
    periodStart: new Date().toISOString().split("T")[0]!,
    spent: "0.00",
    reserved: "0.00",
    remaining: "200.00",
    killSwitch: false,
  });

  useEffect(() => {
    fetch("/api/rules")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setRules({
            perPaymentCap: data.perPaymentCap ?? "50.00",
            totalBudget: data.totalBudget ?? "200.00",
            periodStart: data.periodStart ?? new Date().toISOString().split("T")[0]!,
            spent: data.spent ?? "0.00",
            reserved: data.reserved ?? "0.00",
            remaining: data.remaining ?? "200.00",
            killSwitch: data.killSwitch ?? false,
          });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0" }}>
        Rules & Mandate
      </h1>
      <p style={{ color: "#64748b", margin: "0 0 24px 0", fontSize: 14 }}>
        Configure spending limits, active budget period, kill switch, and mandate enforcement.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            background: "#fff",
            padding: 20,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Per-Payment Cap
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            ${rules.perPaymentCap} RLUSD
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
            Maximum allowed single transaction
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            padding: 20,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Total Budget
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            ${rules.totalBudget} RLUSD
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
            Period total spend limit
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            padding: 20,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Remaining Budget
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#2563eb" }}>
            ${rules.remaining} RLUSD
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
            Spent: ${rules.spent} | Reserved: ${rules.reserved}
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            padding: 20,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            Kill Switch
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: rules.killSwitch ? "#dc2626" : "#16a34a",
              marginTop: 4,
            }}
          >
            {rules.killSwitch ? "STOPPED (Revoked)" : "ACTIVE (Allowed)"}
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
            {rules.killSwitch ? "Agent payment authority revoked" : "Payment authority enabled"}
          </div>
        </div>
      </div>

      <RulesForm
        initialRules={rules}
        onSuccess={(updated) => setRules((prev) => ({ ...prev, ...updated }))}
      />
    </div>
  );
}
