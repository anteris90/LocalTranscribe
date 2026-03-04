from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .errors import BackendError

_REQUIRED_ENV_VARS = (
    "LT_APP_ROOT",
    "LT_MODELS_DIR",
    "LT_FFMPEG_DIR",
    "LT_DATA_DIR",
)


@dataclass(frozen=True, slots=True)
class RuntimePaths:
    app_root: Path
    models_dir: Path
    ffmpeg_dir: Path
    data_dir: Path


class PathService:
    @staticmethod
    def from_environment(environment: dict[str, str] | None = None) -> RuntimePaths:
        source = environment if environment is not None else os.environ

        raw_values: dict[str, str] = {}
        missing = [name for name in _REQUIRED_ENV_VARS if not source.get(name)]
        if missing:
            raise BackendError(
                code=1001,
                message="Missing required runtime path environment variables",
                data={"missing": missing},
            )

        for key in _REQUIRED_ENV_VARS:
            raw_values[key] = source[key]

        runtime_paths = RuntimePaths(
            app_root=PathService._absolute_existing_dir(raw_values["LT_APP_ROOT"], "LT_APP_ROOT"),
            models_dir=PathService._absolute_existing_dir(raw_values["LT_MODELS_DIR"], "LT_MODELS_DIR"),
            ffmpeg_dir=PathService._absolute_existing_dir(raw_values["LT_FFMPEG_DIR"], "LT_FFMPEG_DIR"),
            data_dir=PathService._absolute_dir_allow_create(raw_values["LT_DATA_DIR"], "LT_DATA_DIR"),
        )
        return runtime_paths

    @staticmethod
    def _absolute_existing_dir(raw_value: str, env_name: str) -> Path:
        path = Path(raw_value).expanduser().resolve(strict=False)
        if not path.is_absolute():
            raise BackendError(
                code=1002,
                message=f"Runtime path must be absolute: {env_name}",
                data={"env": env_name, "value": raw_value},
            )
        if not path.exists() or not path.is_dir():
            raise BackendError(
                code=1003,
                message=f"Runtime directory does not exist: {env_name}",
                data={"env": env_name, "resolved": str(path)},
            )
        return path

    @staticmethod
    def _absolute_dir_allow_create(raw_value: str, env_name: str) -> Path:
        path = Path(raw_value).expanduser().resolve(strict=False)
        if not path.is_absolute():
            raise BackendError(
                code=1002,
                message=f"Runtime path must be absolute: {env_name}",
                data={"env": env_name, "value": raw_value},
            )
        path.mkdir(parents=True, exist_ok=True)
        if not path.is_dir():
            raise BackendError(
                code=1004,
                message=f"Unable to initialize runtime data directory: {env_name}",
                data={"env": env_name, "resolved": str(path)},
            )
        return path
