"use client";

import React, { useEffect, useState } from "react";
import { KillSwitchControl, type KillSwitchStatus } from "../../../components/KillSwitchControl";
import { ActivityLogViewer } from "../../../components/ActivityLogViewer";

export default function ActivityPage() {
  const [killSwitchStatus, setKillSwitchStatus] = useState<KillSwitchStatus>("ACTIVE");

  useEffect(() => {
    // Optionally fetch initial kill switch status from rules endpoint
    fetch("/api/owner/rules")
      .then((res) => {
        if (!res.ok) return fetch("/api/rules");
        return res;
      })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.killSwitch === "boolean") {
          setKillSwitchStatus(data.killSwitch ? "REVOKED" : "ACTIVE");
        }
      })
      .catch(() => {
        // Fallback default is ACTIVE
      });
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px 0", color: "#0f172a" }}>
          Activity & Audit Log
        </h1>
        <p style={{ color: "#64748b", margin: 0, fontSize: 14 }}>
          Cryptographically verifiable append-only audit trail and emergency kill-switch controls.
        </p>
      </div>

      {/* Prominent Emergency Kill Switch */}
      <KillSwitchControl
        initialStatus={killSwitchStatus}
        onStatusChange={(newStatus) => setKillSwitchStatus(newStatus)}
      />

      {/* Activity and Audit Log Viewer */}
      <ActivityLogViewer />
    </div>
  );
}
