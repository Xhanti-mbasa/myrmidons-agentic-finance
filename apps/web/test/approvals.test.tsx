/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SupplierProposalCard, PaymentApprovalCard } from "../src/components/ApprovalCards";

describe("Approval cards (T34)", () => {
  afterEach(() => {
    cleanup();
  });

  it("Approval card with evidence <img src=x onerror=alert(1)> and supplier <b>x</b>: both render as literal text; container.querySelector('img, b') is null", () => {
    const maliciousEvidence = "<img src=x onerror=alert(1)>";
    const maliciousSupplier = "<b>x</b>";

    const { container } = render(
      <SupplierProposalCard
        approvalId="apr_supplier_xss"
        supplierName={maliciousSupplier}
        address="rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
        evidence={maliciousEvidence}
        invoiceNumber="INV-999"
      />,
    );

    // Literal text rendered
    expect(container.textContent).toContain(maliciousEvidence);
    expect(container.textContent).toContain(maliciousSupplier);

    // Both render as literal text; container.querySelector("img, b") is null
    expect(container.querySelector("img, b")).toBeNull();
  });

  it("Supplier-proposal card: Approve disabled until typed last 6 characters match proposed address", () => {
    const onApprove = vi.fn();
    const address = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"; // last 6: "wdtyTh"

    render(
      <SupplierProposalCard
        approvalId="apr_supplier_1"
        supplierName="Cape Produce"
        address={address}
        evidence="New verified supplier"
        invoiceNumber="INV-101"
        onApprove={onApprove}
      />,
    );

    // Address in monospace
    const addressElement = screen.getByTestId("proposed-address");
    expect(addressElement.style.fontFamily).toMatch(/monospace/i);

    // Last 6 characters highlighted
    const highlighted = screen.getByTestId("highlighted-address-suffix");
    expect(highlighted.textContent).toBe("wdtyTh");

    const approveButton = screen.getByRole("button", { name: /approve/i }) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);

    const input = screen.getByLabelText(/type last 6 characters|confirm address suffix/i);

    // Type incorrect 6 characters
    fireEvent.change(input, { target: { value: "xxxxxx" } });
    expect(approveButton.disabled).toBe(true);

    // Type only 5 characters of match
    fireEvent.change(input, { target: { value: "wdtyT" } });
    expect(approveButton.disabled).toBe(true);

    // Type exact last 6 characters
    fireEvent.change(input, { target: { value: "wdtyTh" } });
    expect(approveButton.disabled).toBe(false);

    fireEvent.click(approveButton);
    expect(onApprove).toHaveBeenCalledWith("apr_supplier_1");
  });

  it("Payment-approval card displays amount, supplier, invoice, and signing instruction", () => {
    render(
      <PaymentApprovalCard
        approvalId="apr_pay_789"
        amount="150.00"
        supplier="Karoo Textiles"
        invoiceNumber="INV-2026-088"
        reason="Over cap approval"
      />,
    );

    expect(screen.getByText(/150\.00/)).toBeDefined();
    expect(screen.getByText(/Karoo Textiles/)).toBeDefined();
    expect(screen.getByText(/INV-2026-088/)).toBeDefined();
    expect(screen.getByText(/Run pnpm owner:sign apr_pay_789/)).toBeDefined();
  });
});

