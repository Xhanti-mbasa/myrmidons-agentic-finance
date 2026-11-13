import React from "react";

export default function ChatPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0" }}>
        Owner Chat & Ingestion
      </h1>
      <p style={{ color: "#64748b", margin: "0 0 24px 0", fontSize: 14 }}>
        Direct owner conversational interface and invoice upload.
      </p>

      <div
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
        }}
      >
        <p style={{ margin: "0 0 16px 0", color: "#64748b", fontSize: 14 }}>
          Send an instruction or upload an invoice for processing.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            type="text"
            placeholder="e.g. Pay Karoo 30.00 for INV-001"
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 14,
            }}
          />
          <button
            style={{
              padding: "10px 20px",
              background: "#0284c7",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
