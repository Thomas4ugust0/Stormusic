"""Conversão e inspeção com FFmpeg/ffprobe (subprocess sem shell, args gerados pelo servidor)."""
import contextlib
import json
import subprocess
import threading
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.errors import JobError

BITRATES = {
    "mp3": {"low": 96, "medium": 128, "high": 192, "max": 320},
    "m4a": {"low": 96, "medium": 128, "high": 192, "max": 256},
}
MIME = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "flac": "audio/flac",
        "opus": "audio/ogg", "ogg": "audio/ogg", "webm": "audio/webm", "aac": "audio/aac"}


@dataclass
class Metadata:
    title: str | None = None
    artist: str | None = None
    date: str | None = None
    comment: str | None = None


@dataclass
class ConversionPlan:
    ext: str
    args: list[str]
    reencode: bool


def sanitize_tag(v: str | None, limit: int = 300) -> str | None:
    if not v:
        return None
    v = unicodedata.normalize("NFC", v)
    v = "".join(c for c in v if unicodedata.category(c)[0] != "C" or c in "\t")
    return v.strip()[:limit] or None


def probe(path: Path, ffprobe: str = "ffprobe", timeout: int = 30) -> dict[str, Any]:
    try:
        r = subprocess.run(
            [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=timeout, shell=False, check=False,
        )
    except FileNotFoundError as e:
        raise JobError("conversion_failed", "ffprobe not found") from e
    except subprocess.TimeoutExpired as e:
        raise JobError("timeout", "ffprobe timeout") from e
    if r.returncode != 0:
        raise JobError("conversion_failed", r.stderr[-300:])
    data = json.loads(r.stdout or "{}")
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})
    fmt = data.get("format", {})
    br = audio.get("bit_rate") or fmt.get("bit_rate")
    return {
        "codec": audio.get("codec_name"),
        "bitrate_kbps": round(int(br) / 1000, 1) if br else None,
        "duration": float(fmt.get("duration") or audio.get("duration") or 0),
        "tags": {k.lower(): v for k, v in (fmt.get("tags") or {}).items()},
        "format_name": fmt.get("format_name"),
        "sample_rate": audio.get("sample_rate"),
    }


def original_ext(codec: str | None, source_ext: str) -> str:
    c = (codec or "").lower()
    if c == "opus":
        return "opus"
    if c in ("aac", "mp4a") or c.startswith("mp4a"):
        return "m4a"
    if c == "mp3":
        return "mp3"
    if c == "vorbis":
        return "ogg"
    return source_ext.lstrip(".") or "bin"


def plan(fmt: str, quality: str, src_codec: str | None, src_kbps: float | None, source_ext: str,
         has_cover: bool) -> tuple[ConversionPlan, list[str]]:
    """Retorna o plano de conversão e avisos de qualidade."""
    warnings: list[str] = []
    codec = (src_codec or "").lower()
    is_aac = codec in ("aac", "mp4a") or codec.startswith("mp4a")
    cover = ["-map", "1:v", "-c:v", "mjpeg", "-disposition:v", "attached_pic"] if has_cover else []
    if fmt == "mp3":
        kbps = BITRATES["mp3"][quality]
        if src_kbps and kbps > src_kbps:
            warnings.append(f"A qualidade pedida ({kbps} kbps) excede a da fonte (~{src_kbps:.0f} kbps); "
                            "converter para um bitrate maior não melhora o áudio.")
        return ConversionPlan("mp3", ["-map", "0:a", *cover, "-c:a", "libmp3lame", "-b:a", f"{kbps}k",
                                      "-id3v2_version", "3"], True), warnings
    if fmt == "m4a":
        kbps = BITRATES["m4a"][quality]
        if src_kbps and kbps > src_kbps:
            warnings.append(f"A qualidade pedida ({kbps} kbps) excede a da fonte (~{src_kbps:.0f} kbps); "
                            "converter para um bitrate maior não melhora o áudio.")
        if is_aac and (not src_kbps or kbps >= src_kbps):
            warnings.append("Fonte já em AAC: arquivo remuxado sem reencodar (qualidade original preservada).")
            return ConversionPlan("m4a", ["-map", "0:a", *cover, "-c:a", "copy", "-movflags", "+faststart"],
                                  False), warnings
        return ConversionPlan("m4a", ["-map", "0:a", *cover, "-c:a", "aac", "-b:a", f"{kbps}k",
                                      "-movflags", "+faststart"], True), warnings
    if fmt in ("wav", "flac"):
        warnings.append(f"{fmt.upper()} é sem perdas apenas em relação à fonte já comprimida do YouTube; "
                        "o arquivo fica maior sem ganho de qualidade.")
        if fmt == "wav":
            return ConversionPlan("wav", ["-map", "0:a", "-c:a", "pcm_s16le"], True), warnings
        return ConversionPlan("flac", ["-map", "0:a", *cover, "-c:a", "flac"], True), warnings
    ext = original_ext(src_codec, source_ext)
    return ConversionPlan(ext, ["-map", "0:a", "-c:a", "copy"], False), warnings


def convert(src: Path, dst_dir: Path, plan_: ConversionPlan, meta: Metadata, cover: Path | None, *,
            duration: float | None, ffmpeg: str, timeout: float, should_cancel: Callable[[], bool],
            on_progress: Callable[[float], None]) -> Path:
    out = dst_dir / f"output.{plan_.ext}"
    args = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src)]
    if cover is not None:
        args += ["-i", str(cover)]
    args += ["-vn"] if cover is None else []
    args += plan_.args
    for k, v in (("title", meta.title), ("artist", meta.artist), ("date", meta.date), ("comment", meta.comment)):
        sv = sanitize_tag(v)
        if sv:
            args += ["-metadata", f"{k}={sv}"]
    args += ["-progress", "pipe:1", "-nostats", str(out)]
    try:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=False)
    except FileNotFoundError as e:
        raise JobError("conversion_failed", "ffmpeg not found") from e

    def reader() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            if line.startswith("out_time_us=") and duration:
                with contextlib.suppress(ValueError):
                    on_progress(min(1.0, int(line.split("=", 1)[1]) / 1e6 / duration))

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    deadline = time.monotonic() + timeout
    try:
        while proc.poll() is None:
            if should_cancel():
                proc.kill()
                raise JobError("cancelled")
            if time.monotonic() > deadline:
                proc.kill()
                raise JobError("timeout", "ffmpeg timeout")
            time.sleep(0.1)
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        t.join(timeout=2)
    err = proc.stderr.read() if proc.stderr else ""
    if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        raise JobError("conversion_failed", err[-300:])
    on_progress(1.0)
    return out


def prepare_cover(thumb: Path, workdir: Path, ffmpeg: str, timeout: int = 30) -> Path | None:
    out = workdir / "cover.jpg"
    try:
        r = subprocess.run([ffmpeg, "-nostdin", "-loglevel", "error", "-y", "-i", str(thumb), "-frames:v", "1",
                            "-vf", "scale='min(600,iw)':-2", str(out)],
                           capture_output=True, timeout=timeout, shell=False, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return out if r.returncode == 0 and out.exists() else None


def tool_version(binary: str, flag: str = "-version") -> str | None:
    try:
        r = subprocess.run([binary, flag], capture_output=True, text=True, timeout=10, shell=False, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired, PermissionError):
        return None
    return r.stdout.splitlines()[0][:80] if r.returncode == 0 and r.stdout else None
