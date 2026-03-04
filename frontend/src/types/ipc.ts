export type DeviceOption = "auto" | "cpu" | "gpu";
export type ModelOption = "small" | "medium" | "large-v3";

export type BackendRequestPayload = {
  method: string;
  params?: Record<string, unknown>;
};

export type BackendApi = {
  request: (payload: BackendRequestPayload) => Promise<Record<string, unknown>>;
  saveFile: (payload: SaveFilePayload) => Promise<SaveFileResult>;
  onNotification: (listener: (payload: Record<string, unknown>) => void) => () => void;
  onError: (listener: (payload: Record<string, unknown>) => void) => () => void;
  onState: (listener: (payload: Record<string, unknown>) => void) => () => void;
};

export type ExportType = "txt" | "srt" | "json";

export type SaveFilePayload = {
  suggestedName: string;
  extension: ExportType;
  content: string;
};

export type SaveFileResult = {
  canceled: boolean;
  savedPath?: string;
};

export type ExportSegment = {
  start: number;
  end: number;
  text: string;
};

export type ExportTranscriptData = {
  text: string;
  segments: ExportSegment[];
  metadata: {
    model: ModelOption;
    requestedDevice: DeviceOption;
    effectiveDevice: string | null;
    effectiveComputeType: string | null;
    language: string;
    sourceFile: string;
    completedAt: string;
  };
};

export type BackendEventEnvelope = {
  method: string;
  params?: {
    type?: string;
    payload?: Record<string, unknown>;
    ts?: number;
  };
};

export type JobStateNotification = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: {
    text?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    effective_device?: string;
    effective_compute_type?: string;
    detected_language?: string;
    language_probability?: number;
  };
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
};

export type ProgressNotification = {
  job_id: string;
  percent: number;
  stage:
    | "loading"
    | "transcribing"
    | "finalizing"
    | "downloading"
    | "preparing"
    | "extracting"
    | "verifying"
    | "completed"
    | "failed";
  partial_text?: string;
  segment?: {
    start: number;
    end: number;
    text: string;
  };
  device?: string;
  compute_type?: string;
};

export type DowngradeNotification = {
  job_id?: string;
  from_device: string;
  from_compute_type: string;
  to_device: string;
  to_compute_type: string;
  reason: string;
};

export type DownloadNotification = {
  resource: "model" | "ffmpeg";
  model?: string;
  status: "started" | "progress" | "completed" | "failed";
  stage: "preparing" | "downloading" | "extracting" | "verifying" | "completed" | "failed";
  percent?: number;
  message?: string;
};
