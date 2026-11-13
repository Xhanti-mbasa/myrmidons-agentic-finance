import React from "react";

export default function RulesPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0" }}>
        Rules & Mandate
      </h1>
      <p style={{ color: "#64748b", margin: "0 0 24px 0", fontSize: 14 }}>
        Configure spending limits, active budget period, kill switch, and
        approved suppliers.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
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
            $50.00 RLUSD
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
            $200.00 RLUSD
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
            Kill Switch
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#16a34a",
              marginTop: 4,
            }}
          >
            ACTIVE (Allowed)
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
            Payment authority enabled
          </div>
        </div>
      </div>
    </div>
  );
}
