/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SuppliersManager } from "../src/components/SuppliersManager";

describe("Supplier form (T34)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("bad-checksum address refused; changing address shows 'needs re-approval'", async () => {
    const initialSuppliers = [
      {
        id: "sup_karoo",
        name: "Karoo Textiles",
        address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
        destinationTag: 1001,
        status: "approved" as const,
      },
    ];

    render(<SuppliersManager initialSuppliers={initialSuppliers} />);

    // Check existing supplier rendered
    expect(screen.getByText("Karoo Textiles")).toBeDefined();

    // 1. Try to add supplier with bad-checksum address
    const nameInput = screen.getByLabelText(/supplier name/i);
    const addressInput = screen.getByLabelText(/xrpl address/i);
    const addButton = screen.getByRole("button", { name: /add supplier/i }) as HTMLButtonElement;

    fireEvent.change(nameInput, { target: { value: "Zambezi Trading" } });
    fireEvent.change(addressInput, { target: { value: "rBadChecksumAddress123456789" } });

    expect(
      screen.getByText(/not a valid classic XRPL address|invalid address/i),
    ).toBeDefined();
    expect(addButton.disabled).toBe(true);

    // 2. Change existing supplier's address -> shows "needs re-approval"
    const editButton = screen.getByRole("button", { name: /edit|change address/i });
    fireEvent.click(editButton);

    const editAddressInput = screen.getByDisplayValue("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
    // Change to another valid address
    fireEvent.change(editAddressInput, {
      target: { value: "rPT1Sjq2YGrBMTttX4GZHjKu9DYfzbpAYe" },
    });

    expect(screen.getByText(/needs re-approval/i)).toBeDefined();
  });
});

