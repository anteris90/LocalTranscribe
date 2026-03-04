from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .device_service import DeviceCapabilities, DeviceService
from .errors import BackendError
from .path_service import PathService, RuntimePaths


@dataclass(frozen=True, slots=True)
class RuntimeContext:
    paths: RuntimePaths
    capabilities: DeviceCapabilities

    def to_dict(self) -> dict[str, Any]:
        return {
            "paths": {
                "app_root": str(self.paths.app_root),
                "models_dir": str(self.paths.models_dir),
                "ffmpeg_dir": str(self.paths.ffmpeg_dir),
                "data_dir": str(self.paths.data_dir),
            },
            "capabilities": self.capabilities.to_dict(),
        }


class StartupValidator:
    def __init__(self, path_service: PathService, device_service: DeviceService) -> None:
        self._path_service = path_service
        self._device_service = device_service

    def validate(self) -> RuntimeContext:
        paths = self._path_service.from_environment()
        capabilities = self._device_service.probe_capabilities()

        if not capabilities.cpu.available:
            raise BackendError(
                code=1101,
                message="CPU device probe failed; backend cannot continue",
                data=capabilities.to_dict(),
            )

        return RuntimeContext(paths=paths, capabilities=capabilities)
