import type {
  BackendApi,
  BackendEventEnvelope,
  BackendRequestPayload,
  DeviceOption,
  ModelOption,
  SaveFilePayload,
  SaveFileResult,
} from "../types/ipc";

function getBackend(): BackendApi {
  const backend = window.localTranscribeBackend;
  if (!backend) {
    throw new Error("Backend bridge unavailable in renderer");
  }
  return backend;
}

export async function sendBackendRequest(payload: BackendRequestPayload): Promise<Record<string, unknown>> {
  return await getBackend().request(payload);
}

export async function startTranscription(input: {
  filePath: string;
  model: ModelOption;
  device: DeviceOption;
  language: string;
  targetLanguage?: string;
  allowModelDownload?: boolean;
  allowFfmpegDownload?: boolean;
  allowTranslationModelDownload?: boolean;
}): Promise<{ jobId: string; status: string }> {
  const params: Record<string, unknown> = {
    file_path: input.filePath,
    model: input.model,
    device: input.device,
    language: input.language,
    allow_model_download: Boolean(input.allowModelDownload),
    allow_ffmpeg_download: Boolean(input.allowFfmpegDownload),
    allow_translation_model_download: Boolean(input.allowTranslationModelDownload),
  };
  if (input.targetLanguage && input.targetLanguage.trim().length > 0) {
    params.target_language = input.targetLanguage.trim();
  }

  const response = await sendBackendRequest({
    method: "start_transcription",
    params,
  });

  const jobId = response.job_id;
  const status = response.status;

  if (typeof jobId !== "string" || typeof status !== "string") {
    throw new Error("Invalid start_transcription response");
  }

  return { jobId, status };
}

export async function getJobStatus(): Promise<Record<string, unknown>> {
  return await sendBackendRequest({ method: "get_job_status", params: {} });
}

export async function getInstalledStatus(): Promise<Record<string, unknown>> {
  return await sendBackendRequest({ method: "get_installed_status", params: {} });
}

export async function checkResourceUpdates(model: ModelOption): Promise<Record<string, unknown>> {
  return await sendBackendRequest({
    method: "check_resource_updates",
    params: { model },
  });
}

export async function updateResources(input: {
  model: ModelOption;
  updateModel: boolean;
  updateFfmpeg: boolean;
}): Promise<Record<string, unknown>> {
  return await sendBackendRequest({
    method: "update_resources",
    params: {
      model: input.model,
      update_model: input.updateModel,
      update_ffmpeg: input.updateFfmpeg,
    },
  });
}

export function subscribeNotifications(listener: (event: BackendEventEnvelope) => void): () => void {
  return getBackend().onNotification((payload) => {
    listener(payload as BackendEventEnvelope);
  });
}

export function subscribeBackendErrors(listener: (payload: Record<string, unknown>) => void): () => void {
  return getBackend().onError(listener);
}

export function subscribeBackendState(listener: (payload: Record<string, unknown>) => void): () => void {
  return getBackend().onState(listener);
}

export async function saveExportFile(payload: SaveFilePayload): Promise<SaveFileResult> {
  return await getBackend().saveFile(payload);
}
