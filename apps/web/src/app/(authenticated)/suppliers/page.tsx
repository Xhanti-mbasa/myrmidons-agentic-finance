"use client";

import React, { useEffect, useState } from "react";
import {
  SuppliersManager,
  type SupplierItem,
} from "../../../components/SuppliersManager";

const DEFAULT_SUPPLIERS: SupplierItem[] = [
  {
    id: "sup_karoo",
    name: "Karoo Textiles",
    address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    destinationTag: 1001,
    status: "approved",
  },
  {
    id: "sup_zambezi",
    name: "Zambezi Trading",
    address: "rPT1Sjq2YGrBMTttX4GZHjKu9DYfzbpAYe",
    destinationTag: 2002,
    status: "approved",
  },
];

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierItem[]>(DEFAULT_SUPPLIERS);

  useEffect(() => {
    fetch("/api/rules")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.suppliers)) {
          // If returned suppliers are {id, name}, merge or map them
          const mapped: SupplierItem[] = data.suppliers.map((s: { id: string; name: string; address?: string }) => ({
            id: s.id,
            name: s.name,
            address: s.address ?? "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
            status: "approved" as const,
          }));
          if (mapped.length > 0) {
            setSuppliers(mapped);
          }
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0" }}>
        Suppliers Management
      </h1>
      <p style={{ color: "#64748b", margin: "0 0 24px 0", fontSize: 14 }}>
        Manage approved payees, XRPL classic addresses, and destination tags.
      </p>

      <SuppliersManager
        initialSuppliers={suppliers}
        onSupplierAdded={(newS) => setSuppliers((prev) => [...prev, newS])}
        onSupplierRemoved={(id) => setSuppliers((prev) => prev.filter((s) => s.id !== id))}
      />
    </div>
  );
}
