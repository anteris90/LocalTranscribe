import React from "react";

type Props = {
  transcriptText: string;
  transcriptSegments: Array<{ start: number; end: number; text: string }>;
};

export default function TranscriptPanel({ transcriptText, transcriptSegments }: Props) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Transcript</label>
        <textarea readOnly value={transcriptText} className="lt-transcript" />
      </div>

      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Segments</label>
        <div style={{ maxHeight: 160, overflowY: "auto", fontFamily: "Menlo, monospace", color: "var(--muted)" }}>
          {transcriptSegments.length === 0 ? (
            <div style={{ padding: 8 }}>No segments</div>
          ) : (
            transcriptSegments.map((s, i) => (
              <div key={i} style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.start.toFixed(2)} — {s.end.toFixed(2)}</div>
                <div style={{ fontSize: 14 }}>{s.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
