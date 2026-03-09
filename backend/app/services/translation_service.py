from __future__ import annotations

import json
import os
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Any, Callable

import requests as _requests

from app.core.errors import BackendError
from app.models.transcription import TranscriptSegment

ProgressEmitter = Callable[[str, dict[str, Any]], None]

# Public argostranslate package index — fetched directly so we control the timeout.
_PACKAGE_INDEX_URL = "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json"


def _packages_dir() -> Path:
    """Return the argostranslate packages directory, creating it if needed.

    Mirrors argostranslate.settings.package_dirs[0] without importing argostranslate
    (which chains through spacy → pydantic v1, broken on Python 3.14).
    """
    p = Path.home() / ".local" / "share" / "argos-translate" / "packages"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _find_package_dir(from_code: str, to_code: str) -> Path | None:
    """Scan the packages dir for an extracted package matching from/to language codes."""
    try:
        candidates = list(_packages_dir().iterdir())
    except OSError:
        return None
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        meta_path = candidate / "metadata.json"
        if not meta_path.is_file():
            continue
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            continue
        if meta.get("from_code") == from_code and meta.get("to_code") == to_code:
            return candidate
    return None


def _install_from_path(path: str | Path) -> None:
    """Extract an .argosmodel zip directly into the packages dir.

    Avoids calling argostranslate.package.install_from_path which lazily imports
    argostranslate.translate → argostranslate.sbd → spacy, which is broken on
    Python 3.14 due to a pydantic v1 incompatibility.
    """
    with zipfile.ZipFile(path) as zf:
        meta_entry = next(
            (n for n in zf.namelist() if n.endswith("/metadata.json")),
            None,
        )
        if meta_entry is None:
            raise BackendError(
                code=2408,
                message="Invalid .argosmodel: no metadata.json found inside archive",
                data={"path": str(path)},
            )
        zf.extractall(_packages_dir())


class _Translator:
    """Direct ctranslate2 translator for a single language pair.

    Mirrors the tokenization logic from argostranslate.package.Package and
    argostranslate.translate.apply_packaged_translation, but avoids importing
    argostranslate.translate / argostranslate.sbd / spacy (broken on Python 3.14
    due to pydantic v1 incompatibility).

    Supports both tokenizer types used by argostranslate packages:
    - SentencePiece (sentencepiece.model file present)
    - Moses BPE    (bpe.model file present — used by most OPUS-MT based packages)
    """

    def __init__(self, pkg_dir: Path) -> None:
        # argostranslate.tokenizer only imports sentencepiece at module level; the
        # sacremoses/apply_bpe imports are lazy, so this is safe on Python 3.14.
        from argostranslate.tokenizer import BPETokenizer, SentencePieceTokenizer  # type: ignore
        import ctranslate2  # type: ignore

        sp_path = pkg_dir / "sentencepiece.model"
        bpe_path = pkg_dir / "bpe.model"

        meta_path = pkg_dir / "metadata.json"
        meta: dict = {}
        if meta_path.is_file():
            meta = json.loads(meta_path.read_text())

        from_code: str = meta.get("from_code", "en")
        to_code: str = meta.get("to_code", "")
        self._target_prefix: str = meta.get("target_prefix", "")

        if sp_path.is_file():
            self._tokenizer = SentencePieceTokenizer(sp_path)
        elif bpe_path.is_file():
            self._tokenizer = BPETokenizer(bpe_path, from_code, to_code)
        else:
            raise BackendError(
                code=2409,
                message=f"Translation package at {pkg_dir} has no recognised tokenizer model",
                data={"pkg_dir": str(pkg_dir)},
            )

        self._ct = ctranslate2.Translator(str(pkg_dir / "model"), device="cpu")

    def translate(self, text: str) -> str:
        tokens: list[str] = self._tokenizer.encode(text)
        target_prefix = [[self._target_prefix]] if self._target_prefix else None
        result = self._ct.translate_batch(
            [tokens],
            target_prefix=target_prefix,
            beam_size=2,
            replace_unknowns=True,
        )
        output_tokens: list[str] = result[0].hypotheses[0]
        translated = self._tokenizer.decode(output_tokens)
        # Strip the target prefix from the output if it was prepended.
        if self._target_prefix and translated.startswith(self._target_prefix):
            translated = translated[len(self._target_prefix):]
        return translated.lstrip()


