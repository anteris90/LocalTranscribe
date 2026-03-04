from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from app.core.errors import BackendError

_ALLOWED_MODELS = {"small", "medium", "large-v3"}
_MODEL_REPOS = {
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large-v3": "Systran/faster-whisper-large-v3",
}


class ModelService:
    def __init__(self, models_dir: Path) -> None:
        self._models_dir = models_dir

    def validate_model_name(self, model_name: str) -> str:
        normalized = model_name.strip()
        if normalized not in _ALLOWED_MODELS:
            raise BackendError(
                code=2001,
                message="Unsupported model",
                data={"model": model_name, "allowed": sorted(_ALLOWED_MODELS)},
            )
        return normalized

    def resolve_model_path(self, model_name: str) -> Path:
        normalized = self.validate_model_name(model_name)
        model_path = (self._models_dir / normalized).resolve(strict=False)

        if not model_path.exists() or not model_path.is_dir():
            raise BackendError(
                code=2002,
                message="Model directory not found in local models path",
                data={"model": normalized, "path": str(model_path)},
            )

        marker_files = ["model.bin", "config.json"]
        missing_markers = [name for name in marker_files if not (model_path / name).exists()]
        if missing_markers:
            raise BackendError(
                code=2003,
                message="Model directory is incomplete",
                data={"model": normalized, "path": str(model_path), "missing": missing_markers},
            )

        return model_path

    def ensure_model_available(
        self,
        model_name: str,
        allow_download: bool,
        force_download: bool = False,
        notify_download: Callable[[dict[str, Any]], None] | None = None,
    ) -> Path:
        normalized = self.validate_model_name(model_name)
        model_path = (self._models_dir / normalized).resolve(strict=False)

        if self._is_model_complete(model_path) and not force_download:
            return model_path

        if not allow_download:
            raise BackendError(
                code=3101,
                message=f"Preflight failed: local model directory is missing for '{normalized}'",
                data={
                    "model": normalized,
                    "expected_path": str(model_path),
                    "allow_model_download": True,
                },
            )

        self._download_model(normalized, model_path, notify_download=notify_download)

        if not self._is_model_complete(model_path):
            raise BackendError(
                code=3102,
                message=f"Model download completed but model '{normalized}' is incomplete",
                data={
                    "model": normalized,
                    "expected_path": str(model_path),
                    "missing": self._missing_markers(model_path),
                },
            )

        return model_path

    def check_model_update(self, model_name: str) -> dict[str, Any]:
        normalized = self.validate_model_name(model_name)
        model_path = (self._models_dir / normalized).resolve(strict=False)

        installed = self._is_model_complete(model_path)
        metadata = self._read_model_metadata(model_path)
        local_revision = metadata.get("revision") if isinstance(metadata.get("revision"), str) else None
        repo_id = _MODEL_REPOS[normalized]

        remote_revision: str | None = None
        check_error: str | None = None

        try:
            from huggingface_hub import HfApi

            remote_revision = HfApi().model_info(repo_id=repo_id).sha
        except Exception as exc:
            check_error = str(exc)

        update_available = bool(
            installed
            and local_revision
            and remote_revision
            and local_revision != remote_revision
        )

        return {
            "resource": "model",
            "model": normalized,
            "installed": installed,
            "repo": repo_id,
            "local_revision": local_revision,
            "remote_revision": remote_revision,
            "update_available": update_available,
            "check_error": check_error,
        }

    def _download_model(
        self,
        model_name: str,
        model_path: Path,
        notify_download: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        repo_id = _MODEL_REPOS[model_name]
        remote_revision: str | None = None
        self._emit_download(
            notify_download,
            {
                "resource": "model",
                "model": model_name,
                "status": "started",
                "stage": "preparing",
                "percent": 1,
                "message": f"Preparing model download: {model_name}",
            },
        )
        try:
            from huggingface_hub import snapshot_download

            try:
                from huggingface_hub import HfApi

                remote_revision = HfApi().model_info(repo_id=repo_id).sha
            except Exception:
                remote_revision = None
        except Exception as exc:
            self._emit_download(
                notify_download,
                {
                    "resource": "model",
                    "model": model_name,
                    "status": "failed",
                    "stage": "failed",
                    "message": f"Model download failed to initialize: {exc}",
                },
            )
            raise BackendError(
                code=3201,
                message="Unable to import huggingface_hub for model download",
                data={"error": str(exc)},
            ) from exc

        try:
            model_path.parent.mkdir(parents=True, exist_ok=True)
            self._emit_download(
                notify_download,
                {
                    "resource": "model",
                    "model": model_name,
                    "status": "progress",
                    "stage": "downloading",
                    "percent": 10,
                    "message": f"Downloading model files from {repo_id}",
                },
            )
            snapshot_download(
                repo_id=repo_id,
                local_dir=str(model_path),
                resume_download=True,
            )
            self._emit_download(
                notify_download,
                {
                    "resource": "model",
                    "model": model_name,
                    "status": "progress",
                    "stage": "verifying",
                    "percent": 95,
                    "message": f"Verifying downloaded model: {model_name}",
                },
            )
        except Exception as exc:
            self._emit_download(
                notify_download,
                {
                    "resource": "model",
                    "model": model_name,
                    "status": "failed",
                    "stage": "failed",
                    "message": f"Model download failed: {exc}",
                },
            )
            raise BackendError(
                code=3202,
                message=f"Model download failed for '{model_name}'",
                data={"repo": repo_id, "error": str(exc)},
            ) from exc

        self._emit_download(
            notify_download,
            {
                "resource": "model",
                "model": model_name,
                "status": "completed",
                "stage": "completed",
                "percent": 100,
                "message": f"Model download completed: {model_name}",
            },
        )
        self._write_model_metadata(
            model_path,
            {
                "model": model_name,
                "repo": repo_id,
                "revision": remote_revision,
                "downloaded_at": int(time.time()),
            },
        )

    def _is_model_complete(self, model_path: Path) -> bool:
        return model_path.exists() and model_path.is_dir() and len(self._missing_markers(model_path)) == 0

    def _missing_markers(self, model_path: Path) -> list[str]:
        marker_files = ["model.bin", "config.json"]
        return [name for name in marker_files if not (model_path / name).exists()]

    def _emit_download(
        self,
        notify_download: Callable[[dict[str, Any]], None] | None,
        payload: dict[str, Any],
    ) -> None:
        if notify_download is None:
            return
        notify_download(payload)

    def _metadata_file_path(self, model_path: Path) -> Path:
        return model_path / ".localtranscribe-meta.json"

    def _read_model_metadata(self, model_path: Path) -> dict[str, Any]:
        metadata_path = self._metadata_file_path(model_path)
        if not metadata_path.exists():
            return {}

        try:
            data = json.loads(metadata_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

        if not isinstance(data, dict):
            return {}
        return data

    def _write_model_metadata(self, model_path: Path, metadata: dict[str, Any]) -> None:
        try:
            model_path.mkdir(parents=True, exist_ok=True)
            metadata_path = self._metadata_file_path(model_path)
            metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            return

    def load_model(self, model_name: str, device: str, compute_type: str):
        model_path = self.resolve_model_path(model_name)

        try:
            from faster_whisper import WhisperModel
        except Exception as exc:  # pragma: no cover - import failure path
            raise BackendError(
                code=2004,
                message="Unable to import faster-whisper",
                data={"error": str(exc)},
            ) from exc

        try:
            return WhisperModel(
                str(model_path),
                device=device,
                compute_type=compute_type,
                download_root=str(self._models_dir),
                local_files_only=True,
            )
        except TypeError as exc:
            raise BackendError(
                code=2005,
                message="Installed faster-whisper does not support local_files_only",
                data={"error": str(exc)},
            ) from exc
        except Exception as exc:
            raise BackendError(
                code=2006,
                message="Failed to initialize local model",
                data={
                    "model": model_name,
                    "device": device,
                    "compute_type": compute_type,
                    "error": str(exc),
                },
            ) from exc
