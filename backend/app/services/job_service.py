from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from app.core.errors import BackendError
from app.core.startup import RuntimeContext
from app.models.transcription import TranscriptionRequest, TranscriptionResult
from app.services.transcription_service import TranscriptionService

NotificationSender = Callable[[str, dict[str, Any]], None]


@dataclass(slots=True)
class JobRecord:
    job_id: str
    status: str
    request: TranscriptionRequest
    created_at: float
    started_at: float | None = None
    completed_at: float | None = None
    result: TranscriptionResult | None = None
    error: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "request": {
                "file_path": self.request.file_path,
                "model_name": self.request.model_name,
                "language": self.request.language,
                "requested_device": self.request.requested_device,
            },
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "result": self.result.to_dict() if self.result else None,
            "error": self.error,
        }


class JobService:
    def __init__(
        self,
        runtime_context: RuntimeContext,
        transcription_service: TranscriptionService,
        notify: NotificationSender,
    ) -> None:
        self._runtime_context = runtime_context
        self._transcription_service = transcription_service
        self._notify = notify
        self._lock = threading.Lock()
        self._active_job: JobRecord | None = None

    def start_transcription(self, request: TranscriptionRequest) -> JobRecord:
        with self._lock:
            if self._active_job and self._active_job.status in {"queued", "running"}:
                raise BackendError(
                    code=3001,
                    message="A transcription job is already active",
                    data={"active_job_id": self._active_job.job_id},
                )

            job = JobRecord(
                job_id=str(uuid.uuid4()),
                status="queued",
                request=request,
                created_at=time.time(),
            )
            self._active_job = job

        worker = threading.Thread(target=self._run_job, args=(job.job_id,), daemon=True)
        worker.start()

        return job

    def get_active_job(self) -> dict[str, Any]:
        with self._lock:
            if self._active_job is None:
                return {"job": None}
            return {"job": self._active_job.to_dict()}

    def _run_job(self, job_id: str) -> None:
        with self._lock:
            job = self._active_job
            if job is None or job.job_id != job_id:
                return
            job.status = "running"
            job.started_at = time.time()

        self._emit(
            "transcription.job_state",
            {
                "job_id": job_id,
                "status": "running",
            },
        )

        try:
            result = self._transcription_service.transcribe(
                request=job.request,
                emit_event=lambda event_type, payload: self._emit(
                    event_type,
                    {"job_id": job_id, **payload},
                ),
            )

            with self._lock:
                if self._active_job and self._active_job.job_id == job_id:
                    self._active_job.result = result
                    self._active_job.status = "completed"
                    self._active_job.completed_at = time.time()

            self._emit(
                "transcription.job_state",
                {
                    "job_id": job_id,
                    "status": "completed",
                    "result": result.to_dict(),
                },
            )
        except BackendError as exc:
            with self._lock:
                if self._active_job and self._active_job.job_id == job_id:
                    self._active_job.status = "failed"
                    self._active_job.completed_at = time.time()
                    self._active_job.error = exc.to_error_object()

            self._emit(
                "transcription.job_state",
                {
                    "job_id": job_id,
                    "status": "failed",
                    "error": exc.to_error_object(),
                },
            )
        except Exception as exc:
            fallback_error = BackendError(
                code=3002,
                message="Unhandled transcription job exception",
                data={"error": str(exc)},
            )

            with self._lock:
                if self._active_job and self._active_job.job_id == job_id:
                    self._active_job.status = "failed"
                    self._active_job.completed_at = time.time()
                    self._active_job.error = fallback_error.to_error_object()

            self._emit(
                "transcription.job_state",
                {
                    "job_id": job_id,
                    "status": "failed",
                    "error": fallback_error.to_error_object(),
                },
            )

    def _emit(self, event_type: str, payload: dict[str, Any]) -> None:
        self._notify(
            "event",
            {
                "type": event_type,
                "payload": payload,
                "ts": time.time(),
            },
        )
