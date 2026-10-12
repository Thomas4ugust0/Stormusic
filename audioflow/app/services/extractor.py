"""Motor de extração (yt-dlp) isolado atrás da interface AudioSource."""
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import yt_dlp
from yt_dlp.utils import DownloadCancelled

from app.core.config import Settings
from app.core.errors import JobError
from app.core.logging import log
from app.services.error_mapping import map_exception

ProgressCb = Callable[[float], None]  # fração 0..1
CancelCheck = Callable[[], bool]


@dataclass
class VideoInfo:
    id: str
    title: str | None
    uploader: str | None
    upload_date: str | None
    duration: float | None
    thumbnail_url: str | None
    codec: str | None
    bitrate_kbps: float | None
    ext: str | None
    estimated_size_bytes: int | None
    is_live: bool = False
    live_status: str | None = None
    availability: str | None = None
    has_drm: bool = False
    age_limit: int = 0
    raw_formats_count: int = 0
    limitations: list[str] = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "title": self.title, "uploader": self.uploader,
                "duration_seconds": self.duration, "thumbnail_url": self.thumbnail_url}


@dataclass
class DownloadResult:
    audio_path: Path
    thumbnail_path: Path | None
    sponsor_segments_removed: int = 0


class AudioSource(Protocol):
    def inspect(self, url: str) -> VideoInfo: ...

    def download(self, url: str, workdir: Path, *, remove_sponsors: bool, on_progress: ProgressCb,
                 should_cancel: CancelCheck, deadline: float) -> DownloadResult: ...

    def version(self) -> str: ...


def classify(info: VideoInfo, settings: Settings) -> None:
    """Converte metadados em erros estáveis (fora do escopo -> falha clara)."""
    if info.is_live or info.live_status in ("is_live", "is_upcoming", "post_live"):
        raise JobError("live_not_supported")
    av = info.availability
    if av == "private":
        raise JobError("video_private")
    if av in ("premium_only", "subscriber_only"):
        raise JobError("video_members_only")
    if av == "needs_auth" or info.age_limit >= 18:
        raise JobError("video_age_restricted")
    if info.has_drm:
        raise JobError("video_drm_protected")
    if info.duration is not None and info.duration > settings.max_duration_seconds:
        raise JobError("duration_exceeded")
    if info.estimated_size_bytes and info.estimated_size_bytes > settings.max_file_size_bytes:
        raise JobError("file_too_large")


def info_from_ytdlp(d: dict[str, Any]) -> VideoInfo:
    fmts = d.get("formats") or []
    audio = [f for f in fmts if f.get("acodec") not in (None, "none")]
    has_drm = bool(audio) and all(f.get("has_drm") for f in audio)
    size = d.get("filesize") or d.get("filesize_approx")
    abr = d.get("abr") or d.get("tbr")
    if not size and abr and d.get("duration"):
        size = int(abr * 1000 / 8 * d["duration"])
    return VideoInfo(
        id=d.get("id", ""), title=d.get("title"), uploader=d.get("uploader") or d.get("channel") or d.get("artist"),
        upload_date=d.get("upload_date"), duration=d.get("duration"), thumbnail_url=d.get("thumbnail"),
        codec=d.get("acodec"), bitrate_kbps=round(abr, 1) if abr else None, ext=d.get("ext"),
        estimated_size_bytes=int(size) if size else None, is_live=bool(d.get("is_live")),
        live_status=d.get("live_status"), availability=d.get("availability"), has_drm=has_drm,
        age_limit=int(d.get("age_limit") or 0), raw_formats_count=len(fmts),
    )


