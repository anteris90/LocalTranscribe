from __future__ import annotations

import json
import sys
import threading
from dataclasses import dataclass
from typing import Any, TextIO

from app.core.errors import BackendError

_JSONRPC_VERSION = "2.0"


@dataclass(frozen=True, slots=True)
class JsonRpcRequest:
    request_id: str | int | None
    method: str
    params: dict[str, Any]


class JsonRpcProtocol:
    def __init__(self, input_stream: TextIO | None = None, output_stream: TextIO | None = None) -> None:
        if input_stream is None:
            try:
                # On Windows, the default stdin encoding may be a legacy code page.
                # Our Electron bridge writes UTF-8 JSON over stdin, so force UTF-8
                # here to avoid mojibake in file paths.
                sys.stdin.reconfigure(encoding="utf-8", errors="strict")
            except Exception:
                pass

        if output_stream is None:
            try:
                # We mostly output ASCII-safe JSON (ensure_ascii=True), but keep
                # stdout in UTF-8 to reduce surprises for diagnostics.
                sys.stdout.reconfigure(encoding="utf-8", errors="strict")
            except Exception:
                pass

        self._input = input_stream if input_stream is not None else sys.stdin
        self._output = output_stream if output_stream is not None else sys.stdout
        self._write_lock = threading.Lock()

    def read_request(self) -> JsonRpcRequest | None:
        line = self._input.readline()
        if line == "":
            return None

        payload = self._parse_line(line)
        request_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params", {})

        if not isinstance(method, str) or not method:
            raise BackendError(code=-32600, message="Invalid Request", data={"reason": "method is required"})
        if not isinstance(params, dict):
            raise BackendError(code=-32600, message="Invalid Request", data={"reason": "params must be object"})

        return JsonRpcRequest(request_id=request_id, method=method, params=params)

    def send_result(self, request_id: str | int | None, result: dict[str, Any]) -> None:
        payload = {
            "jsonrpc": _JSONRPC_VERSION,
            "id": request_id,
            "result": result,
        }
        self._write(payload)

    def send_error(self, request_id: str | int | None, error: BackendError) -> None:
        payload = {
            "jsonrpc": _JSONRPC_VERSION,
            "id": request_id,
            "error": error.to_error_object(),
        }
        self._write(payload)

    def send_raw_error(self, request_id: str | int | None, code: int, message: str, data: dict[str, Any] | None = None) -> None:
        error = BackendError(code=code, message=message, data=data)
        self.send_error(request_id=request_id, error=error)

    def send_notification(self, method: str, params: dict[str, Any]) -> None:
        payload = {
            "jsonrpc": _JSONRPC_VERSION,
            "method": method,
            "params": params,
        }
        self._write(payload)

    def _parse_line(self, line: str) -> dict[str, Any]:
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise BackendError(code=-32700, message="Parse error", data={"error": str(exc)}) from exc

        if not isinstance(payload, dict):
            raise BackendError(code=-32600, message="Invalid Request", data={"reason": "payload must be object"})

        version = payload.get("jsonrpc")
        if version != _JSONRPC_VERSION:
            raise BackendError(
                code=-32600,
                message="Invalid Request",
                data={"reason": "jsonrpc must equal 2.0"},
            )

        return payload

    def _write(self, payload: dict[str, Any]) -> None:
        with self._write_lock:
            # Always write ASCII-safe JSON to avoid Windows stdout encoding failures
            # when transcript text contains non-ASCII characters.
            self._output.write(json.dumps(payload, ensure_ascii=True) + "\n")
            self._output.flush()
