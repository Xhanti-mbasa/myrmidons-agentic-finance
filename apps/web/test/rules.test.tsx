/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { RulesForm } from "../src/components/RulesForm";

describe("Rules form (T34)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('refuses "30.001" and "-5" inline, accepts "50" and "50.00", and submits PUT /api/owner/rules with string amounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    global.fetch = fetchMock;

    render(
      <RulesForm
        initialRules={{
          perPaymentCap: "20.00",
          totalBudget: "100.00",
          periodStart: "2026-11-01",
          spent: "10.00",
          reserved: "5.00",
          remaining: "85.00",
        }}
      />,
    );

    const capInput = screen.getByLabelText(/cap/i);
    const saveButton = screen.getByRole("button", { name: /save|update/i });

    // 1. Enter "30.001" -> refused inline
    fireEvent.change(capInput, { target: { value: "30.001" } });
    expect(screen.getByText(/decimal string like "30.00"|invalid amount/i)).toBeDefined();
    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();

    // 2. Enter "-5" -> refused inline
    fireEvent.change(capInput, { target: { value: "-5" } });
    expect(
      screen.getByText(/decimal string like "30.00"|invalid amount|greater than zero/i),
    ).toBeDefined();
    fireEvent.click(saveButton);
    expect(fetchMock).not.toHaveBeenCalled();

    // 3. Enter "50" -> accepted
    fireEvent.change(capInput, { target: { value: "50" } });
    expect(screen.queryByText(/decimal string like "30.00"|invalid amount/i)).toBeNull();

    // 4. Enter "50.00" -> accepted and submits PUT /api/owner/rules with string amounts
    fireEvent.change(capInput, { target: { value: "50.00" } });
    expect(screen.queryByText(/decimal string like "30.00"|invalid amount/i)).toBeNull();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/owner/rules",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: expect.any(String),
        }),
      );
    });

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const body = JSON.parse(call![1]?.body as string);
    expect(body.perPaymentCap).toBe("50.00");
    expect(typeof body.perPaymentCap).toBe("string");
    expect(typeof body.totalBudget).toBe("string");
  });
});
