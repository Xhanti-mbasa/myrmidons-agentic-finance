import React from "react";

export default function ActivityPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0" }}>
        Activity & Audit Log
      </h1>
      <p style={{ color: "#64748b", margin: "0 0 24px 0", fontSize: 14 }}>
        Immutable append-only audit feed of decisions, payments, and policy
        events.
      </p>

      <div
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
        }}
      >
        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
          Audit trail log records will appear here as transactions and
          evaluations execute.
        </p>
      </div>
    </div>
  );
}
