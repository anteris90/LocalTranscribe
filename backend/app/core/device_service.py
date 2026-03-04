from __future__ import annotations

import platform
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class DeviceProbeResult:
    available: bool
    reason: str | None
    details: dict[str, Any]


@dataclass(frozen=True, slots=True)
class DeviceCapabilities:
    os_name: str
    cuda: DeviceProbeResult
    mps: DeviceProbeResult
    cpu: DeviceProbeResult

    def to_dict(self) -> dict[str, Any]:
        return {
            "os": self.os_name,
            "cuda": {
                "available": self.cuda.available,
                "reason": self.cuda.reason,
                "details": self.cuda.details,
            },
            "mps": {
                "available": self.mps.available,
                "reason": self.mps.reason,
                "details": self.mps.details,
            },
            "cpu": {
                "available": self.cpu.available,
                "reason": self.cpu.reason,
                "details": self.cpu.details,
            },
        }


class DeviceService:
    def probe_capabilities(self) -> DeviceCapabilities:
        os_name = platform.system().lower()
        cuda_probe = self._probe_cuda(os_name)
        mps_probe = self._probe_mps(os_name)
        cpu_probe = self._probe_cpu()

        return DeviceCapabilities(
            os_name=os_name,
            cuda=cuda_probe,
            mps=mps_probe,
            cpu=cpu_probe,
        )

    def _probe_cuda(self, os_name: str) -> DeviceProbeResult:
        if os_name != "windows":
            return DeviceProbeResult(available=False, reason="cuda_not_supported_on_platform", details={"os": os_name})

        try:
            import ctranslate2
        except Exception as exc:  # pragma: no cover - import failure path
            return DeviceProbeResult(available=False, reason="ctranslate2_import_failed", details={"error": str(exc)})

        try:
            get_device_count = getattr(ctranslate2, "get_cuda_device_count", None)
            if get_device_count is None:
                return DeviceProbeResult(
                    available=False,
                    reason="cuda_api_missing",
                    details={},
                )

            device_count = int(get_device_count())
            if device_count <= 0:
                return DeviceProbeResult(
                    available=False,
                    reason="cuda_unavailable",
                    details={"device_count": device_count},
                )
            return DeviceProbeResult(
                available=True,
                reason=None,
                details={"device_count": device_count},
            )
        except Exception as exc:
            return DeviceProbeResult(
                available=False,
                reason="cuda_probe_failed",
                details={"error": str(exc)},
            )

    def _probe_mps(self, os_name: str) -> DeviceProbeResult:
        return DeviceProbeResult(
            available=False,
            reason="mps_not_supported",
            details={"os": os_name},
        )

    def _probe_cpu(self) -> DeviceProbeResult:
        try:
            import ctranslate2  # noqa: F401
            return DeviceProbeResult(available=True, reason=None, details={})
        except Exception as exc:
            return DeviceProbeResult(
                available=False,
                reason="cpu_probe_failed",
                details={"error": str(exc)},
            )
