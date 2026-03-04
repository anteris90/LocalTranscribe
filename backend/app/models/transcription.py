from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class TranscriptionRequest:
    file_path: str
    model_name: str
    language: str
    requested_device: str
    allow_model_download: bool = False
    allow_ffmpeg_download: bool = False


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    start: float
    end: float
    text: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "text": self.text,
        }


@dataclass(frozen=True, slots=True)
class AttemptResult:
    device: str
    compute_type: str


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    text: str
    segments: list[TranscriptSegment]
    effective_device: str
    effective_compute_type: str
    attempts: list[AttemptResult]

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "segments": [segment.to_dict() for segment in self.segments],
            "effective_device": self.effective_device,
            "effective_compute_type": self.effective_compute_type,
            "attempts": [
                {"device": attempt.device, "compute_type": attempt.compute_type}
                for attempt in self.attempts
            ],
        }
