import React from "react";
import type { ChangeEventHandler } from "react";
import type { DeviceOption, ModelOption, ExportType } from "../types/ipc";

type Props = {
  selectedFileName: string;
  selectedFilePath: string;
  selectedModel: ModelOption;
  selectedDevice: DeviceOption;
  onModelChange: (v: ModelOption) => void;
  onDeviceChange: (v: DeviceOption) => void;
  onPickFile: ChangeEventHandler<HTMLInputElement>;
  onStart: () => void;
  startDisabled: boolean;
  onCheckUpdates: () => void;
  onApplyUpdates: () => void;
  isApplyingUpdates: boolean;
  modelUpdateAvailable: boolean;
  ffmpegUpdateAvailable: boolean;
  onExport: (type: ExportType) => void;
  hasTranscript: boolean;
};

export default function Sidebar(props: Props) {
  const {
    selectedFileName,
    onPickFile,
    selectedModel,
    selectedDevice,
    onStart,
    startDisabled,
    onCheckUpdates,
    onApplyUpdates,
    isApplyingUpdates,
    modelUpdateAvailable,
    ffmpegUpdateAvailable,
    onExport,
    hasTranscript,
  } = props;

  return (
    <aside style={{ width: 260, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Audio/Video File</label>
        <input id="filePicker" type="file" accept="audio/*,video/*,.mp4,.webm,.wav,.mp3,.mkv,.m4a,.aac,.flac" onChange={onPickFile} />
        <div style={{ marginTop: 8, fontFamily: "Menlo, monospace", color: "var(--muted)" }}>{selectedFileName || "No file selected"}</div>
      </div>

      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Model</label>
        <select value={selectedModel} style={{ width: "100%", height: 32 }} onChange={(e) => props.onModelChange(e.target.value as ModelOption)}>
          <option value="small">small</option>
          <option value="medium">medium</option>
          <option value="large-v3">large-v3</option>
        </select>
      </div>

      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Device</label>
        <select value={selectedDevice} style={{ width: "100%", height: 32 }} onChange={(e) => props.onDeviceChange(e.target.value as DeviceOption)}>
          <option value="auto">Auto</option>
          <option value="cpu">CPU</option>
          <option value="gpu">GPU</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onStart} disabled={startDisabled} style={{ flex: 1, height: 36 }}>
          {startDisabled ? "Busy" : "Start"}
        </button>
        <button
          type="button"
          className="lt-btn-primary"
          onClick={() => {
            if (modelUpdateAvailable || ffmpegUpdateAvailable) {
              onApplyUpdates();
            } else {
              onCheckUpdates();
            }
          }}
          disabled={isApplyingUpdates}
          style={{ height: 36 }}
        >
          {isApplyingUpdates ? "Updating..." : modelUpdateAvailable || ffmpegUpdateAvailable ? "Update" : "Check for updates"}
        </button>
      </div>

      <div className="lt-panel" style={{ marginTop: "auto" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => onExport("txt")} disabled={!hasTranscript}>TXT</button>
          <button type="button" onClick={() => onExport("srt")} disabled={!hasTranscript}>SRT</button>
          <button type="button" onClick={() => onExport("json")} disabled={!hasTranscript}>JSON</button>
        </div>
      </div>
    </aside>
  );
}
