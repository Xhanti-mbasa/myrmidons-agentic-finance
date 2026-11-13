/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { KillSwitchControl } from "../src/components/KillSwitchControl";
import {
  ActivityLogViewer,
  getSafeTestnetExplorerUrl,
  formatLogEntriesAsCsv,
} from "../src/components/ActivityLogViewer";
import { hashLogEntry, GENESIS_HASH, type LogEntry } from "@shucamoxa/shared";

// Helper to construct cryptographically valid audit log chains
async function createValidChain(count: number): Promise<LogEntry[]> {
  const chain: LogEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= count; i++) {
    const raw = {
      seq: i,
      ts: `2026-11-13T12:0${i}:00.000Z`,
      actor: (i === 1 ? "agent" : i === 2 ? "policy" : "payment") as const,
      event: (i === 1 ? "invoice_received" : i === 2 ? "policy_allowed" : "payment_settled") as const,
      invoiceNumber: `INV-${100 + i}`,
      supplierId: "sup_karoo",
      amount: "50.00",
      ruleCode: null,
      explanation: `Audit event record ${i}`,
      txHash: i === 3 ? "E0F7C018A589F2A6E97E89269552EB6A88939D0C31F2A7A446F00F3124119BBD" : null,
      ledgerResult: i === 3 ? "tesSUCCESS" : null,
      prevHash: prev,
    };
    const hash = await hashLogEntry(prev, raw);
    const entry: LogEntry = { ...raw, hash };
    chain.push(entry);
    prev = hash;
  }
  return chain;
}