class YtDlpSource:
    """Implementação concreta. Opções fixas do servidor + ajustes do operador (YTDLP_OPTIONS_JSON)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        try:
            extra = json.loads(settings.ytdlp_options_json or "{}")
        except json.JSONDecodeError:
            log.warning("ytdlp_options_json_invalid")
            extra = {}
        self.operator_opts: dict[str, Any] = extra if isinstance(extra, dict) else {}

    def version(self) -> str:
        return str(yt_dlp.version.__version__)

    def _match_filter(self, info: dict[str, Any], *, incomplete: bool = False) -> str | None:
        if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
            return "live_not_supported"
        dur = info.get("duration")
        if dur and dur > self.settings.max_duration_seconds:
            return "duration_exceeded"
        return None

    def _base_opts(self) -> dict[str, Any]:
        opts: dict[str, Any] = dict(self.operator_opts)  # operador primeiro; servidor sobrescreve
        opts.update({
            "format": "bestaudio/best",
            "noplaylist": True,
            "allowed_extractors": ["youtube"],
            "enable_file_urls": False,
            "socket_timeout": 20,
            "retries": 3,
            "fragment_retries": 3,
            "extractor_retries": 2,
            "max_filesize": self.settings.max_file_size_bytes,
            "match_filter": self._match_filter,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "cachedir": False,
            "logger": _YtLogger(),
            "js_runtimes": {"deno": {"path": self.settings.deno_bin}},
        })
        for unsafe in ("cookiefile", "cookiesfrombrowser", "username", "password", "proxy", "exec", "paths"):
            opts.pop(unsafe, None)
        return opts

    def inspect(self, url: str) -> VideoInfo:
        try:
            with yt_dlp.YoutubeDL(self._base_opts()) as ydl:
                d = ydl.extract_info(url, download=False)
        except Exception as e:  # noqa: BLE001
            raise map_exception(e) from e
        if not d:
            raise JobError("live_not_supported")  # rejeitado pelo match_filter
        return info_from_ytdlp(ydl.sanitize_info(d))

    def search_music(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        """Busca só faixas de música.

        1º: aba "Músicas" do YouTube Music (só lista faixas).
        2º (fallback): busca normal do YouTube, aceitando apenas canais oficiais de música
           ("Artista - Topic", gerados automaticamente pelo YouTube, e canais VEVO).
        Lança RuntimeError com o detalhe real do yt-dlp se ambas falharem.
        """
        from urllib.parse import quote_plus

        errors: list[str] = []
        attempts = [
            (f"https://music.youtube.com/search?q={quote_plus(query)}#songs", False),
            (f"ytsearch{min(limit * 3, 60)}:{query}", True),
        ]
        for url, official_only in attempts:
            opts: dict[str, Any] = dict(self.operator_opts)
            opts.update({
                "extract_flat": "in_playlist", "playlistend": limit * 3, "skip_download": True,
                "socket_timeout": 15, "extractor_retries": 1, "quiet": True, "no_warnings": True,
                "noprogress": True, "cachedir": False, "logger": _YtLogger(),
            })
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    d = ydl.extract_info(url, download=False) or {}
            except Exception as e:  # noqa: BLE001
                log.warning("search_failed", url=url[:80], error=str(e)[:300])
                errors.append(str(e).replace("ERROR: ", "")[:200])
                continue
            out = self._music_entries(d.get("entries") or [], limit, official_only)
            if out:
                return out
        if errors:
            raise RuntimeError(" | ".join(errors))
        return []

    def related_music(self, video_id: str, limit: int = 25) -> list[dict[str, Any]]:
        """Rádio do YouTube Music para a faixa (o mesmo algoritmo do botão "Iniciar rádio").

        1º: rádio do YouTube Music (RDAMVM<id>), que só traz músicas.
        2º (fallback): mix do YouTube (RD<id>), aceitando apenas canais oficiais de música.
        """
        errors: list[str] = []
        attempts = [
            (f"https://music.youtube.com/watch?v={video_id}&list=RDAMVM{video_id}", False),
            (f"https://www.youtube.com/watch?v={video_id}&list=RD{video_id}", True),
        ]
        for url, official_only in attempts:
            opts: dict[str, Any] = dict(self.operator_opts)
            opts.update({
                "extract_flat": "in_playlist", "noplaylist": False, "playlistend": limit * 2, "skip_download": True,
                "socket_timeout": 15, "extractor_retries": 1, "quiet": True, "no_warnings": True,
                "noprogress": True, "cachedir": False, "logger": _YtLogger(),
            })
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    d = ydl.extract_info(url, download=False) or {}
            except Exception as e:  # noqa: BLE001
                log.warning("related_failed", url=url[:90], error=str(e)[:300])
                errors.append(str(e).replace("ERROR: ", "")[:200])
                continue
            entries = [en for en in (d.get("entries") or []) if (en or {}).get("id") != video_id]
            out = self._music_entries(entries, limit, official_only)
            if out:
                return out
        if errors:
            raise RuntimeError(" | ".join(errors))
        return []

    @staticmethod
    def _music_entries(entries: list[Any], limit: int, official_only: bool) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for en in entries:
            en = en or {}
            vid = en.get("id")
            if not isinstance(vid, str) or len(vid) != 11 or vid in seen:
                continue  # descarta playlists/álbuns/artistas
            channel = str(en.get("channel") or en.get("uploader") or "")
            if official_only and not (channel.endswith(" - Topic") or "vevo" in channel.lower()):
                continue
            if en.get("live_status") in ("is_live", "is_upcoming"):
                continue
            seen.add(vid)
            artists = [a for a in (en.get("artists") or []) if isinstance(a, str)]
            artist = ", ".join(artists) if artists else channel.removesuffix(" - Topic").removesuffix("VEVO")
            dur = en.get("duration")
            out.append({"id": vid, "title": str(en.get("title") or ""), "artist": artist,
                        "album": en.get("album") if isinstance(en.get("album"), str) else None,
                        "duration": float(dur) if isinstance(dur, int | float) else None})
            if len(out) >= limit:
                break
        return out

    def download(self, url: str, workdir: Path, *, remove_sponsors: bool, on_progress: ProgressCb,
                 should_cancel: CancelCheck, deadline: float) -> DownloadResult:
        def hook(d: dict[str, Any]) -> None:
            if should_cancel():
                raise DownloadCancelled("cancelled")
            if time.monotonic() > deadline:
                raise JobError("timeout")
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate")
                if total:
                    on_progress(min(1.0, d.get("downloaded_bytes", 0) / total))
            elif d.get("status") == "finished":
                on_progress(1.0)

        opts = self._base_opts() | {
            "outtmpl": {"default": str(workdir / "source.%(ext)s"), "thumbnail": str(workdir / "thumb.%(ext)s")},
            "writethumbnail": True,
            "progress_hooks": [hook],
        }
        removed = 0
        if remove_sponsors:
            cats = self.settings.sponsorblock_categories
            opts["postprocessors"] = [
                {"key": "SponsorBlock", "categories": cats, "when": "after_filter"},
                {"key": "ModifyChapters", "remove_sponsor_segments": cats, "when": "post_process"},
            ]
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if remove_sponsors and info:
                    removed = len([c for c in (info.get("sponsorblock_chapters") or [])
                                   if c.get("category") in self.settings.sponsorblock_categories])
        except JobError:
            raise
        except Exception as e:  # noqa: BLE001
            raise map_exception(e) from e
        if not info:
            raise JobError("live_not_supported")
        audio = [p for p in workdir.glob("source.*") if p.suffix not in (".part", ".ytdl")]
        if not audio:
            raise JobError("internal_error", "download produced no file")
        thumbs = [p for p in workdir.glob("thumb.*") if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
        return DownloadResult(audio[0], thumbs[0] if thumbs else None, removed)


class _YtLogger:
    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        log.warning("ytdlp_warning", detail=msg[:300])

    def error(self, msg: str) -> None:
        log.info("ytdlp_error", detail=msg[:300])
