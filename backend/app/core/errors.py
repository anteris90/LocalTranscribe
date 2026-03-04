from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class BackendError(Exception):
    code: int
    message: str
    data: dict[str, Any] | None = None

    def to_error_object(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
        }
        if self.data is not None:
            payload["data"] = self.data
        return payload
