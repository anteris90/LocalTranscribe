import { useEffect, useMemo, useRef, useState, type ChangeEventHandler } from "react";
import "./ui/theme.css";
import Sidebar from "./ui/Sidebar";
import TranscriptPanel from "./ui/TranscriptPanel";
import ConsolePanel from "./ui/ConsolePanel";

import {
  checkResourceUpdates,
  getJobStatus,
  sendBackendRequest,
  saveExportFile,
  startTranscription,
  subscribeBackendErrors,
  subscribeBackendState,
  subscribeNotifications,
  updateResources,
} from "./services/backendClient";
import { buildExportContent } from "./services/exportFormatters";
import HealthDot, { type HealthDotStatus } from "./ui/HealthDot";
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

type UiJobStatus = "idle" | "queued" | "running" | "completed" | "failed" | "canceled";

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
  const [language, setLanguage] = useState<string>("auto");
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [jobStatus, setJobStatus] = useState<UiJobStatus>("idle");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>("idle");
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [logsText, setLogsText] = useState<string>("");
  const [transcriptSegments, setTranscriptSegments] = useState<ExportSegment[]>([]);
  const [isDownloadingResources, setIsDownloadingResources] = useState<boolean>(false);
  const [effectiveDevice, setEffectiveDevice] = useState<string | null>(null);
  const [effectiveComputeType, setEffectiveComputeType] = useState<string | null>(null);
  const [modelUpdateAvailable, setModelUpdateAvailable] = useState<boolean>(false);
  const [ffmpegUpdateAvailable, setFfmpegUpdateAvailable] = useState<boolean>(false);
  const [isApplyingUpdates, setIsApplyingUpdates] = useState<boolean>(false);

  const [backendLifecycleStatus, setBackendLifecycleStatus] = useState<string>("unknown");
  const [healthLastPingOkAt, setHealthLastPingOkAt] = useState<number>(0);
  const [healthLastPingMs, setHealthLastPingMs] = useState<number | null>(null);
  const [healthLastPingError, setHealthLastPingError] = useState<string | null>(null);
  const [healthLastPingErrorAt, setHealthLastPingErrorAt] = useState<number>(0);
  const [healthConsecutivePingFailures, setHealthConsecutivePingFailures] = useState<number>(0);
  const [healthLastSevereErrorAt, setHealthLastSevereErrorAt] = useState<number>(0);
  const [healthLastSevereErrorMessage, setHealthLastSevereErrorMessage] = useState<string | null>(null);
  const backendActivityAtRef = useRef<number>(Date.now());

  const [infoMessage, setInfoMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [downgradeMessage, setDowngradeMessage] = useState<string>("");
  const lastBootstrapLogBucketRef = useRef<number>(-1);
  const lastDownloadLogBucketRef = useRef<number>(-1);

  const isJobActive = jobStatus === "queued" || jobStatus === "running";
  const hasTranscript = jobStatus === "completed" && transcriptText.trim().length > 0;

  const health = useMemo((): { status: HealthDotStatus; title: string } => {
    const now = Date.now();
    const hasRecentSevere = healthLastSevereErrorAt > 0 && now - healthLastSevereErrorAt < 30000;
    if (hasRecentSevere) {
      return {
        status: "bad",
        title: `Red: ${healthLastSevereErrorMessage ?? "Backend error"}`,
      };
    }

    const backendActivityAgeMs = Math.max(0, now - backendActivityAtRef.current);

    const isBootstrapping = backendLifecycleStatus === "bootstrapping";
    const isRestarting = backendLifecycleStatus === "restarting";
    const isBusy = isJobActive || isDownloadingResources || isApplyingUpdates || isBootstrapping || isRestarting;

    const hasRecentPingError = healthLastPingErrorAt > 0 && now - healthLastPingErrorAt < 15000;
    if (isJobActive && backendActivityAgeMs > 45000 && hasRecentPingError && healthConsecutivePingFailures >= 2) {
      return {
        status: "bad",
        title: "Red: No backend activity (possible freeze)",
      };
    }

    // Prefer a "stale since last OK" signal over transient ping errors.
    if (healthLastPingOkAt > 0) {
      const staleMs = now - healthLastPingOkAt;
      if (staleMs > 20000 && !isBusy) {
        return { status: "bad", title: "Red: Backend heartbeat stale" };
      }
      if (staleMs > 20000 && isBusy) {
        return { status: "warn", title: "Orange: Backend busy" };
      }
    }

    // Only go red for ping errors once we see repeated failures.
    if (hasRecentPingError && !isBusy && healthConsecutivePingFailures >= 2) {
      const detail = healthLastPingError ? ` (${healthLastPingError})` : "";
      return {
        status: "bad",
        title: `Red: Backend not responding${detail}`,
      };
    }

    if (isBusy) {
      const label = isBootstrapping
        ? "Starting backend"
        : isRestarting
          ? "Backend restarting"
          : isJobActive
            ? "Heavy load"
            : "Working";
      const activity = isJobActive && backendActivityAgeMs > 15000 ? ` (last activity ${Math.round(backendActivityAgeMs / 1000)}s ago)` : "";
      const ping = typeof healthLastPingMs === "number" ? ` (ping ${healthLastPingMs}ms)` : "";
      return {
        status: "warn",
        title: `Orange: ${label}${activity}${ping}`,
      };
    }

    if (healthLastPingOkAt === 0) {
      if (backendLifecycleStatus === "running") {
        return { status: "ok", title: "Green: Connected" };
      }
      return { status: "warn", title: "Orange: Checking backend" };
    }

    if (typeof healthLastPingMs === "number" && healthLastPingMs > 1200) {
      return { status: "warn", title: `Orange: Slow (ping ${healthLastPingMs}ms)` };
    }

    const ping = typeof healthLastPingMs === "number" ? ` (ping ${healthLastPingMs}ms)` : "";
    return { status: "ok", title: `Green: OK${ping}` };
  }, [
    backendLifecycleStatus,
    healthLastPingError,
    healthLastPingErrorAt,
    healthConsecutivePingFailures,
    healthLastPingMs,
    healthLastPingOkAt,
    healthLastSevereErrorAt,
    healthLastSevereErrorMessage,
    isApplyingUpdates,
    isDownloadingResources,
    isJobActive,
  ]);

  const startDisabled = useMemo(() => {
    const isProbablyAbsolutePath = (input: string) => {
      const value = input.trim();
      if (value.length === 0) {
        return false;
      }
      // Windows: C:\ or C:/ or UNC \\server\share
      if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
        return true;
      }
      // POSIX absolute
      return value.startsWith("/");
    };

    if (!isProbablyAbsolutePath(selectedFilePath)) {
      return true;
    }
    return false;
  }, [selectedFilePath]);

  const appendLog = (line: string) => {
    const text = line.trim();
    if (text.length === 0) {
      return;
    }
    setLogsText((prev) => (prev.trim().length === 0 ? text : `${prev}\n${text}`));
  };

  // Apply persisted button background color and listen for Edit->Button color menu
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("lt:button-bg");
      if (stored && stored.trim().length > 0) {
        document.documentElement.style.setProperty("--button-bg", stored);
      }
    } catch {
      // ignore
    }

    const unsub = (window as any).localTranscribeBackend?.onOpenColorPicker?.(() => {
      try {
        const input = document.createElement("input");
        input.type = "color";
        const current = getComputedStyle(document.documentElement).getPropertyValue("--button-bg")?.trim() || "#0b2a5a";
        input.value = current;
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.addEventListener("input", () => {
          const val = input.value;
          document.documentElement.style.setProperty("--button-bg", val);
          try { window.localStorage.setItem("lt:button-bg", val); } catch {}
        });
        input.click();
        setTimeout(() => { try { document.body.removeChild(input); } catch {} }, 3000);
      } catch {
        // ignore
      }
    });

    return () => { try { unsub?.(); } catch {} };
  }, []);

  // Lightweight health check: periodically ping the backend over the existing IPC bridge.
  useEffect(() => {
    let cancelled = false;
    const intervalMs = 5000;
    const uiTimeoutMs = 8000;

    const tick = async () => {
      const started = performance.now();
      try {
        await Promise.race([
          sendBackendRequest({ method: "ping", params: {} }),
          new Promise<void>((_resolve, reject) => {
            window.setTimeout(() => reject(new Error("Ping timeout")), uiTimeoutMs);
          }),
        ]);
        if (cancelled) {
          return;
        }
        const elapsed = Math.max(0, Math.round(performance.now() - started));
        setHealthLastPingOkAt(Date.now());
        setHealthLastPingMs(elapsed);
        setHealthLastPingError(null);
        setHealthLastPingErrorAt(0);
        setHealthConsecutivePingFailures(0);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        const elapsed = Math.max(0, Math.round(performance.now() - started));
        const message = error instanceof Error ? error.message : "Ping failed";
        setHealthLastPingMs(elapsed);
        setHealthLastPingError(message);
        setHealthLastPingErrorAt(Date.now());
        setHealthConsecutivePingFailures((prev) => Math.min(20, prev + 1));
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    void getJobStatus()
      .then((response) => {
        const job = response.job as { job_id?: string; status?: string } | null | undefined;
        if (!job) {
          return;
        }
        if (typeof job.job_id === "string") {
          jobIdRef.current = job.job_id;
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

      backendActivityAtRef.current = Date.now();

      const eventType = envelope.params?.type;
      const payload = envelope.params?.payload ?? {};

      // Avoid dropping early events that arrive before React state updates.
      const payloadJobId = (payload as any)?.job_id;
      if (!jobIdRef.current && typeof payloadJobId === "string" && payloadJobId.trim().length > 0) {
        jobIdRef.current = payloadJobId;
        setJobId(payloadJobId);
      }
      const activeJobId = jobIdRef.current;

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
          if (!activeJobId) {
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
          if (!activeJobId) {
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
        if (!activeJobId || event.job_id !== activeJobId) {
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

      if (eventType === "transcription.language_detected") {
        const job = (payload as any).job_id;
        if (!activeJobId || (typeof job === "string" && job !== activeJobId)) {
          return;
        }

        const lang = (payload as any).language;
        const prob = (payload as any).probability;
        if (typeof lang === "string" && lang.trim().length > 0) {
          setDetectedLanguage(lang);
          appendLog(`[language] Detected language: ${lang}${typeof prob === "number" ? ` (p=${prob.toFixed(2)})` : ""}`);
          try {
            // Helpful during dev debugging (DevTools console)
            console.info("[LocalTranscribe] language_detected", { jobId: job, language: lang, probability: prob });
          } catch {
            // ignore
          }
        }
        return;
      }

      if (eventType === "transcription.downgrade") {
        const event = payload as unknown as DowngradeNotification;
        if (!activeJobId || (event.job_id && event.job_id !== activeJobId)) {
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
        if (!activeJobId || event.job_id !== activeJobId) {
          return;
        }

        const isCancelError = (error: any): boolean => {
          const code = error?.code;
          const message = error?.message;
          if (code === 2201) {
            return true;
          }
          if (typeof message === "string" && message.toLowerCase().includes("canceled")) {
            return true;
          }
          return false;
        };

        if (event.status === "running") {
          setIsDownloadingResources(false);
          setIsCancelling(false);
          setJobStatus("running");
          setInfoMessage("Transcription running");
          return;
        }

        if (event.status === "completed") {
          setIsDownloadingResources(false);
          setIsCancelling(false);
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
          if (typeof event.result?.detected_language === "string" && event.result.detected_language.trim().length > 0) {
            setDetectedLanguage(event.result.detected_language);
          }
          setInfoMessage("Transcription completed");
          return;
        }

        if (event.status === "failed") {
          setIsDownloadingResources(false);
          setIsCancelling(false);

          if (isCancelError(event.error)) {
            setJobStatus("canceled");
            setProgressStage("canceled");
            setInfoMessage("Transcription canceled");
            setErrorMessage("");
            appendLog("[job] canceled");
            return;
          }

          setJobStatus("failed");
          setProgressStage("failed");
          setErrorMessage(event.error?.message ?? "Transcription failed");

          const code = event.error?.code;
          const msg = event.error?.message;
          if (typeof code === "number" || (typeof msg === "string" && msg.trim().length > 0)) {
            appendLog(`[error] ${typeof code === "number" ? code : "unknown"}: ${typeof msg === "string" ? msg : "Transcription failed"}`);
          }
          const data = event.error?.data;
          if (data && typeof data === "object") {
            try {
              appendLog(`[error] data: ${JSON.stringify(data)}`);
            } catch {
              appendLog("[error] data: <unserializable>");
            }

            try {
              const attempts = (data as any).attempts;
              if (Array.isArray(attempts)) {
                for (const attempt of attempts) {
                  const dev = typeof attempt?.device === "string" ? attempt.device : "unknown";
                  const ct = typeof attempt?.compute_type === "string" ? attempt.compute_type : "unknown";
                  const acode = typeof attempt?.code === "number" ? attempt.code : null;
                  const amsg = typeof attempt?.message === "string" ? attempt.message : "";
                  const aerr = typeof attempt?.data?.error === "string" ? attempt.data.error : "";
                  const atype = typeof attempt?.data?.type === "string" ? attempt.data.type : (typeof attempt?.type === "string" ? attempt.type : "");

                  const base = `[attempt] ${dev}/${ct}${acode !== null ? ` code=${acode}` : ""}${amsg ? ` ${amsg}` : ""}`;
                  appendLog(atype || aerr ? `${base} :: ${[atype, aerr].filter(Boolean).join(": ")}` : base);
                }
              }
            } catch {
              // ignore
            }
          }

          try {
            // Helpful during dev debugging (DevTools console)
            console.error("[LocalTranscribe] transcription_failed", {
              jobId: event.job_id,
              error: event.error ?? null,
            });

            const attempts = (event.error as any)?.data?.attempts;
            if (Array.isArray(attempts)) {
              for (const attempt of attempts) {
                console.error("[LocalTranscribe] attempt", attempt);
              }
            }
          } catch {
            // ignore
          }
          return;
        }
      }
    });

    const unsubError = subscribeBackendErrors((payload) => {
      backendActivityAtRef.current = Date.now();
      const eventType = payload.type;
      if (eventType === "backend_unresponsive") {
        if (isDownloadingResources) {
          return;
        }
        setHealthLastSevereErrorAt(Date.now());
        setHealthLastSevereErrorMessage("Backend is unresponsive");
        setErrorMessage("Backend is unresponsive");
        return;
      }
      if (eventType === "backend_crash") {
        if (isDownloadingResources) {
          return;
        }
        setHealthLastSevereErrorAt(Date.now());
        setHealthLastSevereErrorMessage("Backend process crashed");
        setErrorMessage("Backend process crashed");
        return;
      }
      if (eventType === "backend_restart_exhausted") {
        if (isDownloadingResources) {
          return;
        }
        setHealthLastSevereErrorAt(Date.now());
        setHealthLastSevereErrorMessage("Backend restart limit reached");
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
      backendActivityAtRef.current = Date.now();
      const status = payload.status;
      if (status === "running") {
        setBackendLifecycleStatus("running");
        setHealthLastPingOkAt((prev) => (prev > 0 ? prev : Date.now()));
        setIsDownloadingResources(false);
        if (!jobId) {
          setJobStatus("idle");
        }
        setInfoMessage("Backend connected");
        setErrorMessage("");
      } else if (status === "restarting") {
        setBackendLifecycleStatus("restarting");
        setInfoMessage("Backend restarting");
      } else if (status === "bootstrapping") {
        setBackendLifecycleStatus("bootstrapping");
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
        setBackendLifecycleStatus("bootstrapping_failed");
        setHealthLastSevereErrorAt(Date.now());
        setHealthLastSevereErrorMessage("Backend bootstrap failed");
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
  }, [isDownloadingResources]);

  const onPickFile: ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const filePath = (file as File & { path?: string }).path;
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      // In some environments the HTML file input does not expose an absolute path.
      // Passing only file.name to the backend will fail with "Input file not found".
      setSelectedFilePath("");
      setSelectedFileName(file.name);
      setInfoMessage("");
      setErrorMessage("Unable to access the full file path. Use 'Select: Audio/Video' instead.");
      return;
    }

    setSelectedFilePath(filePath);
    setSelectedFileName(file.name);
    setErrorMessage("");
    setInfoMessage("File selected");
  };

  const openFilePicker = async () => {
    const backend = (window as any).localTranscribeBackend;
    if (backend?.openFile) {
      try {
        const result = await backend.openFile({ title: "Select Audio/Video" });
        if (!result || result.canceled) {
          setInfoMessage("File selection canceled");
          return;
        }

        const filePath = typeof result.filePath === "string" ? result.filePath : "";
        const fileName = typeof result.fileName === "string" ? result.fileName : "";
        if (filePath.trim().length === 0) {
          setErrorMessage("Invalid file selection");
          return;
        }

        setSelectedFilePath(filePath);
        setSelectedFileName(fileName || filePath);
        setErrorMessage("");
        setInfoMessage("File selected");
        return;
      } catch {
        // fall back to HTML file input
      }
    }

    const el = document.getElementById("filePicker") as HTMLInputElement | null;
    el?.click();
  };

  const onStart = async () => {
    setIsCancelling(false);

    const selectedPath = selectedFilePath.trim();
    const isProbablyAbsolutePath = (input: string) => {
      if (input.length === 0) {
        return false;
      }
      if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith("\\\\")) {
        return true;
      }
      return input.startsWith("/");
    };

    if (!isProbablyAbsolutePath(selectedPath)) {
      setErrorMessage("Invalid file selection. Use 'Select: Audio/Video' and pick a file from disk.");
      setInfoMessage("");
      setJobStatus("idle");
      setProgressStage("idle");
      return;
    }

    setErrorMessage("");
    setInfoMessage("");
    setDowngradeMessage("");
    setTranscriptText("");
    setTranscriptSegments([]);
    setDetectedLanguage(null);
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

          jobIdRef.current = started.jobId;
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

  const onCancel = async () => {
    if (!isJobActive) {
      return;
    }

    try {
      setIsCancelling(true);
      setInfoMessage("Cancel requested...");
      setErrorMessage("");

      await sendBackendRequest({
        method: "cancel_job",
        params: {
          job_id: jobIdRef.current,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to cancel job";
      setErrorMessage(message);
      setInfoMessage("");
      setIsCancelling(false);
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
        language: detectedLanguage ?? language,
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HealthDot status={health.status} title={health.title} />
            <h1 style={{ margin: 0 }}>LocalTranscribe</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            >
              {isApplyingUpdates ? "Updating..." : modelUpdateAvailable || ffmpegUpdateAvailable ? "Update" : "Check for updates"}
            </button>
          </div>
        </div>

      <div className="lt-progress-strip">
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

      <div className="lt-main-grid">
        <div className="lt-file-spanner lt-panel">
          <input id="filePicker" className="lt-file-input" type="file" accept="audio/*,video/*,.mp4,.webm,.wav,.mp3,.mkv,.m4a,.aac,.flac" onChange={onPickFile} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
            <button type="button" className="lt-btn lt-file-btn" onClick={() => { void openFilePicker(); }}>Select: Audio/Video</button>
            <div className="lt-file-name" title={selectedFileName || "No file selected"} style={{ marginLeft: 8, flex: 1 }}>{selectedFileName || "No file selected"}</div>
          </div>
        </div>

        <Sidebar
          selectedFileName={selectedFileName}
          selectedFilePath={selectedFilePath}
          selectedModel={selectedModel}
          selectedDevice={selectedDevice}
          language={language}
          isJobActive={isJobActive}
          isCancelling={isCancelling}
          onModelChange={(m) => setSelectedModel(m)}
          onDeviceChange={(d) => setSelectedDevice(d)}
          onLanguageChange={(v) => setLanguage(v)}
          onPickFile={onPickFile}
          onStart={onStart}
          onCancel={() => { void onCancel(); }}
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
          <section>
            <TranscriptPanel transcriptText={transcriptText} transcriptSegments={transcriptSegments} />
          </section>
        </main>

        <ConsolePanel logsText={logsText} progressPercent={progressPercent} progressStage={progressStage} infoMessage={infoMessage} errorMessage={errorMessage} downgradeMessage={downgradeMessage} effectiveDevice={effectiveDevice} effectiveComputeType={effectiveComputeType} detectedLanguage={detectedLanguage} />
      </div>
    </div>
    </div>
  );
}
