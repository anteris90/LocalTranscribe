from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable

from app.core.errors import BackendError


class PreflightService:
    def __init__(self, models_dir: Path, ffmpeg_dir: Path) -> None:
        self._models_dir = models_dir
        self._ffmpeg_dir = ffmpeg_dir

    def ensure_ffmpeg_available(
        self,
        allow_download: bool,
        force_download: bool = False,
        notify_download: Callable[[dict[str, Any]], None] | None = None,
    ) -> Path:
        ffmpeg_path = self._resolve_ffmpeg_path()
        if ffmpeg_path.exists() and ffmpeg_path.is_file() and not force_download:
            self._inject_ffmpeg_env(ffmpeg_path)
            return ffmpeg_path

        if not allow_download:
            raise BackendError(
                code=3103,
                message="Preflight failed: ffmpeg binary is missing",
                data={
                    "expected_path": str(ffmpeg_path),
                    "allow_ffmpeg_download": True,
                },
            )

        self._download_ffmpeg(notify_download=notify_download)

        ffmpeg_path = self._resolve_ffmpeg_path()
        if not ffmpeg_path.exists() or not ffmpeg_path.is_file():
            raise BackendError(
                code=3204,
                message="FFmpeg download completed but binary is still missing",
                data={"expected_path": str(ffmpeg_path)},
            )
        self._inject_ffmpeg_env(ffmpeg_path)
        return ffmpeg_path

    def _inject_ffmpeg_env(self, ffmpeg_path: Path) -> None:
        ffmpeg_dir = str(ffmpeg_path.parent)
        current_path = os.environ.get("PATH", "")
        parts = [p for p in current_path.split(os.pathsep) if p]
        if ffmpeg_dir not in parts:
            os.environ["PATH"] = ffmpeg_dir + (os.pathsep + current_path if current_path else "")

        os.environ.setdefault("FFMPEG_BINARY", str(ffmpeg_path))

        ffprobe_name = "ffprobe.exe" if platform.system().lower() == "windows" else "ffprobe"
        ffprobe_path = (ffmpeg_path.parent / ffprobe_name).resolve(strict=False)
        if ffprobe_path.exists() and ffprobe_path.is_file():
            os.environ.setdefault("FFPROBE_BINARY", str(ffprobe_path))

    def check_ffmpeg_update(self) -> dict[str, Any]:
        ffmpeg_path = self._resolve_ffmpeg_path()
        installed = ffmpeg_path.exists() and ffmpeg_path.is_file()
        local_version = self._read_local_ffmpeg_version(ffmpeg_path) if installed else None
        remote_version, check_error = self._read_remote_ffmpeg_version()

        update_available = bool(
            installed
            and local_version
            and remote_version
            and remote_version not in local_version
        )

        return {
            "resource": "ffmpeg",
            "installed": installed,
            "path": str(ffmpeg_path),
            "local_version": local_version,
            "remote_version": remote_version,
            "update_available": update_available,
            "check_error": check_error,
        }

    def _resolve_ffmpeg_path(self) -> Path:
        ffmpeg_name = "ffmpeg.exe" if platform.system().lower() == "windows" else "ffmpeg"
        return (self._ffmpeg_dir / ffmpeg_name).resolve(strict=False)

    def _download_ffmpeg(self, notify_download: Callable[[dict[str, Any]], None] | None = None) -> None:
        system_name = platform.system().lower()
        if system_name != "windows":
            raise BackendError(
                code=3203,
                message="Automatic ffmpeg download is currently implemented for Windows only",
                data={"platform": system_name},
            )

        download_url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
        remote_version, _ = self._read_remote_ffmpeg_version()
        self._emit_download(
            notify_download,
            {
                "resource": "ffmpeg",
                "status": "started",
                "stage": "preparing",
                "percent": 1,
                "message": "Preparing ffmpeg download",
            },
        )

        try:
            self._ffmpeg_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="localtranscribe-ffmpeg-") as temp_dir:
                zip_path = Path(temp_dir) / "ffmpeg-release-essentials.zip"

                last_percent = -1

                def _report_hook(blocks: int, block_size: int, total_size: int) -> None:
                    nonlocal last_percent
                    if total_size <= 0:
                        percent = min(90, max(5, blocks // 10))
                    else:
                        downloaded = blocks * block_size
                        percent = min(90, max(1, int((downloaded / total_size) * 90)))
                    if percent == last_percent:
                        return
                    last_percent = percent
                    self._emit_download(
                        notify_download,
                        {
                            "resource": "ffmpeg",
                            "status": "progress",
                            "stage": "downloading",
                            "percent": percent,
                            "message": f"Downloading ffmpeg package ({percent}%)",
                        },
                    )

                urllib.request.urlretrieve(download_url, zip_path, reporthook=_report_hook)

                extract_dir = Path(temp_dir) / "extract"
                extract_dir.mkdir(parents=True, exist_ok=True)
                self._emit_download(
                    notify_download,
                    {
                        "resource": "ffmpeg",
                        "status": "progress",
                        "stage": "extracting",
                        "percent": 92,
                        "message": "Extracting ffmpeg package",
                    },
                )
                with zipfile.ZipFile(zip_path, "r") as zip_file:
                    zip_file.extractall(extract_dir)

                ffmpeg_src = self._find_file(extract_dir, "ffmpeg.exe")
                ffprobe_src = self._find_file(extract_dir, "ffprobe.exe")

                shutil.copy2(ffmpeg_src, self._ffmpeg_dir / "ffmpeg.exe")
                shutil.copy2(ffprobe_src, self._ffmpeg_dir / "ffprobe.exe")
                self._write_ffmpeg_metadata(
                    {
                        "source_url": download_url,
                        "remote_version": remote_version,
                        "downloaded_at": int(time.time()),
                    }
                )

                self._emit_download(
                    notify_download,
                    {
                        "resource": "ffmpeg",
                        "status": "completed",
                        "stage": "completed",
                        "percent": 100,
                        "message": "ffmpeg download completed",
                    },
                )
        except BackendError:
            raise
        except Exception as exc:
            self._emit_download(
                notify_download,
                {
                    "resource": "ffmpeg",
                    "status": "failed",
                    "stage": "failed",
                    "message": f"ffmpeg download failed: {exc}",
                },
            )
            raise BackendError(
                code=3205,
                message="Automatic ffmpeg download failed",
                data={
                    "url": download_url,
                    "error": str(exc),
                },
            ) from exc

    def _find_file(self, root: Path, file_name: str) -> Path:
        match = next(root.rglob(file_name), None)
        if match is None:
            raise BackendError(
                code=3206,
                message=f"Downloaded ffmpeg package missing {file_name}",
                data={"search_root": str(root)},
            )
        return match

    def _emit_download(
        self,
        notify_download: Callable[[dict[str, Any]], None] | None,
        payload: dict[str, Any],
    ) -> None:
        if notify_download is None:
            return
        notify_download(payload)

    def _read_local_ffmpeg_version(self, ffmpeg_path: Path) -> str | None:
        try:
            completed = subprocess.run(
                [str(ffmpeg_path), "-version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=6,
            )
            first_line = completed.stdout.splitlines()[0] if completed.stdout else ""
            first_line = first_line.strip()
            return first_line or None
        except Exception:
            return None

    def _read_remote_ffmpeg_version(self) -> tuple[str | None, str | None]:
        url = "https://www.gyan.dev/ffmpeg/builds/release-version"
        try:
            with urllib.request.urlopen(url, timeout=6) as response:
                text = response.read().decode("utf-8", errors="replace").strip()
            if not text:
                return None, "Empty remote version response"
            return text, None
        except Exception as exc:
            return None, str(exc)

    def _metadata_file_path(self) -> Path:
        return self._ffmpeg_dir / ".localtranscribe-meta.json"

    def _write_ffmpeg_metadata(self, metadata: dict[str, Any]) -> None:
        try:
            self._ffmpeg_dir.mkdir(parents=True, exist_ok=True)
            self._metadata_file_path().write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            return
