"use client";

import React, { useState } from "react";
import { XrplAddress, SupplierName } from "@shucamoxa/shared";

export type SupplierItem = {
  id: string;
  name: string;
  address: string;
  destinationTag?: number | null;
  status: "approved" | "pending_approval" | "needs_approval" | "revoked";
};

export type SuppliersManagerProps = {
  initialSuppliers?: SupplierItem[];
  onSupplierAdded?: (supplier: SupplierItem) => void;
  onSupplierRemoved?: (id: string) => void;
};

export function SuppliersManager({
  initialSuppliers = [],
  onSupplierAdded,
  onSupplierRemoved,
}: SuppliersManagerProps) {
  const [suppliers, setSuppliers] = useState<SupplierItem[]>(initialSuppliers);

  // Add supplier form state
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newTag, setNewTag] = useState("");
  const [addErrors, setAddErrors] = useState<{
    name?: string;
    address?: string;
    form?: string;
  }>({});

  // Edit address state map: supplierId -> { currentAddress, initialAddress, isEditing }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAddress, setEditAddress] = useState<string>("");
  const [editError, setEditError] = useState<string | null>(null);

  const validateAddress = (addr: string): string | undefined => {
    const res = XrplAddress.safeParse(addr);
    if (!res.success) {
      return res.error.issues[0]?.message ?? "not a valid classic XRPL address";
    }
    return undefined;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewName(val);
    const res = SupplierName.safeParse(val);
    if (!res.success && val.length > 0) {
      setAddErrors((prev) => ({
        ...prev,
        name: res.error.issues[0]?.message ?? "Invalid supplier name",
      }));
    } else {
      setAddErrors((prev) => ({ ...prev, name: undefined }));
    }
  };

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewAddress(val);
    const err = validateAddress(val);
    setAddErrors((prev) => ({ ...prev, address: err }));
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameErr = !newName.trim()
      ? "Supplier name required"
      : !SupplierName.safeParse(newName).success
        ? "Invalid supplier name"
        : undefined;
    const addrErr = validateAddress(newAddress);

    if (nameErr || addrErr) {
      setAddErrors({ name: nameErr, address: addrErr });
      return;
    }

    const tagNum = newTag.trim() ? parseInt(newTag.trim(), 10) : null;
    const newSupplier: SupplierItem = {
      id: `sup_${Date.now().toString(36)}`,
      name: newName.trim(),
      address: newAddress.trim(),
      destinationTag: tagNum,
      status: "approved",
    };

    try {
      await fetch("/api/owner/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSupplier),
      }).catch(() => {});
    } finally {
      setSuppliers((prev) => [...prev, newSupplier]);
      onSupplierAdded?.(newSupplier);
      setNewName("");
      setNewAddress("");
      setNewTag("");
      setAddErrors({});
    }
  };

  const handleStartEdit = (s: SupplierItem) => {
    setEditingId(s.id);
    setEditAddress(s.address);
    setEditError(null);
  };

  const handleEditAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEditAddress(val);
    const err = validateAddress(val);
    setEditError(err ?? null);
  };

  const handleSaveEdit = async (s: SupplierItem) => {
    const err = validateAddress(editAddress);
    if (err) {
      setEditError(err);
      return;
    }

    const addressChanged = editAddress.trim() !== s.address;
    const updated: SupplierItem = {
      ...s,
      address: editAddress.trim(),
      status: addressChanged ? "needs_approval" : s.status,
    };

    try {
      await fetch(`/api/owner/suppliers/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      }).catch(() => {});
    } finally {
      setSuppliers((prev) => prev.map((item) => (item.id === s.id ? updated : item)));
      setEditingId(null);
      setEditAddress("");
      setEditError(null);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`/api/owner/suppliers/${id}`, {
        method: "DELETE",
      }).catch(() => {});
    } finally {
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
      onSupplierRemoved?.(id);
    }
  };

  const isAddDisabled =
    !newName.trim() ||
    !newAddress.trim() ||
    !!addErrors.name ||
    !!addErrors.address;

  return (
    <div>
      <div
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          marginBottom: 24,
          maxWidth: 600,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px 0" }}>
          Add Approved Supplier
        </h2>

        <form onSubmit={handleAddSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="supplierName"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#334155",
                marginBottom: 4,
              }}
            >
              Supplier Name
            </label>
            <input
              id="supplierName"
              type="text"
              value={newName}
              onChange={handleNameChange}
              placeholder="e.g. Karoo Textiles"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 14,
                border: addErrors.name ? "1px solid #dc2626" : "1px solid #cbd5e1",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
            {addErrors.name && (
              <p style={{ color: "#dc2626", fontSize: 12, margin: "4px 0 0 0" }}>
                {addErrors.name}
              </p>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="xrplAddress"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#334155",
                marginBottom: 4,
              }}
            >
              XRPL Address
            </label>
            <input
              id="xrplAddress"
              type="text"
              value={newAddress}
              onChange={handleAddressChange}
              placeholder="e.g. rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 14,
                fontFamily: "monospace",
                border: addErrors.address ? "1px solid #dc2626" : "1px solid #cbd5e1",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
            {addErrors.address && (
              <p style={{ color: "#dc2626", fontSize: 12, margin: "4px 0 0 0" }}>
                {addErrors.address}
              </p>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="destinationTag"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "#334155",
                marginBottom: 4,
              }}
            >
              Destination Tag (Optional)
            </label>
            <input
              id="destinationTag"
              type="number"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="e.g. 1001"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 14,
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isAddDisabled}
            style={{
              background: isAddDisabled ? "#94a3b8" : "#2563eb",
              color: "#fff",
              border: "none",
              padding: "10px 18px",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: isAddDisabled ? "not-allowed" : "pointer",
            }}
          >
            Add Supplier
          </button>
        </form>
      </div>

      <div
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px 0" }}>
          Approved Suppliers
        </h2>

        {suppliers.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: 14 }}>No approved suppliers.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {suppliers.map((s) => {
              const isEditing = editingId === s.id;
              const hasAddressChanged =
                isEditing && editAddress.trim() !== s.address;

              return (
                <div
                  key={s.id}
                  style={{
                    padding: 16,
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    background: "#f8fafc",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: "#0f172a" }}>
                      {s.name}
                    </div>

                    {isEditing ? (
                      <div style={{ marginTop: 8 }}>
                        <label
                          htmlFor={`edit-addr-${s.id}`}
                          style={{
                            display: "block",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#64748b",
                            marginBottom: 4,
                          }}
                        >
                          Change XRPL Address:
                        </label>
                        <input
                          id={`edit-addr-${s.id}`}
                          type="text"
                          value={editAddress}
                          onChange={handleEditAddressChange}
                          style={{
                            width: "100%",
                            padding: "6px 10px",
                            fontSize: 13,
                            fontFamily: "monospace",
                            border: editError
                              ? "1px solid #dc2626"
                              : "1px solid #cbd5e1",
                            borderRadius: 4,
                            boxSizing: "border-box",
                          }}
                        />
                        {editError && (
                          <p style={{ color: "#dc2626", fontSize: 11, margin: "2px 0" }}>
                            {editError}
                          </p>
                        )}
                        {hasAddressChanged && (
                          <div
                            style={{
                              marginTop: 6,
                              display: "inline-block",
                              background: "#fef3c7",
                              color: "#b45309",
                              fontSize: 12,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 4,
                            }}
                          >
                            needs re-approval
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 13,
                          fontFamily: "monospace",
                          color: "#475569",
                          marginTop: 4,
                        }}
                      >
                        {s.address}
                        {s.destinationTag != null && ` (Tag: ${s.destinationTag})`}
                      </div>
                    )}

                    {!isEditing && s.status === "needs_approval" && (
                      <span
                        style={{
                          display: "inline-block",
                          marginTop: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: "#fef3c7",
                          color: "#b45309",
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        needs re-approval
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(s)}
                          style={{
                            padding: "6px 12px",
                            fontSize: 13,
                            fontWeight: 600,
                            background: "#16a34a",
                            color: "#fff",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: "6px 12px",
                            fontSize: 13,
                            background: "#e2e8f0",
                            color: "#475569",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(s)}
                        style={{
                          padding: "6px 12px",
                          fontSize: 13,
                          fontWeight: 500,
                          background: "#e0f2fe",
                          color: "#0369a1",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                      >
                        Change Address
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemove(s.id)}
                      style={{
                        padding: "6px 12px",
                        fontSize: 13,
                        fontWeight: 500,
                        background: "#fee2e2",
                        color: "#b91c1c",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
