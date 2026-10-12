import subprocess
import time
from pathlib import Path

import pytest

from app.core.errors import JobError
from app.services import converter
from app.services.converter import Metadata, convert, plan, probe
from tests.conftest import FFMPEG, make_sine, make_thumb, requires_ffmpeg

pytestmark = requires_ffmpeg
FFPROBE = str(Path(FFMPEG or "ffmpeg").with_name("ffprobe"))


def _convert(tmp: Path, src: Path, fmt: str, quality: str, src_codec: str, src_kbps: float, cover: bool = True):  # type: ignore
    c = make_thumb(tmp / "c.jpg") if cover else None
    p, warns = plan(fmt, quality, src_codec, src_kbps, src.suffix, c is not None)
    out = convert(src, tmp, p, Metadata("Título ç", "Artista", "2024", "x"), c, duration=3.0, ffmpeg=FFMPEG,
                  timeout=60, should_cancel=lambda: False, on_progress=lambda f: None)
    return p, warns, probe(out, FFPROBE)


@pytest.mark.parametrize("fmt,quality,codec,kbps", [
    ("mp3", "low", "mp3", 96), ("mp3", "medium", "mp3", 128), ("mp3", "high", "mp3", 192),
    ("mp3", "max", "mp3", 320), ("m4a", "low", "aac", 96), ("m4a", "medium", "aac", 128),
    ("m4a", "high", "aac", 192), ("m4a", "max", "aac", 256), ("wav", "high", "pcm_s16le", None),
    ("flac", "high", "flac", None), ("original", "high", "opus", None),
])
def test_formats_and_qualities(tmp_path: Path, fmt: str, quality: str, codec: str, kbps: int | None) -> None:
    src = make_sine(tmp_path / "source.webm", 3, "libopus", "160k")
    p, warns, info = _convert(tmp_path, src, fmt, quality, "opus", 400)
    assert info["codec"] == codec
    assert abs(info["duration"] - 3.0) <= 1.0
    if kbps and fmt == "mp3":  # CBR: bitrate exato
        assert abs(info["bitrate_kbps"] - kbps) / kbps < 0.1
    elif kbps:  # AAC nativo usa menos bits que o teto em sinais triviais (seno)
        assert info["bitrate_kbps"] <= kbps * 1.2
    if fmt in ("mp3", "m4a", "flac"):
        assert info["tags"].get("title") == "Título ç"
        assert info["tags"].get("artist") == "Artista"
    if fmt == "original":
        assert p.ext == "opus" and not p.reencode


def test_quality_above_source_warns(tmp_path: Path) -> None:
    src = make_sine(tmp_path / "source.webm", 2, "libopus", "128k")
    _, warns, _ = _convert(tmp_path, src, "mp3", "max", "opus", 130)
    assert any("excede a da fonte" in w for w in warns)
    _, warns, _ = _convert(tmp_path, src, "flac", "high", "opus", 130)
    assert any("sem ganho" in w for w in warns)


def test_m4a_from_aac_is_remux(tmp_path: Path) -> None:
    src = make_sine(tmp_path / "source.m4a", 2, "aac", "128k")
    p, warns, info = _convert(tmp_path, src, "m4a", "high", "mp4a.40.2", 128)
    assert not p.reencode and info["codec"] == "aac"
    assert any("remuxado" in w for w in warns)
    p, _, _ = _convert(tmp_path, src, "m4a", "low", "mp4a.40.2", 128)
    assert p.reencode  # pedir menos que a fonte exige reencode
    assert converter.original_ext("mp4a.40.2", ".m4a") == "m4a"
    assert converter.original_ext("vorbis", ".webm") == "ogg"
    assert converter.original_ext("mp3", ".mp3") == "mp3"
    assert converter.original_ext(None, ".xyz") == "xyz"


def test_ffmpeg_missing(tmp_path: Path) -> None:
    src = make_sine(tmp_path / "source.webm", 1)
    p, _ = plan("mp3", "high", "opus", 128, ".webm", False)
    with pytest.raises(JobError) as e:
        convert(src, tmp_path, p, Metadata(), None, duration=1, ffmpeg="/nonexistent/ffmpeg", timeout=10,
                should_cancel=lambda: False, on_progress=lambda f: None)
    assert e.value.code == "conversion_failed"
    with pytest.raises(JobError):
        probe(src, "/nonexistent/ffprobe")
    assert converter.tool_version("/nonexistent/ffmpeg") is None
    assert converter.prepare_cover(src, tmp_path, "/nonexistent/ffmpeg") is None


def test_corrupted_input(tmp_path: Path) -> None:
    bad = tmp_path / "source.webm"
    bad.write_bytes(b"not audio at all" * 100)
    p, _ = plan("mp3", "high", "opus", 128, ".webm", False)
    with pytest.raises(JobError) as e:
        convert(bad, tmp_path, p, Metadata(), None, duration=1, ffmpeg=FFMPEG, timeout=10,
                should_cancel=lambda: False, on_progress=lambda f: None)
    assert e.value.code == "conversion_failed"
    with pytest.raises(JobError):
        probe(bad, FFPROBE)


def test_timeout_and_cancel_kill_ffmpeg(tmp_path: Path) -> None:
    src = make_sine(tmp_path / "source.webm", 600)  # longo o bastante
    p, _ = plan("flac", "high", "opus", 128, ".webm", False)
    t = time.monotonic()
    with pytest.raises(JobError) as e:
        convert(src, tmp_path, p, Metadata(), None, duration=600, ffmpeg=FFMPEG, timeout=0.05,
                should_cancel=lambda: False, on_progress=lambda f: None)
    assert e.value.code == "timeout" and time.monotonic() - t < 10
    with pytest.raises(JobError) as e:
        convert(src, tmp_path, p, Metadata(), None, duration=600, ffmpeg=FFMPEG, timeout=60,
                should_cancel=lambda: True, on_progress=lambda f: None)
    assert e.value.code == "cancelled"


def test_probe_timeout(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def boom(*a, **k):  # type: ignore
        raise subprocess.TimeoutExpired("ffprobe", 1)
    monkeypatch.setattr(subprocess, "run", boom)
    with pytest.raises(JobError) as e:
        probe(tmp_path / "x", FFPROBE)
    assert e.value.code == "timeout"


def test_sanitize_tag() -> None:
    assert converter.sanitize_tag("a\x00b\x1fc\n") == "abc"
    assert converter.sanitize_tag("") is None
    assert len(converter.sanitize_tag("x" * 999) or "") == 300
