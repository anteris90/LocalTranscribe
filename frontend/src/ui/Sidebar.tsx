import React from "react";
import type { ChangeEventHandler } from "react";
import type { DeviceOption, ModelOption, ExportType } from "../types/ipc";

type Props = {
  selectedFileName: string;
  selectedFilePath: string;
  selectedModel: ModelOption;
  selectedDevice: DeviceOption;
  language: string;
  targetLanguage: string;
  isJobActive: boolean;
  isCancelling: boolean;
  onModelChange: (v: ModelOption) => void;
  onDeviceChange: (v: DeviceOption) => void;
  onLanguageChange: (v: string) => void;
  onTargetLanguageChange: (v: string) => void;
  onPickFile: ChangeEventHandler<HTMLInputElement>;
  onStart: () => void;
  onCancel: () => void;
  startDisabled: boolean;
  onCheckUpdates: () => void;
  onApplyUpdates: () => void;
  isApplyingUpdates: boolean;
  modelUpdateAvailable: boolean;
  ffmpegUpdateAvailable: boolean;
  onExport: (type: ExportType) => void;
  hasTranscript: boolean;
  installedModels: Record<string, boolean>;
  installedTranslationPkgs: string[];
};

export default function Sidebar(props: Props) {
  const {
    selectedFileName,
    onPickFile,
    selectedModel,
    selectedDevice,
    language,
    targetLanguage,
    isJobActive,
    isCancelling,
    onStart,
    onCancel,
    startDisabled,
    onCheckUpdates,
    onApplyUpdates,
    isApplyingUpdates,
    modelUpdateAvailable,
    ffmpegUpdateAvailable,
    onExport,
    hasTranscript,
    installedModels,
    installedTranslationPkgs,
  } = props;

  const dl = (installed: boolean | undefined) => installed ? " ✓" : "";

  return (
    <aside style={{ width: 260, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* File picker moved to main area so it can align with the Status panel */}

      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Model</label>
        <select value={selectedModel} style={{ width: "100%", height: 32 }} onChange={(e) => props.onModelChange(e.target.value as ModelOption)}>
          <option value="small">{`small${dl(installedModels["small"])}`}</option>
          <option value="medium">{`medium${dl(installedModels["medium"])}`}</option>
          <option value="large-v3">{`large-v3${dl(installedModels["large-v3"])}`}</option>
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

      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Language</label>
        <select value={language} style={{ width: "100%", height: 32 }} onChange={(e) => props.onLanguageChange(e.target.value)}>
          <option value="auto">Auto (detect)</option>
          <option value="en">English (en)</option>
          <option value="es">Spanish (es)</option>
          <option value="fr">French (fr)</option>
          <option value="de">German (de)</option>
          <option value="it">Italian (it)</option>
          <option value="pt">Portuguese (pt)</option>
          <option value="ru">Russian (ru)</option>
          <option value="zh">Chinese (zh)</option>
          <option value="ko">Korean (ko)</option>
          <option value="ar">Arabic (ar)</option>
          <option value="hi">Hindi (hi)</option>
          <option value="hu">Hungarian (hu)</option>
          <option value="ja">Japanese (ja)</option>
          <option value="pl">Polish (pl)</option>
          <option value="tr">Turkish (tr)</option>
          <option value="nl">Dutch (nl)</option>
        </select>
      </div>

      <div className="lt-panel">
        <label style={{ display: "block", marginBottom: 6 }}>Translate to</label>
        <select value={targetLanguage} style={{ width: "100%", height: 32 }} onChange={(e) => props.onTargetLanguageChange(e.target.value)}>
          <option value="">None (keep original)</option>
          <option value="en">{`English (en)${dl(installedTranslationPkgs.includes("en"))}`}</option>
          <option value="es">{`Spanish (es)${dl(installedTranslationPkgs.includes("es"))}`}</option>
          <option value="fr">{`French (fr)${dl(installedTranslationPkgs.includes("fr"))}`}</option>
          <option value="de">{`German (de)${dl(installedTranslationPkgs.includes("de"))}`}</option>
          <option value="it">{`Italian (it)${dl(installedTranslationPkgs.includes("it"))}`}</option>
          <option value="pt">{`Portuguese (pt)${dl(installedTranslationPkgs.includes("pt"))}`}</option>
          <option value="ru">{`Russian (ru)${dl(installedTranslationPkgs.includes("ru"))}`}</option>
          <option value="zh">{`Chinese (zh)${dl(installedTranslationPkgs.includes("zh"))}`}</option>
          <option value="ko">{`Korean (ko)${dl(installedTranslationPkgs.includes("ko"))}`}</option>
          <option value="ar">{`Arabic (ar)${dl(installedTranslationPkgs.includes("ar"))}`}</option>
          <option value="hi">{`Hindi (hi)${dl(installedTranslationPkgs.includes("hi"))}`}</option>
          <option value="hu">{`Hungarian (hu)${dl(installedTranslationPkgs.includes("hu"))}`}</option>
          <option value="ja">{`Japanese (ja)${dl(installedTranslationPkgs.includes("ja"))}`}</option>
          <option value="pl">{`Polish (pl)${dl(installedTranslationPkgs.includes("pl"))}`}</option>
          <option value="tr">{`Turkish (tr)${dl(installedTranslationPkgs.includes("tr"))}`}</option>
          <option value="nl">{`Dutch (nl)${dl(installedTranslationPkgs.includes("nl"))}`}</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="lt-btn"
          onClick={isJobActive ? onCancel : onStart}
          disabled={isJobActive ? isCancelling : startDisabled}
          style={{ flex: 1 }}
        >
          {isJobActive ? (isCancelling ? "Cancelling..." : "Cancel") : (startDisabled ? "Nothing to do" : "Start")}
        </button>
      </div>

      <div className="lt-panel" style={{ marginTop: "auto" }}>
        <label style={{ display: "block", marginBottom: 8 }}>Export</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="lt-btn" onClick={() => onExport("txt")} disabled={!hasTranscript}>TXT</button>
          <button type="button" className="lt-btn" onClick={() => onExport("srt")} disabled={!hasTranscript}>SRT</button>
          <button type="button" className="lt-btn" onClick={() => onExport("json")} disabled={!hasTranscript}>JSON</button>
        </div>
      </div>
    </aside>
  );
}
