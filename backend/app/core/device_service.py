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
            import torch
        except Exception as exc:  # pragma: no cover - import failure path
            return DeviceProbeResult(available=False, reason="torch_import_failed", details={"error": str(exc)})

        try:
            if not torch.cuda.is_available():
                return DeviceProbeResult(
                    available=False,
                    reason="cuda_unavailable",
                    details={"torch_cuda_available": False},
                )

            device_name = torch.cuda.get_device_name(0)
            tensor = torch.zeros(1, device="cuda")
            _ = float(tensor.item())
            return DeviceProbeResult(
                available=True,
                reason=None,
                details={"device_name": device_name},
            )
        except Exception as exc:
            return DeviceProbeResult(
                available=False,
                reason="cuda_probe_failed",
                details={"error": str(exc)},
            )

    def _probe_mps(self, os_name: str) -> DeviceProbeResult:
        if os_name != "darwin":
            return DeviceProbeResult(available=False, reason="mps_not_supported_on_platform", details={"os": os_name})

        try:
            import torch
        except Exception as exc:  # pragma: no cover - import failure path
            return DeviceProbeResult(available=False, reason="torch_import_failed", details={"error": str(exc)})

        try:
            mps_backend = getattr(torch.backends, "mps", None)
            if mps_backend is None:
                return DeviceProbeResult(
                    available=False,
                    reason="mps_backend_missing",
                    details={},
                )

            if not torch.backends.mps.is_available():
                return DeviceProbeResult(
                    available=False,
                    reason="mps_unavailable",
                    details={"mps_built": bool(torch.backends.mps.is_built())},
                )

            tensor = torch.zeros(1, device="mps")
            _ = float(tensor.cpu().item())
            return DeviceProbeResult(
                available=True,
                reason=None,
                details={"mps_built": bool(torch.backends.mps.is_built())},
            )
        except Exception as exc:
            return DeviceProbeResult(
                available=False,
                reason="mps_probe_failed",
                details={"error": str(exc)},
            )

    def _probe_cpu(self) -> DeviceProbeResult:
        try:
            import torch

            tensor = torch.zeros(1, device="cpu")
            _ = float(tensor.item())
            return DeviceProbeResult(available=True, reason=None, details={})
        except Exception as exc:
            return DeviceProbeResult(
                available=False,
                reason="cpu_probe_failed",
                details={"error": str(exc)},
            )
