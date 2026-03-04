import React from "react";

type Props = {
  fileName: string;
  isJobActive: boolean;
  progressPercent: number;
  isDownloadingResources: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
};

export default function Playback({ fileName, isJobActive, progressPercent, isDownloadingResources, isPlaying, onTogglePlay }: Props) {
  return (
    <div className="lt-playback lt-panel" role="region" aria-label="Playback">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: "Menlo, monospace" }}>{fileName || "No file selected"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onTogglePlay} disabled={!fileName || isDownloadingResources} style={{ height: 32 }}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button type="button" disabled={isJobActive} style={{ height: 32 }}>Load</button>
        </div>
      </div>

      <div className="lt-wave" style={{ marginBottom: 12 }}>
        {/* decorative waveform path - placeholder; will be replaced with real canvas/wave on integration */}
        <svg width="100%" height="120" viewBox="0 0 600 120" preserveAspectRatio="none">
          <path d="M0 60 C40 20,80 100,120 60 C160 20,200 100,240 60 C280 20,320 100,360 60 C400 20,440 100,480 60 C520 20,560 100,600 60" stroke="#0ad688" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="lt-progress"><div className="bar" style={{ width: `${progressPercent}%` }} /></div>
        </div>
        <div style={{ width: 72, textAlign: "right", fontFamily: "Menlo, monospace", color: "var(--muted)" }}>{progressPercent}%</div>
      </div>
    </div>
  );
}
