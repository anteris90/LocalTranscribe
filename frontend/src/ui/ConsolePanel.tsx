import React from "react";

type Props = {
  logsText: string;
  progressPercent: number;
  progressStage: string;
  infoMessage: string;
  errorMessage: string;
  downgradeMessage: string;
  effectiveDevice: string | null;
  effectiveComputeType: string | null;
};

export default function ConsolePanel({ logsText, progressPercent, progressStage, infoMessage, errorMessage, downgradeMessage, effectiveDevice, effectiveComputeType }: Props) {
  return (
    <aside style={{ width: 260, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="lt-panel">
        <div style={{ color: "var(--muted)" }}>Status</div>
        <div style={{ marginTop: 8 }}>
          <div>Progress: {progressPercent}%</div>
          <div>Stage: {progressStage}</div>
          {effectiveDevice ? <div>Device: {effectiveDevice}</div> : null}
          {effectiveComputeType ? <div>Compute: {effectiveComputeType}</div> : null}
        </div>
      </div>

      <div className="lt-panel" style={{ flex: 1 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Console</label>
        <div style={{ whiteSpace: "pre-wrap", color: "var(--muted)", maxHeight: 360, overflowY: "auto" }}>{logsText || "No logs yet"}</div>
      </div>

      <div className="lt-panel">
        {infoMessage ? <div style={{ color: "#93c5fd" }}>{infoMessage}</div> : null}
        {errorMessage ? <div style={{ color: "#fca5a5" }}>{errorMessage}</div> : null}
        {downgradeMessage ? <div style={{ color: "#fbbf24" }}>{downgradeMessage}</div> : null}
      </div>
    </aside>
  );
}
