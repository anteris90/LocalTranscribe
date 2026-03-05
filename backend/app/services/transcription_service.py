from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess
from typing import Any, Callable
import threading
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

from app.core.device_service import DeviceCapabilities
from app.core.errors import BackendError
from app.models.transcription import AttemptResult, TranscriptSegment, TranscriptionRequest, TranscriptionResult
from app.services.model_service import ModelService

ProgressEmitter = Callable[[str, dict[str, Any]], None]


@dataclass(frozen=True, slots=True)
class DeviceAttempt:
    device: str
    compute_type: str
    reason: str


class TranscriptionService:
    def __init__(self, model_service: ModelService, capabilities: DeviceCapabilities) -> None:
        self._model_service = model_service
        self._capabilities = capabilities

    def transcribe(
        self,
        request: TranscriptionRequest,
        emit_event: ProgressEmitter,
        cancel_event: threading.Event | None = None,
    ) -> TranscriptionResult:
        self._validate_request(request)

        if cancel_event is not None and cancel_event.is_set():
            raise BackendError(code=2201, message="Transcription canceled", data=None)

        raw_path = request.file_path
        normalized_path = raw_path.strip()
        if (
            (normalized_path.startswith('"') and normalized_path.endswith('"'))
            or (normalized_path.startswith("'") and normalized_path.endswith("'"))
        ):
            normalized_path = normalized_path[1:-1].strip()

        if normalized_path.lower().startswith("file://"):
            parsed = urlparse(normalized_path)
            if parsed.scheme == "file":
                decoded_path = url2pathname(unquote(parsed.path))
                if parsed.netloc:
                    normalized_path = f"\\\\{parsed.netloc}{decoded_path}"
                else:
                    normalized_path = decoded_path

        try:
            file_path = Path(normalized_path).resolve(strict=False)
        except Exception:
            file_path = Path(normalized_path)

        if not file_path.exists() or not file_path.is_file():
            raise BackendError(
                code=2101,
                message=f"Input file not found: {file_path}",
                data={
                    "path": str(file_path),
                    "raw_path": raw_path,
                    "normalized_path": normalized_path,
                },
            )

        emit_event(
            "transcription.progress",
            {
                "percent": 0,
                "stage": "probing_media",
                "partial_text": "",
            },
        )

        # Probe media duration early so we can prefer safer compute types for long files
        media_duration = self._probe_duration_seconds(file_path)
        attempt_plan = self._build_attempt_plan(request.requested_device, media_duration)
        errors: list[dict[str, Any]] = []
        executed_attempts: list[AttemptResult] = []

        if request.requested_device.strip().lower() == "gpu" and attempt_plan[0].device == "cpu":
            emit_event(
                "transcription.downgrade",
                {
                    "from_device": "gpu",
                    "from_compute_type": "float16",
                    "to_device": "cpu",
                    "to_compute_type": "int8",
                    "reason": attempt_plan[0].reason,
                },
            )

        for index, attempt in enumerate(attempt_plan):
            if index > 0:
                previous = attempt_plan[index - 1]
                emit_event(
                    "transcription.downgrade",
                    {
                        "from_device": previous.device,
                        "from_compute_type": previous.compute_type,
                        "to_device": attempt.device,
                        "to_compute_type": attempt.compute_type,
                        "reason": attempt.reason,
                    },
                )

            emit_event(
                "transcription.progress",
                {
                    "percent": 1,
                    "stage": "loading_model",
                    "partial_text": "",
                    "device": attempt.device,
                    "compute_type": attempt.compute_type,
                },
            )

            try:
                model = self._model_service.load_model(
                    model_name=request.model_name,
                    device=attempt.device,
                    compute_type=attempt.compute_type,
                )

                emit_event(
                    "transcription.progress",
                    {
                        "percent": 3,
                        "stage": "starting_transcription",
                        "partial_text": "",
                        "device": attempt.device,
                        "compute_type": attempt.compute_type,
                    },
                )

                result = self._run_transcription(
                    model=model,
                    file_path=file_path,
                    language=request.language,
                    emit_event=emit_event,
                    effective_device=attempt.device,
                    effective_compute_type=attempt.compute_type,
                    prior_attempts=executed_attempts,
                    cancel_event=cancel_event,
                )
                return result
            except BackendError as exc:
                # Cancellation is user-driven; do not treat it as an attempt failure.
                if exc.code == 2201:
                    raise
                errors.append(
                    {
                        "device": attempt.device,
                        "compute_type": attempt.compute_type,
                        "code": exc.code,
                        "message": exc.message,
                        "data": exc.data,
                    }
                )
                executed_attempts.append(AttemptResult(device=attempt.device, compute_type=attempt.compute_type))
                continue
            except Exception as exc:
                errors.append(
                    {
                        "device": attempt.device,
                        "compute_type": attempt.compute_type,
                        "message": str(exc),
                        "type": exc.__class__.__name__,
                    }
                )
                executed_attempts.append(AttemptResult(device=attempt.device, compute_type=attempt.compute_type))
                continue

        raise BackendError(
            code=2102,
            message="All device attempts failed for transcription",
            data={"attempts": errors},
        )

    def _run_transcription(
        self,
        model: Any,
        file_path: Path,
        language: str,
        emit_event: ProgressEmitter,
        effective_device: str,
        effective_compute_type: str,
        prior_attempts: list[AttemptResult],
        cancel_event: threading.Event | None,
    ) -> TranscriptionResult:
        if cancel_event is not None and cancel_event.is_set():
            raise BackendError(code=2201, message="Transcription canceled", data=None)

        emit_event(
            "transcription.progress",
            {
                "percent": 5,
                "stage": "transcribing",
                "partial_text": "",
                "device": effective_device,
                "compute_type": effective_compute_type,
            },
        )

        media_duration = self._probe_duration_seconds(file_path)

        requested = language.strip().lower()
        language_param: str | None
        if requested in {"", "auto"}:
            language_param = None
        else:
            language_param = language

        try:
            transcribe_kwargs: dict[str, Any] = {
                "task": "transcribe",
                "language": language_param,
                # Reduce hallucinations in silence/music and prevent runaway repetition.
                "vad_filter": True,
                "condition_on_previous_text": False,
            }

            segments_iter, info = model.transcribe(str(file_path), **transcribe_kwargs)
        except TypeError:
            # Defensive fallback for older faster-whisper signatures.
            segments_iter, info = model.transcribe(
                str(file_path),
                language=language_param,
                task="transcribe",
            )
        except Exception as exc:
            raise BackendError(
                code=2103,
                message="Model transcription invocation failed",
                data={"error": str(exc)},
            ) from exc

        detected_language = getattr(info, "language", None)
        language_probability = getattr(info, "language_probability", None)
        if isinstance(detected_language, str) and detected_language.strip():
            payload: dict[str, Any] = {"language": detected_language}
            if isinstance(language_probability, (float, int)):
                payload["probability"] = float(language_probability)
            emit_event("transcription.language_detected", payload)
        else:
            detected_language = None
            language_probability = None

        segments: list[TranscriptSegment] = []
        full_text_parts: list[str] = []
        latest_end = 0.0
        emitted_count = 0

        try:
            for raw_segment in segments_iter:
                if cancel_event is not None and cancel_event.is_set():
                    raise BackendError(code=2201, message="Transcription canceled", data=None)

                text = str(getattr(raw_segment, "text", "")).strip()
                start = float(getattr(raw_segment, "start", 0.0))
                end = float(getattr(raw_segment, "end", start))

                segment = TranscriptSegment(start=start, end=end, text=text)
                segments.append(segment)
                if text:
                    full_text_parts.append(text)

                latest_end = max(latest_end, end)
                emitted_count += 1

                percent = self._calculate_percent(media_duration, latest_end, emitted_count)
                emit_event(
                    "transcription.progress",
                    {
                        "percent": percent,
                        "stage": "transcribing",
                        "partial_text": text,
                        "segment": segment.to_dict(),
                        "device": effective_device,
                        "compute_type": effective_compute_type,
                    },
                )
        except BackendError:
            # Preserve specific BackendError codes (especially cancellation).
            raise
        except Exception as exc:
            raise BackendError(
                code=2107,
                message="Model transcription iteration failed",
                data={
                    "error": str(exc),
                    "type": exc.__class__.__name__,
                    "detected_language": detected_language,
                },
            ) from exc

        emit_event(
            "transcription.progress",
            {
                "percent": 98,
                "stage": "finalizing",
                "partial_text": "",
                "device": effective_device,
                "compute_type": effective_compute_type,
            },
        )

        return TranscriptionResult(
            text="\n".join(full_text_parts),
            segments=segments,
            effective_device=effective_device,
            effective_compute_type=effective_compute_type,
            attempts=[*prior_attempts, AttemptResult(device=effective_device, compute_type=effective_compute_type)],
            detected_language=detected_language,
            language_probability=float(language_probability)
            if isinstance(language_probability, (float, int))
            else None,
        )

    def _validate_request(self, request: TranscriptionRequest) -> None:
        if not request.file_path.strip():
            raise BackendError(code=2104, message="file_path is required", data=None)

        # language can be a specific ISO-639-1 code (e.g. "en") or "auto"/"" to enable model detection
        if request.language is None:  # defensive; request.language is declared as str
            raise BackendError(code=2105, message="language is required", data={"field": "language"})

        requested = request.requested_device.strip().lower()
        if requested not in {"auto", "cpu", "gpu"}:
            raise BackendError(
                code=2106,
                message="requested_device must be one of auto/cpu/gpu",
                data={"requested_device": request.requested_device},
            )

    def _build_attempt_plan(self, requested_device: str, media_duration: float | None) -> list[DeviceAttempt]:
        requested = requested_device.strip().lower()

        # Heuristic: for long media files prefer lower-memory compute types first to avoid GPU OOM.
        long_media_threshold_seconds = 20 * 60  # 20 minutes
        prefer_safer_gpu_first = False
        if media_duration is not None and media_duration >= long_media_threshold_seconds:
            prefer_safer_gpu_first = True

        if requested == "cpu":
            return [DeviceAttempt(device="cpu", compute_type="int8", reason="requested_cpu")]

        gpu_primary = self._preferred_gpu_device()
        if requested == "gpu":
            if gpu_primary is None:
                return [DeviceAttempt(device="cpu", compute_type="int8", reason="gpu_unavailable_fallback_to_cpu")]
            if prefer_safer_gpu_first:
                return [
                    DeviceAttempt(device=gpu_primary, compute_type="int8_float16", reason="requested_gpu_safer_compute"),
                    DeviceAttempt(device=gpu_primary, compute_type="float16", reason="retry_with_standard_gpu_compute"),
                    DeviceAttempt(device="cpu", compute_type="int8", reason="fallback_to_cpu_after_gpu_failures"),
                ]
            return [
                DeviceAttempt(device=gpu_primary, compute_type="float16", reason="requested_gpu_primary"),
                DeviceAttempt(device=gpu_primary, compute_type="int8_float16", reason="retry_with_safer_gpu_compute"),
                DeviceAttempt(device="cpu", compute_type="int8", reason="fallback_to_cpu_after_gpu_failures"),
            ]

        if gpu_primary is None:
            return [DeviceAttempt(device="cpu", compute_type="int8", reason="auto_selected_cpu")]

        if prefer_safer_gpu_first:
            return [
                DeviceAttempt(device=gpu_primary, compute_type="int8_float16", reason="auto_selected_gpu_safer_compute"),
                DeviceAttempt(device=gpu_primary, compute_type="float16", reason="retry_with_standard_gpu_compute"),
                DeviceAttempt(device="cpu", compute_type="int8", reason="fallback_to_cpu_after_gpu_failures"),
            ]

        return [
            DeviceAttempt(device=gpu_primary, compute_type="float16", reason="auto_selected_gpu"),
            DeviceAttempt(device=gpu_primary, compute_type="int8_float16", reason="retry_with_safer_gpu_compute"),
            DeviceAttempt(device="cpu", compute_type="int8", reason="fallback_to_cpu_after_gpu_failures"),
        ]

    def _preferred_gpu_device(self) -> str | None:
        if self._capabilities.cuda.available:
            return "cuda"
        if self._capabilities.mps.available:
            return "mps"
        return None

    def _probe_duration_seconds(self, file_path: Path) -> float | None:
        try:
            # Use ffprobe directly with a timeout.
            # Some large/odd containers can cause duration probing to take a very long time;
            # duration is an optional hint only, so we prefer a fast fallback.
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-analyzeduration",
                    "0",
                    "-probesize",
                    "32k",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(file_path),
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode != 0:
                return None

            raw = (result.stdout or "").strip()
            if not raw:
                return None

            duration = float(raw)
            if duration <= 0:
                return None
            return duration
        except Exception:
            return None

    def _calculate_percent(self, duration: float | None, latest_end: float, emitted_count: int) -> int:
        if duration and duration > 0:
            progress_ratio = min(1.0, max(0.0, latest_end / duration))
            return min(95, max(5, int(5 + progress_ratio * 90)))

        heuristic = min(95, 5 + emitted_count)
        return heuristic
