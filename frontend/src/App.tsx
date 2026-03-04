import { useEffect, useMemo, useRef, useState, type ChangeEventHandler } from "react";
import "./ui/theme.css";
import Sidebar from "./ui/Sidebar";
import TranscriptPanel from "./ui/TranscriptPanel";
import ConsolePanel from "./ui/ConsolePanel";

import {
  checkResourceUpdates,
  getJobStatus,
  saveExportFile,
  startTranscription,
  subscribeBackendErrors,
  subscribeBackendState,
  subscribeNotifications,
  updateResources,
} from "./services/backendClient";
import { buildExportContent } from "./services/exportFormatters";
import type {
  DownloadNotification,
  DeviceOption,
  DowngradeNotification,
  ExportSegment,
  ExportType,
  JobStateNotification,
  ModelOption,
  ProgressNotification,
} from "./types/ipc";

type UiJobStatus = "idle" | "queued" | "running" | "completed" | "failed";

const modelOptions: ModelOption[] = ["small", "medium", "large-v3"];
const deviceOptions: Array<{ value: DeviceOption; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "cpu", label: "CPU" },
  { value: "gpu", label: "GPU" },
];

export function App() {
  const [selectedFilePath, setSelectedFilePath] = useState<string>("");
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<ModelOption>("medium");
  const [selectedDevice, setSelectedDevice] = useState<DeviceOption>("auto");
  const [language] = useState<string>("en");

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<UiJobStatus>("idle");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>("idle");
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [logsText, setLogsText] = useState<string>("");
  const [transcriptSegments, setTranscriptSegments] = useState<ExportSegment[]>([]);
  const [isDownloadingResources, setIsDownloadingResources] = useState<boolean>(false);
  const [effectiveDevice, setEffectiveDevice] = useState<string | null>(null);
  const [effectiveComputeType, setEffectiveComputeType] = useState<string | null>(null);
  const [modelUpdateAvailable, setModelUpdateAvailable] = useState<boolean>(false);
  const [ffmpegUpdateAvailable, setFfmpegUpdateAvailable] = useState<boolean>(false);
  const [isApplyingUpdates, setIsApplyingUpdates] = useState<boolean>(false);

  const [infoMessage, setInfoMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [downgradeMessage, setDowngradeMessage] = useState<string>("");
  const lastBootstrapLogBucketRef = useRef<number>(-1);
  const lastDownloadLogBucketRef = useRef<number>(-1);

  const isJobActive = jobStatus === "queued" || jobStatus === "running";
  const hasTranscript = jobStatus === "completed" && transcriptText.trim().length > 0;

  const startDisabled = useMemo(() => {
    if (!selectedFilePath) {
      return true;
    }
    return isJobActive;
  }, [selectedFilePath, isJobActive]);

  const appendLog = (line: string) => {
    const text = line.trim();
    if (text.length === 0) {
      return;
    }
    setLogsText((prev) => (prev.trim().length === 0 ? text : `${prev}\n${text}`));
  };

  useEffect(() => {
    void getJobStatus()
      .then((response) => {
        const job = response.job as { job_id?: string; status?: string } | null | undefined;
        if (!job) {
          return;
        }
        if (typeof job.job_id === "string") {
          setJobId(job.job_id);
        }
        if (job.status === "queued" || job.status === "running") {
          setJobStatus(job.status);
          setInfoMessage("Resumed active transcription job");
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unable to query backend";
        if (message.includes("Backend bridge unavailable")) {
          return;
        }
        if (message.includes("Backend is not running")) {
          setInfoMessage("Initializing backend runtime...");
          return;
        }
        if (message.includes("Backend request timeout for method: get_job_status")) {
          setInfoMessage("Backend is busy; status check will resume automatically");
          return;
        }
        setErrorMessage(message);
      });
  }, []);

  useEffect(() => {
    const unsubNotification = subscribeNotifications((envelope) => {
      if (envelope.method !== "event") {
        return;
      }

      const eventType = envelope.params?.type;
      const payload = envelope.params?.payload ?? {};

      if (eventType === "resource.download") {
        const event = payload as unknown as DownloadNotification;
        const message = typeof event.message === "string" ? event.message : "";
        const stageLabel = typeof event.stage === "string" ? event.stage : "downloading";

        if (event.status === "started" || event.status === "progress") {
          setIsDownloadingResources(true);
          setJobStatus("queued");
          setProgressStage(stageLabel);
          if (event.status === "started") {
            lastDownloadLogBucketRef.current = -1;
          }
          if (typeof event.percent === "number") {
            const percent = Math.max(0, Math.min(100, Math.floor(event.percent)));
            setProgressPercent(percent);
            const bucket = Math.floor(percent / 10) * 10;
            if (bucket > lastDownloadLogBucketRef.current) {
              lastDownloadLogBucketRef.current = bucket;
              if (message.length > 0) {
                appendLog(`[download] ${message}`);
              }
            }
          }
          return;
        }

        if (event.status === "completed") {
          setIsDownloadingResources(false);
          if (!jobId) {
            setJobStatus("idle");
          }
          setProgressPercent(100);
          setProgressStage("completed");
          if (message.length > 0) {
            appendLog(`[download] ${message}`);
          }
          return;
        }

        if (event.status === "failed") {
          setIsDownloadingResources(false);
          if (!jobId) {
            setJobStatus("idle");
          }
          setProgressStage("failed");
          if (message.length > 0) {
            appendLog(`[download] ${message}`);
          }
          return;
        }
      }

      if (eventType === "transcription.progress") {
        const event = payload as unknown as ProgressNotification;
        if (!jobId || event.job_id !== jobId) {
          return;
        }

        if (typeof event.percent === "number") {
          setProgressPercent(Math.max(0, Math.min(100, Math.floor(event.percent))));
        }
        if (typeof event.stage === "string") {
          setProgressStage(event.stage);
        }
        if (event.partial_text && event.partial_text.trim().length > 0) {
          setTranscriptText((prev) => (prev.length === 0 ? event.partial_text ?? "" : `${prev}\n${event.partial_text ?? ""}`));
        }
        return;
      }

      if (eventType === "transcription.downgrade") {
        const event = payload as unknown as DowngradeNotification;
        if (!jobId || (event.job_id && event.job_id !== jobId)) {
          return;
        }
        const fromDevice = event.from_device ?? "unknown";
        const toDevice = event.to_device ?? "unknown";
        const reason = event.reason ?? "unspecified";
        setDowngradeMessage(`Device downgraded: ${fromDevice} -> ${toDevice} (${reason})`);
        return;
      }

      if (eventType === "transcription.job_state") {
        const event = payload as unknown as JobStateNotification;
        if (!jobId || event.job_id !== jobId) {
          return;
        }

        if (event.status === "running") {
          setIsDownloadingResources(false);
          setJobStatus("running");
          setInfoMessage("Transcription running");
          return;
        }

        if (event.status === "completed") {
          setIsDownloadingResources(false);
          setJobStatus("completed");
          setProgressPercent(100);
          setProgressStage("completed");
          const finalText = event.result?.text;
          if (typeof finalText === "string") {
            setTranscriptText(finalText);
          }
          if (Array.isArray(event.result?.segments)) {
            const cleaned = event.result.segments
              .filter((segment) =>
                typeof segment.start === "number" &&
                typeof segment.end === "number" &&
                typeof segment.text === "string"
              )
              .map((segment) => ({
                start: segment.start,
                end: segment.end,
                text: segment.text,
              }));
            setTranscriptSegments(cleaned);
          }
          setEffectiveDevice(event.result?.effective_device ?? null);
          setEffectiveComputeType(event.result?.effective_compute_type ?? null);
          setInfoMessage("Transcription completed");
          return;
        }

        if (event.status === "failed") {
          setIsDownloadingResources(false);
          setJobStatus("failed");
          setProgressStage("failed");
          setErrorMessage(event.error?.message ?? "Transcription failed");
          return;
        }
      }
    });

    const unsubError = subscribeBackendErrors((payload) => {
      const eventType = payload.type;
      if (eventType === "backend_unresponsive") {
        if (isDownloadingResources) {
          return;
        }
        setErrorMessage("Backend is unresponsive");
        return;
      }
      if (eventType === "backend_crash") {
        if (isDownloadingResources) {
          return;
        }
        setErrorMessage("Backend process crashed");
        return;
      }
      if (eventType === "backend_restart_exhausted") {
        if (isDownloadingResources) {
          return;
        }
        setErrorMessage("Backend restart limit reached");
        return;
      }

      if (eventType === "backend_stderr") {
        if (isDownloadingResources) {
          return;
        }
        const message = typeof payload.message === "string" ? payload.message.trim() : "";
        if (message.length > 0) {
          const cleaned = message.replace(/\s+/g, " ");
          appendLog(`[backend] ${cleaned}`);
        }
        return;
      }

      if (isDownloadingResources) {
        return;
      }

      const details = typeof payload.message === "string" && payload.message.trim().length > 0
        ? payload.message.trim()
        : "Backend error received";
      setErrorMessage(details);
    });

    const unsubState = subscribeBackendState((payload) => {
      const status = payload.status;
      if (status === "running") {
        setIsDownloadingResources(false);
        if (!jobId) {
          setJobStatus("idle");
        }
        setInfoMessage("Backend connected");
        setErrorMessage("");
      } else if (status === "restarting") {
        setInfoMessage("Backend restarting");
      } else if (status === "bootstrapping") {
        setIsDownloadingResources(true);
        const stage = typeof payload.stage === "string" ? payload.stage : "downloading";
        const message = typeof payload.message === "string" ? payload.message : "Preparing runtime...";
        setProgressStage(stage);
        if (typeof payload.percent === "number") {
          const percent = Math.max(0, Math.min(100, Math.floor(payload.percent)));
          setProgressPercent(percent);
          const bucket = Math.floor(percent / 10) * 10;
          if (bucket > lastBootstrapLogBucketRef.current) {
            lastBootstrapLogBucketRef.current = bucket;
            appendLog(`[bootstrap] ${message}`);
          }
        }
      } else if (status === "bootstrapping_failed") {
        setIsDownloadingResources(false);
        const message = typeof payload.message === "string" ? payload.message : "Backend bootstrap failed";
        setErrorMessage(message);
        appendLog(`[bootstrap] ${message}`);
      }
    });

    return () => {
      unsubNotification();
      unsubError();
      unsubState();
    };
  }, [isDownloadingResources, jobId]);

  const onPickFile: ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedFilePath((file as File & { path?: string }).path ?? file.name);
    setSelectedFileName(file.name);
    setErrorMessage("");
    setInfoMessage("File selected");
  };

  const onStart = async () => {
    setErrorMessage("");
    setInfoMessage("");
    setDowngradeMessage("");
    setTranscriptText("");
    setTranscriptSegments([]);
    setEffectiveDevice(null);
    setEffectiveComputeType(null);
    setProgressPercent(0);
    setProgressStage("loading");
    setIsDownloadingResources(false);

    try {
      let allowModelDownload = false;
      let allowFfmpegDownload = false;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const started = await startTranscription({
            filePath: selectedFilePath,
            model: selectedModel,
            device: selectedDevice,
            language,
            allowModelDownload,
            allowFfmpegDownload,
          });

          setJobId(started.jobId);
          setJobStatus(started.status === "queued" ? "queued" : "running");
          setInfoMessage(`Job started (${started.jobId})`);
          return;
        } catch (attemptError: unknown) {
          const attemptMessage =
            attemptError instanceof Error ? attemptError.message : "Unable to start transcription";

          const missingModel =
            attemptMessage.includes("local model directory is missing") ||
            (attemptMessage.includes("model '") && attemptMessage.includes("incomplete"));
          if (missingModel && !allowModelDownload) {
            const approveModelDownload = window.confirm(
              `Model '${selectedModel}' is not available locally. Download it now?\n\nThis may take several minutes and requires internet access.`
            );
            if (approveModelDownload) {
              allowModelDownload = true;
              setIsDownloadingResources(true);
              setProgressStage("downloading");
              setProgressPercent(1);
              appendLog(`[download] Downloading model '${selectedModel}'...`);
              continue;
            }
          }

          const missingFfmpeg = attemptMessage.includes("ffmpeg binary is missing");
          if (missingFfmpeg && !allowFfmpegDownload) {
            const approveFfmpegDownload = window.confirm(
              "FFmpeg is not available locally. Download it now?\n\nThis is required for media decoding and requires internet access."
            );
            if (approveFfmpegDownload) {
              allowFfmpegDownload = true;
              setIsDownloadingResources(true);
              setProgressStage("downloading");
              setProgressPercent(1);
              appendLog("[download] Downloading ffmpeg...");
              continue;
            }
          }

          throw attemptError;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to start transcription";

      if (message.includes("Backend is not running")) {
        setErrorMessage("Backend is not running");
        return;
      }
      setErrorMessage(message);
      setJobStatus("failed");
      setProgressStage("failed");
      setIsDownloadingResources(false);
    }
  };



  const onExport = async (type: ExportType) => {
    if (!hasTranscript) {
      return;
    }

    setErrorMessage("");

    const sourceStem = selectedFileName.trim().length > 0 ? selectedFileName.replace(/\.[^.]+$/, "") : "transcript";
    const suggestedName = `${sourceStem}.${type}`;

    const content = buildExportContent(type, {
      text: transcriptText,
      segments: transcriptSegments,
      metadata: {
        model: selectedModel,
        requestedDevice: selectedDevice,
        effectiveDevice,
        effectiveComputeType,
        language,
        sourceFile: selectedFileName || selectedFilePath,
        completedAt: new Date().toISOString(),
      },
    });

    try {
      const saveResult = await saveExportFile({
        suggestedName,
        extension: type,
        content,
      });

      if (saveResult.canceled) {
        setInfoMessage("Export canceled");
        return;
      }

      setInfoMessage(`Exported ${type.toUpperCase()}${saveResult.savedPath ? ` to ${saveResult.savedPath}` : ""}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Export failed";
      setErrorMessage(message);
    }
  };

  const onCheckUpdates = async () => {
    setErrorMessage("");
    setInfoMessage("Checking updates...");

    try {
      const response = await checkResourceUpdates(selectedModel);

      const model = response.model as {
        installed?: boolean;
        update_available?: boolean;
        check_error?: string | null;
      } | undefined;
      const ffmpeg = response.ffmpeg as {
        installed?: boolean;
        update_available?: boolean;
        check_error?: string | null;
      } | undefined;

      const modelSummary = model?.installed
        ? model.update_available
          ? `Model '${selectedModel}': update available`
          : "Model: up to date"
        : "Model: not installed";

      const ffmpegSummary = ffmpeg?.installed
        ? ffmpeg.update_available
          ? "FFmpeg: update available"
          : "FFmpeg: up to date"
        : "FFmpeg: not installed";

      const warnings: string[] = [];
      if (typeof model?.check_error === "string" && model.check_error.trim().length > 0) {
        warnings.push("model check offline/failed");
      }
      if (typeof ffmpeg?.check_error === "string" && ffmpeg.check_error.trim().length > 0) {
        warnings.push("ffmpeg check offline/failed");
      }

      const suffix = warnings.length > 0 ? ` (${warnings.join(", ")})` : "";
      const message = `${modelSummary} | ${ffmpegSummary}${suffix}`;
      setModelUpdateAvailable(Boolean(model?.update_available));
      setFfmpegUpdateAvailable(Boolean(ffmpeg?.update_available));
      setInfoMessage(message);
      appendLog(`[updates] ${message}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Update check failed";
      if (message.includes("Method not found")) {
        setErrorMessage("Update check is not available in this backend build. Please install the latest app package.");
        return;
      }
      setErrorMessage(message);
    }
  };

  const onApplyUpdates = async () => {
    const updateModel = modelUpdateAvailable;
    const updateFfmpeg = ffmpegUpdateAvailable;
    if (!updateModel && !updateFfmpeg) {
      setInfoMessage("No updates available");
      return;
    }

    const targets = [
      updateModel ? `model '${selectedModel}'` : null,
      updateFfmpeg ? "ffmpeg" : null,
    ].filter((value): value is string => Boolean(value));

    const approved = window.confirm(
      `Update ${targets.join(" and ")} now?\n\nThis may take several minutes and requires internet access.`
    );
    if (!approved) {
      return;
    }

    setIsApplyingUpdates(true);
    setIsDownloadingResources(true);
    setProgressPercent(1);
    setProgressStage("downloading");
    setErrorMessage("");
    setInfoMessage(`Updating ${targets.join(" and ")}...`);
    appendLog(`[updates] Updating ${targets.join(" and ")}...`);

    try {
      await updateResources({
        model: selectedModel,
        updateModel,
        updateFfmpeg,
      });

      setModelUpdateAvailable(false);
      setFfmpegUpdateAvailable(false);
      setInfoMessage("Resource updates completed");
      await onCheckUpdates();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Resource update failed";
      if (message.includes("Method not found")) {
        setErrorMessage("Resource update is not available in this backend build. Please install the latest app package.");
        return;
      }
      setErrorMessage(message);
    } finally {
      setIsApplyingUpdates(false);
      setIsDownloadingResources(false);
    }
  };

  return (
    <div className="lt-root" style={{ minHeight: "100vh" }}>
      <div className="lt-container">
        <div className="lt-topbar">
          <h1 style={{ margin: 0 }}>LocalTranscribe</h1>
        </div>

      <div style={{ marginTop: "14px", padding: "10px", border: "1px solid #374151", borderRadius: "6px", background: "#1f2937" }}>
        <div>
          Progress: {progressPercent}% | Stage: {progressStage}
        </div>
        <div style={{ marginTop: "8px", height: "8px", width: "100%", borderRadius: "999px", background: "#374151", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${progressPercent}%`,
              background: isDownloadingResources ? "#f59e0b" : "#60a5fa",
              transition: "width 180ms ease-out",
            }}
          />
        </div>
        {downgradeMessage ? <div style={{ marginTop: "6px", color: "#fbbf24" }}>{downgradeMessage}</div> : null}
        {infoMessage ? <div style={{ marginTop: "6px", color: "#93c5fd" }}>{infoMessage}</div> : null}
        {errorMessage ? <div style={{ marginTop: "6px", color: "#fca5a5" }}>{errorMessage}</div> : null}
      </div>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "260px 1fr 260px", gap: 12 }}>
        <Sidebar
          selectedFileName={selectedFileName}
          selectedFilePath={selectedFilePath}
          selectedModel={selectedModel}
          selectedDevice={selectedDevice}
          onPickFile={onPickFile}
          onStart={onStart}
          startDisabled={startDisabled}
          onCheckUpdates={onCheckUpdates}
          onApplyUpdates={onApplyUpdates}
          isApplyingUpdates={isApplyingUpdates}
          modelUpdateAvailable={modelUpdateAvailable}
          ffmpegUpdateAvailable={ffmpegUpdateAvailable}
          onExport={onExport}
          hasTranscript={hasTranscript}
        />

        <main>
          <TranscriptPanel transcriptText={transcriptText} transcriptSegments={transcriptSegments} />
        </main>

        <ConsolePanel logsText={logsText} progressPercent={progressPercent} progressStage={progressStage} infoMessage={infoMessage} errorMessage={errorMessage} downgradeMessage={downgradeMessage} effectiveDevice={effectiveDevice} effectiveComputeType={effectiveComputeType} />
      </div>
    </div>
  );
}
