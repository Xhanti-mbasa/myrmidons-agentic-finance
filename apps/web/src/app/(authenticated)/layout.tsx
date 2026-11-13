import React from "react";
import Link from "next/link";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid #e2e8f0",
          background: "#fff",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              Shucamoxa
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                background: "#f1f5f9",
                color: "#475569",
                padding: "2px 6px",
                borderRadius: 4,
                textTransform: "uppercase",
              }}
            >
              XRPL Testnet
            </span>
          </div>

          <nav style={{ display: "flex", gap: 8 }}>
            <Link
              href="/rules"
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
                color: "#334155",
              }}
            >
              Rules
            </Link>
            <Link
              href="/suppliers"
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
                color: "#334155",
              }}
            >
              Suppliers
            </Link>
            <Link
              href="/approvals"
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
                color: "#334155",
              }}
            >
              Approvals
            </Link>
            <Link
              href="/activity"
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
                color: "#334155",
              }}
            >
              Activity
            </Link>
            <Link
              href="/chat"
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
                color: "#334155",
              }}
            >
              Chat
            </Link>
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>Owner Session</span>
          <Link
            href="/login"
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 500,
              color: "#dc2626",
              textDecoration: "none",
              borderRadius: 6,
              border: "1px solid #fecaca",
            }}
          >
            Sign out
          </Link>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          padding: 32,
          maxWidth: 1200,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        {children}
      </main>
    </div>
  );
}
