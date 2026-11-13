"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  verifyChain,
  GENESIS_HASH,
  type LogEntry,
} from "@shucamoxa/shared";

export type ActivityLogViewerProps = {
  initialEntries?: LogEntry[];
  fetchEndpoint?: string;
  defaultPageSize?: number;
  onExport?: (format: "json" | "csv", content: string) => void;
};

export function getSafeTestnetExplorerUrl(
  txHash: string | null | undefined,
): string | null {
  if (!txHash || typeof txHash !== "string") return null;
  const trimmed = txHash.trim();
  if (!/^[0-9A-Fa-f]{64}$/.test(trimmed)) {
    return null;
  }
  return `https://testnet.xrpl.org/transactions/${trimmed.toUpperCase()}`;
}

export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatLogEntriesAsCsv(entries: readonly LogEntry[]): string {
  const headers = [
    "seq",
    "ts",
    "actor",
    "event",
    "invoiceNumber",
    "supplierId",
    "amount",
    "ruleCode",
    "explanation",
    "txHash",
    "ledgerResult",
    "prevHash",
    "hash",
  ];

  const rows = entries.map((e) =>
    [
      e.seq,
      e.ts,
      e.actor,
      e.event,
      e.invoiceNumber,
      e.supplierId,
      e.amount,
      e.ruleCode,
      e.explanation,
      e.txHash,
      e.ledgerResult,
      e.prevHash,
      e.hash,
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

type VerificationStatus =
  | { state: "idle" }
  | { state: "verifying" }
  | { state: "verified"; count: number }
  | { state: "broken"; badSeq: number }
  | { state: "error"; message: string };

export function ActivityLogViewer({
  initialEntries,
  fetchEndpoint = "/api/owner/log",
  defaultPageSize = 10,
  onExport,
}: ActivityLogViewerProps) {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries || []);
  const [isLoading, setIsLoading] = useState(!initialEntries);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationStatus>({
    state: "idle",
  });

  // Table Controls
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [searchFilter, setSearchFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  // Fetch log entries
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      let res = await fetch(fetchEndpoint);
      // Fallback to /api/agent/log if /api/owner/log returned 404
      if (!res.ok && res.status === 404 && fetchEndpoint !== "/api/agent/log") {
        res = await fetch("/api/agent/log");
      }

      if (!res.ok) {
        throw new Error(`Failed to load audit logs: HTTP ${res.status}`);
      }

      const data = await res.json();
      const rawList: LogEntry[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.entries)
          ? data.entries
          : [];

      setEntries(rawList);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [fetchEndpoint]);

  useEffect(() => {
    if (!initialEntries) {
      fetchLogs();
    }
  }, [initialEntries, fetchLogs]);

  // Compute live in-browser verification
  useEffect(() => {
    let cancelled = false;

    const runVerification = async () => {
      setVerification({ state: "verifying" });

      if (entries.length === 0) {
        if (!cancelled) {
          setVerification({ state: "verified", count: 0 });
        }
        return;
      }

      try {
        // Sort ascending by sequence number to ensure canonical order
        const ascending = [...entries].sort((a, b) => a.seq - b.seq);
        const badSeq = await verifyChain(ascending);

        if (cancelled) return;

        if (badSeq === null) {
          setVerification({ state: "verified", count: entries.length });
        } else {
          setVerification({ state: "broken", badSeq });
        }
      } catch (err) {
        if (!cancelled) {
          setVerification({
            state: "error",
            message: err instanceof Error ? err.message : "Verification error",
          });
        }
      }
    };

    runVerification();

    return () => {
      cancelled = true;
    };
  }, [entries]);

  // Filter and sort entries
  const processedEntries = useMemo(() => {
    let list = [...entries];

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter((e) => {
        return (
          e.explanation?.toLowerCase().includes(q) ||
          e.invoiceNumber?.toLowerCase().includes(q) ||
          e.supplierId?.toLowerCase().includes(q) ||
          e.event?.toLowerCase().includes(q) ||
          e.actor?.toLowerCase().includes(q) ||
          e.ruleCode?.toLowerCase().includes(q) ||
          e.txHash?.toLowerCase().includes(q)
        );
      });
    }

    if (sortOrder === "newest") {
      list.sort((a, b) => b.seq - a.seq);
    } else {
      list.sort((a, b) => a.seq - b.seq);
    }

    return list;
  }, [entries, searchFilter, sortOrder]);

  // Pagination calculation
  const totalEntries = processedEntries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedEntries = processedEntries.slice(
    startIndex,
    startIndex + pageSize,
  );

  // File export handlers
  const handleExportJson = () => {
    const jsonContent = JSON.stringify(entries, null, 2);
    if (onExport) {
      onExport("json", jsonContent);
    }

    if (typeof window !== "undefined" && typeof document !== "undefined") {
      try {
        const isJsdom =
          typeof navigator !== "undefined" &&
          navigator.userAgent?.includes("jsdom");
        if (!isJsdom && typeof URL.createObjectURL === "function") {
          const blob = new Blob([jsonContent], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `shucamoxa-audit-log-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch {
        // Handled safely in non-browser or test environments
      }
    }
  };

  const handleExportCsv = () => {
    const csvContent = formatLogEntriesAsCsv(entries);
    if (onExport) {
      onExport("csv", csvContent);
    }

    if (typeof window !== "undefined" && typeof document !== "undefined") {
      try {
        const isJsdom =
          typeof navigator !== "undefined" &&
          navigator.userAgent?.includes("jsdom");
        if (!isJsdom && typeof URL.createObjectURL === "function") {
          const blob = new Blob([csvContent], {
            type: "text/csv;charset=utf-8;",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `shucamoxa-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch {
        // Handled safely in non-browser or test environments
      }
    }
  };

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: 24,
        boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
      }}
      data-testid="activity-log-viewer"
    >
      {/* Header and Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#0f172a",
              margin: "0 0 6px 0",
            }}
          >
            Audit Trail & Activity Log
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* Live in-browser hash-chain verification badge */}
            <div data-testid="hash-chain-badge">
              {verification.state === "verifying" && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: "#f1f5f9",
                    color: "#475569",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  Verifying hash chain...
                </span>
              )}
              {verification.state === "verified" && (
                <span
                  data-testid="hash-chain-verified"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: "#dcfce7",
                    color: "#166534",
                    border: "1px solid #86efac",
                  }}
                >
                  <span style={{ fontSize: 13 }}>✓</span>
                  Hash Chain Verified ({verification.count} entries)
                </span>
              )}
              {verification.state === "broken" && (
                <span
                  data-testid="hash-chain-broken"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: "#fee2e2",
                    color: "#991b1b",
                    border: "1px solid #f87171",
                  }}
                >
                  <span style={{ fontSize: 13 }}>⚠</span>
                  Hash Chain Broken at seq {verification.badSeq}
                </span>
              )}
              {verification.state === "error" && (
                <span
                  data-testid="hash-chain-error"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: "#fef3c7",
                    color: "#92400e",
                    border: "1px solid #fcd34d",
                  }}
                >
                  Verification error: {verification.message}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons: Export and Refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="export-json-btn"
            onClick={handleExportJson}
            disabled={entries.length === 0}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#334155",
              cursor: entries.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Export JSON
          </button>

          <button
            type="button"
            data-testid="export-csv-btn"
            onClick={handleExportCsv}
            disabled={entries.length === 0}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#334155",
              cursor: entries.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Export CSV
          </button>

          <button
            type="button"
            data-testid="refresh-log-btn"
            onClick={fetchLogs}
            disabled={isLoading}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#334155",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Genesis Checkpoint Context Card */}
      <div
        data-testid="genesis-checkpoint-card"
        style={{
          backgroundColor: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: "12px 16px",
          marginBottom: 20,
          fontSize: 13,
          color: "#475569",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          <div>
            <strong style={{ color: "#0f172a" }}>Genesis Checkpoint:</strong>{" "}
            <code
              data-testid="genesis-hash-display"
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "#2563eb",
                backgroundColor: "#eff6ff",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              {GENESIS_HASH}
            </code>
          </div>
          <div>
            <strong style={{ color: "#0f172a" }}>Window:</strong>{" "}
            {entries.length > 0
              ? `seq 1 to ${entries.length} (${entries.length} entries in store)`
              : "Empty log"}
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>
          Each log entry embeds the cryptographic SHA-256 hash of its predecessor, anchored at genesis. In-browser verification re-computes every link in canonical sequence order to detect tampering, deletion, or reordering.
        </p>
      </div>

      {/* Error or Loading states */}
      {fetchError && (
        <div
          data-testid="fetch-error"
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 6,
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 13,
          }}
        >
          {fetchError}
        </div>
      )}

      {/* Search and Pagination Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 300px" }}>
          <input
            type="text"
            data-testid="filter-input"
            placeholder="Search by invoice, supplier, event, explanation..."
            value={searchFilter}
            onChange={(e) => {
              setSearchFilter(e.target.value);
              setCurrentPage(1);
            }}
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              width: "100%",
              maxWidth: 400,
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#64748b" }}>
            <label htmlFor="sort-order-select">Sort:</label>
            <select
              id="sort-order-select"
              data-testid="sort-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as "newest" | "oldest")}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                backgroundColor: "#fff",
              }}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#64748b" }}>
            <label htmlFor="page-size-select">Per page:</label>
            <select
              id="page-size-select"
              data-testid="page-size-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                backgroundColor: "#fff",
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          data-testid="audit-table"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            textAlign: "left",
          }}
        >
          <thead>
            <tr style={{ borderBottom: "2px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Seq</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Time (UTC)</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Actor</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Event</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Invoice</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Supplier</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Amount</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Rule</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Explanation</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>XRPL Testnet Tx</th>
              <th style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>Hash</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && entries.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                  Loading audit log records...
                </td>
              </tr>
            ) : paginatedEntries.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                  No audit log entries found.
                </td>
              </tr>
            ) : (
              paginatedEntries.map((row) => {
                const safeExplorerUrl = getSafeTestnetExplorerUrl(row.txHash);
                return (
                  <tr
                    key={row.seq}
                    data-testid={`log-row-${row.seq}`}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#0f172a" }}>
                      #{row.seq}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#64748b", whiteSpace: "nowrap" }}>
                      {row.ts}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 4,
                          textTransform: "uppercase",
                          backgroundColor:
                            row.actor === "agent"
                              ? "#eff6ff"
                              : row.actor === "policy"
                                ? "#f5f3ff"
                                : row.actor === "payment"
                                  ? "#f0fdf4"
                                  : row.actor === "owner"
                                    ? "#fef3c7"
                                    : "#f1f5f9",
                          color:
                            row.actor === "agent"
                              ? "#1d4ed8"
                              : row.actor === "policy"
                                ? "#6d28d9"
                                : row.actor === "payment"
                                  ? "#15803d"
                                  : row.actor === "owner"
                                    ? "#b45309"
                                    : "#475569",
                        }}
                      >
                        {row.actor}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 4,
                          backgroundColor: row.event.includes("settled")
                            ? "#dcfce7"
                            : row.event.includes("blocked") || row.event.includes("failed")
                              ? "#fee2e2"
                              : row.event.includes("kill_switch")
                                ? "#fef2f2"
                                : "#f1f5f9",
                          color: row.event.includes("settled")
                            ? "#166534"
                            : row.event.includes("blocked") || row.event.includes("failed")
                              ? "#991b1b"
                              : row.event.includes("kill_switch")
                                ? "#b91c1c"
                                : "#334155",
                        }}
                      >
                        {row.event}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontFamily: "monospace",
                        color: "#334155",
                      }}
                    >
                      {row.invoiceNumber ?? "-"}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontFamily: "monospace",
                        color: "#334155",
                      }}
                    >
                      {row.supplierId ?? "-"}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 500, color: "#0f172a" }}>
                      {row.amount ? `$${row.amount} RLUSD` : "-"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {row.ruleCode ? (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: 4,
                            backgroundColor: "#fef2f2",
                            color: "#b91c1c",
                          }}
                        >
                          {row.ruleCode}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        color: "#475569",
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={row.explanation}
                    >
                      {row.explanation}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {safeExplorerUrl ? (
                        <a
                          href={safeExplorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`tx-link-${row.seq}`}
                          style={{
                            color: "#2563eb",
                            fontFamily: "monospace",
                            textDecoration: "underline",
                            fontSize: 12,
                          }}
                        >
                          {row.txHash?.slice(0, 8)}...{row.txHash?.slice(-6)}
                        </a>
                      ) : row.txHash ? (
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>
                          {row.txHash.slice(0, 8)}...
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        title={`Hash: ${row.hash}\nPrev: ${row.prevHash}`}
                        style={{
                          fontSize: 11,
                          fontFamily: "monospace",
                          color: "#64748b",
                          backgroundColor: "#f8fafc",
                          padding: "2px 4px",
                          borderRadius: 3,
                        }}
                      >
                        {row.hash.slice(0, 8)}...
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 16,
          paddingTop: 16,
          borderTop: "1px solid #f1f5f9",
          fontSize: 13,
          color: "#64748b",
        }}
      >
        <div>
          Showing {totalEntries === 0 ? 0 : startIndex + 1} to{" "}
          {Math.min(startIndex + pageSize, totalEntries)} of {totalEntries} entries
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            data-testid="pagination-prev"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              backgroundColor: "#fff",
              color: safePage <= 1 ? "#94a3b8" : "#334155",
              cursor: safePage <= 1 ? "not-allowed" : "pointer",
            }}
          >
            Previous
          </button>

          <span data-testid="page-indicator">
            Page {safePage} of {totalPages}
          </span>

          <button
            type="button"
            data-testid="pagination-next"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              backgroundColor: "#fff",
              color: safePage >= totalPages ? "#94a3b8" : "#334155",
              cursor: safePage >= totalPages ? "not-allowed" : "pointer",
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