describe("Activity & Kill Switch (T35)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Kill Switch Control", () => {
    it("renders ACTIVE status prominently, opens modal on emergency button click, cancels safely", async () => {
      render(<KillSwitchControl initialStatus="ACTIVE" />);

      const statusBadge = screen.getByTestId("kill-switch-status");
      expect(statusBadge.textContent).toContain("ACTIVE");

      const stopBtn = screen.getByTestId("trigger-kill-switch-btn");
      expect(stopBtn.textContent).toContain("Stop All Payments Immediately");

      // Modal is not visible initially
      expect(screen.queryByTestId("kill-switch-modal")).toBeNull();

      // Click to open confirmation modal
      fireEvent.click(stopBtn);
      const modal = screen.getByTestId("kill-switch-modal");
      expect(modal).toBeDefined();
      expect(screen.getByText(/Confirm Emergency Kill Switch/i)).toBeDefined();

      // Click Cancel in modal -> modal closes, no fetch made
      const cancelBtn = screen.getByTestId("modal-cancel-btn");
      fireEvent.click(cancelBtn);
      expect(screen.queryByTestId("kill-switch-modal")).toBeNull();
      expect(screen.getByTestId("kill-switch-status").textContent).toContain("ACTIVE");
    });

    it("triggers POST /api/owner/kill-switch upon confirmation and updates status to REVOKED", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, killSwitch: true }),
      });
      global.fetch = fetchMock;

      const onStatusChange = vi.fn();
      render(
        <KillSwitchControl
          initialStatus="ACTIVE"
          onStatusChange={onStatusChange}
          endpoint="/api/owner/kill-switch"
        />,
      );

      fireEvent.click(screen.getByTestId("trigger-kill-switch-btn"));
      const confirmBtn = screen.getByTestId("modal-confirm-btn");
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/owner/kill-switch",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({ "Content-Type": "application/json" }),
            body: JSON.stringify({ on: true, killSwitch: true }),
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("kill-switch-status").textContent).toContain("REVOKED");
      });

      expect(onStatusChange).toHaveBeenCalledWith("REVOKED");
      expect(screen.getByTestId("kill-switch-notice").textContent).toContain(
        "Emergency kill switch triggered successfully",
      );
    });

    it("allows re-enabling payment authority when currently REVOKED", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, killSwitch: false }),
      });
      global.fetch = fetchMock;

      render(<KillSwitchControl initialStatus="REVOKED" />);
      expect(screen.getByTestId("kill-switch-status").textContent).toContain("REVOKED");

      const resumeBtn = screen.getByTestId("resume-kill-switch-btn");
      expect(resumeBtn.textContent).toContain("Re-enable Payment Authority");
      fireEvent.click(resumeBtn);

      const confirmBtn = screen.getByTestId("modal-confirm-btn");
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/owner/kill-switch",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ on: false, killSwitch: false }),
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("kill-switch-status").textContent).toContain("ACTIVE");
      });
    });
  });

  describe("In-Browser Hash Chain Verification", () => {
    it("displays green 'Hash Chain Verified (N entries)' badge for a valid chain", async () => {
      const validChain = await createValidChain(3);

      render(<ActivityLogViewer initialEntries={validChain} />);

      await waitFor(() => {
        const badge = screen.getByTestId("hash-chain-verified");
        expect(badge).toBeDefined();
        expect(badge.textContent).toContain("Hash Chain Verified (3 entries)");
      });

      // Verification badge has green styling
      const badge = screen.getByTestId("hash-chain-verified");
      expect(badge.style.backgroundColor).toBe("rgb(220, 252, 231)"); // #dcfce7
    });

    it("displays red alert 'Hash Chain Broken at seq X' when an entry is corrupted or tampered", async () => {
      const chain = await createValidChain(3);
      // Tamper entry 2: change amount from 50.00 to 999.00 without recomputing hash
      chain[1] = {
        ...chain[1]!,
        amount: "999.00",
      };

      render(<ActivityLogViewer initialEntries={chain} />);

      await waitFor(() => {
        const brokenBadge = screen.getByTestId("hash-chain-broken");
        expect(brokenBadge).toBeDefined();
        expect(brokenBadge.textContent).toContain("Hash Chain Broken at seq 2");
      });

      const brokenBadge = screen.getByTestId("hash-chain-broken");
      expect(brokenBadge.style.backgroundColor).toBe("rgb(254, 226, 226)"); // #fee2e2
    });

    it("handles empty log entries cleanly as verified 0 entries", async () => {
      render(<ActivityLogViewer initialEntries={[]} />);

      await waitFor(() => {
        const badge = screen.getByTestId("hash-chain-verified");
        expect(badge.textContent).toContain("Hash Chain Verified (0 entries)");
      });
    });
  });

  describe("Genesis Checkpoint Context", () => {
    it("displays Genesis Checkpoint hash and maintains verification regardless of table sort order", async () => {
      const validChain = await createValidChain(4);

      render(<ActivityLogViewer initialEntries={validChain} />);

      // Verify genesis hash is displayed
      const genesisDisplay = screen.getByTestId("genesis-hash-display");
      expect(genesisDisplay.textContent).toBe(GENESIS_HASH);

      // Verify chain initially verified
      await waitFor(() => {
        expect(screen.getByTestId("hash-chain-verified").textContent).toContain(
          "Hash Chain Verified (4 entries)",
        );
      });

      // Switch sort to Oldest First
      const sortSelect = screen.getByTestId("sort-select");
      fireEvent.change(sortSelect, { target: { value: "oldest" } });

      // Verification remains verified (does not break because of UI display sort)
      await waitFor(() => {
        expect(screen.getByTestId("hash-chain-verified").textContent).toContain(
          "Hash Chain Verified (4 entries)",
        );
      });

      // Table displays seq #1 as first row
      const firstRow = screen.getByTestId("log-row-1");
      expect(firstRow).toBeDefined();
    });
  });

  describe("Safe Testnet Explorer Links", () => {
    it("getSafeTestnetExplorerUrl only permits valid 64-hex hashes and testnet URL", () => {
      const validHash = "E0F7C018A589F2A6E97E89269552EB6A88939D0C31F2A7A446F00F3124119BBD";
      const url = getSafeTestnetExplorerUrl(validHash);
      expect(url).toBe(`https://testnet.xrpl.org/transactions/${validHash}`);

      // Rejects non-64-hex strings
      expect(getSafeTestnetExplorerUrl("12345")).toBeNull();
      expect(getSafeTestnetExplorerUrl("")).toBeNull();
      expect(getSafeTestnetExplorerUrl(null)).toBeNull();
      expect(getSafeTestnetExplorerUrl(undefined)).toBeNull();

      // Rejects malicious protocol injection
      expect(getSafeTestnetExplorerUrl("javascript:alert(1)")).toBeNull();
      expect(getSafeTestnetExplorerUrl("https://evil.com/")).toBeNull();

      // Rejects mainnet or invalid characters
      expect(getSafeTestnetExplorerUrl("G".repeat(64))).toBeNull();
      expect(getSafeTestnetExplorerUrl("../../../etc/passwd")).toBeNull();
    });

    it("renders safe testnet explorer link with target=_blank and rel=noopener noreferrer", async () => {
      const validChain = await createValidChain(3); // entry 3 has txHash

      render(<ActivityLogViewer initialEntries={validChain} />);

      await waitFor(() => {
        const txLink = screen.getByTestId("tx-link-3") as HTMLAnchorElement;
        expect(txLink).toBeDefined();
        expect(txLink.href).toBe(
          "https://testnet.xrpl.org/transactions/E0F7C018A589F2A6E97E89269552EB6A88939D0C31F2A7A446F00F3124119BBD",
        );
        expect(txLink.target).toBe("_blank");
        expect(txLink.rel).toBe("noopener noreferrer");
      });
    });
  });

  describe("Export Audit Log", () => {
    it("exports JSON with full hashes, prevHash, and sequence metadata", async () => {
      const validChain = await createValidChain(2);
      const onExport = vi.fn();

      render(<ActivityLogViewer initialEntries={validChain} onExport={onExport} />);

      const exportJsonBtn = screen.getByTestId("export-json-btn");
      fireEvent.click(exportJsonBtn);

      expect(onExport).toHaveBeenCalledWith("json", expect.any(String));
      const exported = JSON.parse(onExport.mock.calls[0]![1] as string);
      expect(exported).toHaveLength(2);
      expect(exported[0].seq).toBe(1);
      expect(exported[0].hash).toBeDefined();
      expect(exported[0].prevHash).toBe(GENESIS_HASH);
    });

    it("exports CSV with formatted headers and escaped entries", async () => {
      const validChain = await createValidChain(2);
      const onExport = vi.fn();

      render(<ActivityLogViewer initialEntries={validChain} onExport={onExport} />);

      const exportCsvBtn = screen.getByTestId("export-csv-btn");
      fireEvent.click(exportCsvBtn);

      expect(onExport).toHaveBeenCalledWith("csv", expect.any(String));
      const csv = onExport.mock.calls[0]![1] as string;
      expect(csv).toContain("seq,ts,actor,event,invoiceNumber,supplierId,amount,ruleCode,explanation,txHash,ledgerResult,prevHash,hash");
      expect(csv).toContain("INV-101");
      expect(csv).toContain("sup_karoo");
      expect(csv).toContain(GENESIS_HASH);
    });

    it("formatLogEntriesAsCsv correctly escapes quotes and commas", () => {
      const row: LogEntry = {
        seq: 1,
        ts: "2026-11-13T12:00:00.000Z",
        actor: "agent",
        event: "invoice_received",
        invoiceNumber: "INV-001,A",
        supplierId: "sup_karoo",
        amount: "50.00",
        ruleCode: null,
        explanation: 'Invoice with "special" notes and, commas',
        txHash: null,
        ledgerResult: null,
        prevHash: GENESIS_HASH,
        hash: "b".repeat(64),
      };

      const csv = formatLogEntriesAsCsv([row]);
      expect(csv).toContain('"INV-001,A"');
      expect(csv).toContain('"Invoice with ""special"" notes and, commas"');
    });
  });

  describe("Pagination & XSS Safety", () => {
    it("paginates entries and navigates between pages", async () => {
      const chain = await createValidChain(15);

      render(<ActivityLogViewer initialEntries={chain} defaultPageSize={10} />);

      const pageIndicator = screen.getByTestId("page-indicator");
      expect(pageIndicator.textContent).toBe("Page 1 of 2");

      const nextBtn = screen.getByTestId("pagination-next");
      expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

      const prevBtn = screen.getByTestId("pagination-prev");
      expect((prevBtn as HTMLButtonElement).disabled).toBe(true);

      // Navigate to page 2
      fireEvent.click(nextBtn);
      expect(screen.getByTestId("page-indicator").textContent).toBe("Page 2 of 2");
      expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
      expect((prevBtn as HTMLButtonElement).disabled).toBe(false);
    });

    it("renders malicious payload as literal text; container.querySelector('script, img, b') is null", async () => {
      const maliciousRaw = {
        seq: 1,
        ts: "2026-11-13T12:00:00.000Z",
        actor: "agent" as const,
        event: "invoice_received" as const,
        invoiceNumber: "<img src=x onerror=alert(1)>",
        supplierId: "<b>sup_evil</b>",
        amount: "50.00",
        ruleCode: null,
        explanation: "<script>alert('xss')</script>",
        txHash: null,
        ledgerResult: null,
        prevHash: GENESIS_HASH,
      };
      const hash = await hashLogEntry(GENESIS_HASH, maliciousRaw);
      const entry: LogEntry = { ...maliciousRaw, hash };

      const { container } = render(<ActivityLogViewer initialEntries={[entry]} />);

      // Plain text appears
      expect(container.textContent).toContain("<script>alert('xss')</script>");
      expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
      expect(container.textContent).toContain("<b>sup_evil</b>");

      // No HTML tags inserted into the DOM
      const auditTable = screen.getByTestId("audit-table");
      expect(auditTable.querySelector("script, img, b")).toBeNull();
    });
  });
});
