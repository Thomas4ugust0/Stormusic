import os
import shutil
import subprocess
import tempfile
from collections.abc import Iterator
from pathlib import Path

import fakeredis
import pytest
import redis

_ROOT = Path(tempfile.mkdtemp(prefix="audioflow-test-"))
os.environ.update({
    "DATABASE_URL": f"sqlite:///{_ROOT}/test.db",
    "REDIS_URL": "redis://fake:6379/0",
    "STORAGE_DIR": str(_ROOT / "data"),
    "TMP_DIR": str(_ROOT / "tmp"),
    "AUTH_ENABLED": "false",
    "API_KEY_PEPPER": "test-pepper",
    "MIN_FREE_DISK_MB": "1",
    "LOG_LEVEL": "INFO",
    "ALLOWED_HOSTS": "youtube.com,www.youtube.com,m.youtube.com,music.youtube.com,youtu.be,www.youtube-nocookie.com",
    "CORS_ORIGINS": "",
    "REQUIRE_TERMS_ACCEPTANCE": "true",
    "CACHE_ENABLED": "true",
})
for b in ("ffmpeg", "ffprobe"):
    path = shutil.which(b) or (f"/tmp/bin/{b}" if Path(f"/tmp/bin/{b}").exists() else None)
    if path:
        os.environ[f"{b.upper()}_BIN"] = path
FFMPEG = os.environ.get("FFMPEG_BIN")

_fake_server = fakeredis.FakeServer()
redis.Redis.from_url = lambda *a, **k: fakeredis.FakeRedis(server=_fake_server, decode_responses=True)  # type: ignore

from app.core.config import get_settings  # noqa: E402
from app.core.db import Base, get_engine  # noqa: E402
from app.core.redis import get_redis  # noqa: E402
from app.services.extractor import DownloadResult, VideoInfo  # noqa: E402

requires_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="ffmpeg indisponível")


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    get_settings.cache_clear()
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    get_redis().flushall()
    for d in ("data", "tmp"):
        shutil.rmtree(_ROOT / d, ignore_errors=True)
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings():  # type: ignore[no-untyped-def]
    return get_settings()


def make_sine(path: Path, seconds: float = 3.0, codec: str = "libopus", bitrate: str = "128k") -> Path:
    assert FFMPEG
    subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency=440:duration={seconds}", "-c:a", codec, "-b:a", bitrate, str(path)], check=True)
    return path


def make_thumb(path: Path) -> Path:
    assert FFMPEG
    subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180",
                    "-frames:v", "1", str(path)], check=True)
    return path


class FakeSource:
    """AudioSource falso: sem rede, gera áudio real com FFmpeg."""

    def __init__(self, *, duration: float = 3.0, codec: str = "opus", ext: str = "webm", kbps: float = 128,
                 inspect_exc: Exception | None = None, download_exc: Exception | None = None,
                 info_overrides: dict | None = None, sponsors: int = 0, on_download=None) -> None:  # type: ignore
        self.duration, self.codec, self.ext, self.kbps = duration, codec, ext, kbps
        self.inspect_exc, self.download_exc = inspect_exc, download_exc
        self.info_overrides = info_overrides or {}
        self.sponsors = sponsors
        self.on_download = on_download
        self.inspect_calls = 0
        self.download_calls: list[dict] = []

    def version(self) -> str:
        return "fake"

    def inspect(self, url: str) -> VideoInfo:
        self.inspect_calls += 1
        if self.inspect_exc:
            raise self.inspect_exc
        base = dict(id=url[-11:], title="Canção Teste: ação/\"demo\"", uploader="Artista Ü", upload_date="20240102",
                    duration=self.duration, thumbnail_url="https://i.ytimg.com/vi/x/hq.jpg", codec=self.codec,
                    bitrate_kbps=self.kbps, ext=self.ext, estimated_size_bytes=50_000)
        base.update(self.info_overrides)
        return VideoInfo(**base)

    def download(self, url, workdir, *, remove_sponsors, on_progress, should_cancel, deadline):  # type: ignore
        self.download_calls.append({"remove_sponsors": remove_sponsors})
        for i in range(1, 6):
            if self.on_download:
                self.on_download(i)
            if should_cancel():
                from yt_dlp.utils import DownloadCancelled

                from app.services.error_mapping import map_exception
                raise map_exception(DownloadCancelled("x"))
            on_progress(i / 5)
        if self.download_exc:
            raise self.download_exc
        codec = {"opus": "libopus", "aac": "aac", "mp4a.40.2": "aac"}.get(self.codec, "libopus")
        dur = self.duration - (2 if remove_sponsors and self.sponsors else 0)
        audio = make_sine(workdir / f"source.{self.ext}", dur, codec, f"{int(self.kbps)}k")
        thumb = make_thumb(workdir / "thumb.png")
        return DownloadResult(audio, thumb, self.sponsors if remove_sponsors else 0)
