from __future__ import annotations

import time
from typing import Any

from app.api import JsonRpcProtocol
from app.core import BackendError, DeviceService, PathService, RuntimeContext, StartupValidator
from app.models import TranscriptionRequest
from app.services import JobService, ModelService, PreflightService, TranscriptionService


def _build_ping_result(context: RuntimeContext) -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "localtranscribe-backend",
        "stage": "stage-3-transcription",
        "capabilities": context.capabilities.to_dict(),
    }


def _parse_transcription_request(params: dict[str, Any]) -> TranscriptionRequest:
    file_path = params.get("file_path")
    model_name = params.get("model")
    language = params.get("language", "auto")
    requested_device = params.get("device", "auto")
    allow_model_download = params.get("allow_model_download", False)
    allow_ffmpeg_download = params.get("allow_ffmpeg_download", False)

    if not isinstance(file_path, str):
        raise BackendError(code=1301, message="Invalid file_path", data={"field": "file_path"})
    if not isinstance(model_name, str):
        raise BackendError(code=1302, message="Invalid model", data={"field": "model"})
    if not isinstance(language, str):
        raise BackendError(code=1303, message="Invalid language", data={"field": "language"})
    if not isinstance(requested_device, str):
        raise BackendError(code=1304, message="Invalid device", data={"field": "device"})
    if not isinstance(allow_model_download, bool):
        raise BackendError(code=1305, message="Invalid allow_model_download", data={"field": "allow_model_download"})
    if not isinstance(allow_ffmpeg_download, bool):
        raise BackendError(code=1306, message="Invalid allow_ffmpeg_download", data={"field": "allow_ffmpeg_download"})

    return TranscriptionRequest(
        file_path=file_path,
        model_name=model_name,
        language=language,
        requested_device=requested_device,
        allow_model_download=allow_model_download,
        allow_ffmpeg_download=allow_ffmpeg_download,
    )


def main() -> int:
    protocol = JsonRpcProtocol()

    def emit_download_event(payload: dict[str, Any]) -> None:
        protocol.send_notification(
            "event",
            {
                "type": "resource.download",
                "payload": payload,
                "ts": time.time(),
            },
        )

    try:
        validator = StartupValidator(path_service=PathService(), device_service=DeviceService())
        runtime_context = validator.validate()

        model_service = ModelService(models_dir=runtime_context.paths.models_dir)
        preflight_service = PreflightService(
            models_dir=runtime_context.paths.models_dir,
            ffmpeg_dir=runtime_context.paths.ffmpeg_dir,
        )
        transcription_service = TranscriptionService(
            model_service=model_service,
            capabilities=runtime_context.capabilities,
        )
        job_service = JobService(
            runtime_context=runtime_context,
            transcription_service=transcription_service,
            notify=protocol.send_notification,
        )
    except BackendError as exc:
        protocol.send_error(request_id=None, error=exc)
        return 1
    except Exception as exc:  # pragma: no cover - defensive fallback
        protocol.send_raw_error(
            request_id=None,
            code=1000,
            message="Unhandled startup exception",
            data={"error": str(exc)},
        )
        return 1

    while True:
        request_id: str | int | None = None
        try:
            request = protocol.read_request()
            if request is None:
                return 0
            request_id = request.request_id

            if request.method == "ping":
                protocol.send_result(request.request_id, _build_ping_result(runtime_context))
                continue

            if request.method == "start_transcription":
                transcription_request = _parse_transcription_request(request.params)
                model_service.ensure_model_available(
                    transcription_request.model_name,
                    allow_download=transcription_request.allow_model_download,
                    notify_download=emit_download_event,
                )
                preflight_service.ensure_ffmpeg_available(
                    allow_download=transcription_request.allow_ffmpeg_download,
                    notify_download=emit_download_event,
                )
                job = job_service.start_transcription(transcription_request)
                protocol.send_result(
                    request.request_id,
                    {
                        "job_id": job.job_id,
                        "status": job.status,
                    },
                )
                continue

            if request.method == "get_job_status":
                protocol.send_result(request.request_id, job_service.get_active_job())
                continue

            if request.method == "cancel_job":
                job_id = request.params.get("job_id")
                if job_id is not None and not isinstance(job_id, str):
                    raise BackendError(code=1311, message="Invalid job_id", data={"field": "job_id"})
                protocol.send_result(request.request_id, job_service.cancel_job(job_id if isinstance(job_id, str) and job_id.strip() else None))
                continue

            if request.method == "check_resource_updates":
                model_name = request.params.get("model")
                if model_name is not None and not isinstance(model_name, str):
                    raise BackendError(code=1310, message="Invalid model", data={"field": "model"})

                resolved_model = model_name if isinstance(model_name, str) and model_name.strip() else "medium"
                model_update = model_service.check_model_update(resolved_model)
                ffmpeg_update = preflight_service.check_ffmpeg_update()
                protocol.send_result(
                    request.request_id,
                    {
                        "model": model_update,
                        "ffmpeg": ffmpeg_update,
                    },
                )
                continue

            if request.method == "update_resources":
                model_name = request.params.get("model")
                update_model = request.params.get("update_model", False)
                update_ffmpeg = request.params.get("update_ffmpeg", False)

                if model_name is not None and not isinstance(model_name, str):
                    raise BackendError(code=1311, message="Invalid model", data={"field": "model"})
                if not isinstance(update_model, bool):
                    raise BackendError(code=1312, message="Invalid update_model", data={"field": "update_model"})
                if not isinstance(update_ffmpeg, bool):
                    raise BackendError(code=1313, message="Invalid update_ffmpeg", data={"field": "update_ffmpeg"})

                resolved_model = model_name if isinstance(model_name, str) and model_name.strip() else "medium"

                if update_model:
                    model_service.ensure_model_available(
                        resolved_model,
                        allow_download=True,
                        force_download=True,
                        notify_download=emit_download_event,
                    )

                if update_ffmpeg:
                    preflight_service.ensure_ffmpeg_available(
                        allow_download=True,
                        force_download=True,
                        notify_download=emit_download_event,
                    )

                model_update = model_service.check_model_update(resolved_model)
                ffmpeg_update = preflight_service.check_ffmpeg_update()
                protocol.send_result(
                    request.request_id,
                    {
                        "updated": {
                            "model": update_model,
                            "ffmpeg": update_ffmpeg,
                        },
                        "model": model_update,
                        "ffmpeg": ffmpeg_update,
                    },
                )
                continue

            protocol.send_raw_error(
                request_id=request.request_id,
                code=-32601,
                message="Method not found",
                data={"method": request.method},
            )
        except BackendError as exc:
            protocol.send_error(request_id=request_id, error=exc)
        except Exception as exc:  # pragma: no cover - defensive fallback
            protocol.send_raw_error(
                request_id=None,
                code=1200,
                message="Unhandled runtime exception",
                data={"error": str(exc)},
            )


if __name__ == "__main__":
    raise SystemExit(main())