class TranslationService:
    """Offline machine translation using argostranslate language packs."""

    def __init__(self) -> None:
        # Cache loaded translator instances so we only load the model once.
        self._translators: dict[tuple[str, str], _Translator] = {}

    def is_package_installed(self, from_code: str, to_code: str) -> bool:
        """Return True if the argostranslate language pack is already installed."""
        return _find_package_dir(from_code, to_code) is not None

    def list_installed_packages(self) -> list[dict[str, str]]:
        """Return all installed translation packages as a list of {from_code, to_code} dicts."""
        result: list[dict[str, str]] = []
        try:
            for candidate in _packages_dir().iterdir():
                if not candidate.is_dir():
                    continue
                meta_path = candidate / "metadata.json"
                if not meta_path.is_file():
                    continue
                try:
                    meta = json.loads(meta_path.read_text())
                except Exception:
                    continue
                fc = meta.get("from_code")
                tc = meta.get("to_code")
                if isinstance(fc, str) and isinstance(tc, str):
                    result.append({"from_code": fc, "to_code": tc})
        except OSError:
            pass
        return result

    def install_package(
        self,
        from_code: str,
        to_code: str,
        emit_event: ProgressEmitter,
    ) -> None:
        """Download and install the argostranslate language pack for from_code → to_code."""
        emit_event(
            "resource.download",
            {
                "status": "started",
                "stage": "translation_model",
                "message": f"Fetching translation package index ({from_code} \u2192 {to_code})...",
                "percent": 0,
            },
        )
        try:
            # Fetch the package index ourselves with an explicit timeout so we
            # never hang the caller's thread indefinitely.
            try:
                index_resp = _requests.get(_PACKAGE_INDEX_URL, timeout=20)
                index_resp.raise_for_status()
                index_data: list[dict] = index_resp.json()
            except Exception as index_exc:
                raise BackendError(
                    code=2406,
                    message=f"Failed to fetch translation package index: {index_exc}",
                    data={"error": str(index_exc)},
                ) from index_exc

            emit_event(
                "resource.download",
                {
                    "status": "progress",
                    "stage": "translation_model",
                    "message": f"Locating package ({from_code} \u2192 {to_code})...",
                    "percent": 5,
                },
            )

            pkg_info = next(
                (
                    p for p in index_data
                    if p.get("from_code") == from_code and p.get("to_code") == to_code
                ),
                None,
            )
            if pkg_info is None:
                raise BackendError(
                    code=2402,
                    message=f"No translation package available for {from_code} \u2192 {to_code}",
                    data={"from_code": from_code, "to_code": to_code},
                )

            links: list[str] = pkg_info.get("links") or []
            if not links:
                raise BackendError(
                    code=2407,
                    message=f"Translation package for {from_code} \u2192 {to_code} has no download links",
                    data={"from_code": from_code, "to_code": to_code},
                )
            download_url = links[0]
            path = self._download_with_progress(
                url=download_url,
                from_code=from_code,
                to_code=to_code,
                emit_event=emit_event,
                start_percent=10,
                end_percent=90,
            )

            emit_event(
                "resource.download",
                {
                    "status": "progress",
                    "stage": "translation_model",
                    "message": f"Installing translation package ({from_code} \u2192 {to_code})...",
                    "percent": 95,
                },
            )
            _install_from_path(path)
            # Clean up the temporary download file.
            try:
                os.unlink(path)
            except OSError:
                pass
        except BackendError:
            emit_event(
                "resource.download",
                {
                    "status": "failed",
                    "stage": "translation_model",
                    "message": f"Failed to install translation package ({from_code} \u2192 {to_code})",
                },
            )
            raise
        except Exception as exc:
            emit_event(
                "resource.download",
                {
                    "status": "failed",
                    "stage": "translation_model",
                    "message": str(exc),
                },
            )
            raise BackendError(
                code=2404,
                message=f"Failed to install translation package ({from_code} \u2192 {to_code}): {exc}",
                data={"error": str(exc), "from_code": from_code, "to_code": to_code},
            ) from exc

        emit_event(
            "resource.download",
            {
                "status": "completed",
                "stage": "translation_model",
                "message": f"Translation package installed ({from_code} \u2192 {to_code})",
                "percent": 100,
            },
        )

    def _download_with_progress(
        self,
        url: str,
        from_code: str,
        to_code: str,
        emit_event: ProgressEmitter,
        start_percent: int,
        end_percent: int,
    ) -> str:
        """Stream-download a URL to a temp file, emitting progress events every 2%."""
        with _requests.get(url, stream=True, timeout=30) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            suffix = Path(url).suffix or ".argosmodel"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            downloaded = 0
            last_emitted_bucket = -1
            range_size = end_percent - start_percent
            try:
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        tmp.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            raw_pct = downloaded / total
                            pct = int(start_percent + raw_pct * range_size)
                            # Emit at every 2% step to avoid flooding the channel.
                            bucket = pct - (pct % 2)
                            if bucket > last_emitted_bucket:
                                last_emitted_bucket = bucket
                                mb_done = downloaded / (1024 * 1024)
                                mb_total = total / (1024 * 1024)
                                emit_event(
                                    "resource.download",
                                    {
                                        "status": "progress",
                                        "stage": "translation_model",
                                        "message": (
                                            f"Downloading ({from_code} \u2192 {to_code})"
                                            f" {mb_done:.1f} / {mb_total:.1f} MB"
                                        ),
                                        "percent": pct,
                                    },
                                )
            finally:
                tmp.flush()
                tmp.close()
        return tmp.name

    def ensure_package(
        self,
        from_code: str,
        to_code: str,
        allow_download: bool,
        emit_event: ProgressEmitter,
    ) -> None:
        """Ensure the language pack is installed, downloading it if allowed."""
        if self.is_package_installed(from_code, to_code):
            return
        if not allow_download:
            raise BackendError(
                code=2401,
                message=(
                    f"Translation package '{from_code} \u2192 {to_code}' is not installed. "
                    "Allow translation model download to install it."
                ),
                data={"from_code": from_code, "to_code": to_code},
            )
        self.install_package(from_code, to_code, emit_event)

    def translate_segments(
        self,
        segments: list[TranscriptSegment],
        from_code: str,
        to_code: str,
        emit_event: ProgressEmitter,
        cancel_event: threading.Event | None,
    ) -> list[TranscriptSegment]:
        """Translate all segments using direct ctranslate2 + sentencepiece.

        Avoids importing argostranslate.translate / argostranslate.sbd / spacy.
        """
        pkg_dir = _find_package_dir(from_code, to_code)
        if pkg_dir is None:
            raise BackendError(
                code=2401,
                message=f"Translation package '{from_code} \u2192 {to_code}' is not installed.",
                data={"from_code": from_code, "to_code": to_code},
            )

        key = (from_code, to_code)
        if key not in self._translators:
            self._translators[key] = _Translator(pkg_dir)
        translator = self._translators[key]

        # Signal the frontend to clear the transcription text so translated text
        # can be shown incrementally in its place.
        emit_event(
            "transcription.progress",
            {
                "percent": 99,
                "stage": "translating",
                "partial_text": "",
                "reset_text": True,
            },
        )

        translated: list[TranscriptSegment] = []
        for seg in segments:
            if cancel_event is not None and cancel_event.is_set():
                raise BackendError(code=2201, message="Transcription canceled", data=None)

            raw = seg.text.strip()
            if raw:
                try:
                    translated_text = translator.translate(raw)
                except Exception as exc:
                    raise BackendError(
                        code=2405,
                        message=f"Translation failed: {exc}",
                        data={"error": str(exc), "from_code": from_code, "to_code": to_code},
                    ) from exc
            else:
                translated_text = seg.text

            translated.append(TranscriptSegment(start=seg.start, end=seg.end, text=translated_text))
            emit_event(
                "transcription.progress",
                {
                    "percent": 99,
                    "stage": "translating",
                    "partial_text": translated_text,
                },
            )

        return translated
