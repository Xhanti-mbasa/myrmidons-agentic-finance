import React from "react";

export default function ApprovalsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0" }}>
        Pending Approvals
      </h1>
      <p style={{ color: "#64748b", margin: "0 0 24px 0", fontSize: 14 }}>
        Owner review queue for out-of-mandate requests and unknown suppliers.
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
          No pending approval requests requiring owner attention.
        </p>
      </div>
    </div>
  );
}
