from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from yt_dlp.utils import DownloadError

from app.core.db import session_scope
from app.core.errors import JobError, TransientJobError
from app.core.redis import request_cancel
from app.models import Job, JobStatus
from app.services.cache import cache_key
from app.tasks import maintenance
from app.tasks.pipeline import process_job
from tests.conftest import FakeSource, requires_ffmpeg

VID = "dQw4w9WgXcQ"


def new_job(fmt: str = "mp3", quality: str = "high", remove_sponsors: bool = False, jid: str | None = None) -> str:
    jid = jid or "job_" + __import__("secrets").token_hex(16)
    with session_scope() as db:
        db.add(Job(id=jid, video_id=VID, source_url=f"https://www.youtube.com/watch?v={VID}", format=fmt,
                   quality=quality, remove_sponsors=remove_sponsors, status=JobStatus.QUEUED, warnings=[],
                   cache_key=cache_key(VID, fmt, quality, remove_sponsors)))
    return jid


def get(jid: str) -> Job:
    with session_scope() as db:
        j = db.get(Job, jid)
        assert j is not None
        return j


@requires_ffmpeg
@pytest.mark.parametrize("fmt", ["mp3", "m4a", "wav", "flac", "original"])
def test_job_completes_with_full_duration(settings, fmt: str) -> None:  # type: ignore
    jid = new_job(fmt)
    assert process_job(jid, FakeSource(), settings) == JobStatus.COMPLETED
    j = get(jid)
    assert j.progress == 100 and j.size_bytes and Path(j.file_path or "").exists()
    assert j.video and j.video["title"].startswith("Canção")
    assert j.download_name and "/" not in j.download_name
    assert not any("difere" in w for w in j.warnings)  # duração = vídeo ±1 s (sem anúncios)
    assert not list(Path(settings.tmp_dir).glob("*"))  # temporários limpos


@requires_ffmpeg
def test_cache_hit_reuses_file(settings) -> None:  # type: ignore
    src = FakeSource()
    a = new_job()
    process_job(a, src, settings)
    b = new_job()
    assert process_job(b, src, settings) == JobStatus.COMPLETED
    assert src.inspect_calls == 1  # não reextraiu
    assert "cache" in " ".join(get(b).warnings)
    settings.cache_enabled = False
    c = new_job()
    process_job(c, src, settings)
    assert src.inspect_calls == 2


@requires_ffmpeg
def test_cache_miss_on_different_quality(settings) -> None:  # type: ignore
    src = FakeSource()
    process_job(new_job(quality="high"), src, settings)
    process_job(new_job(quality="low"), src, settings)
    assert src.inspect_calls == 2


@requires_ffmpeg
def test_remove_sponsors(settings) -> None:  # type: ignore
    src = FakeSource(duration=6, sponsors=1)
    jid = new_job(remove_sponsors=True)
    process_job(jid, src, settings)
    assert src.download_calls[0]["remove_sponsors"] is True
    assert any("SponsorBlock" in w for w in get(jid).warnings)
    jid2 = new_job(remove_sponsors=True, fmt="wav")
    process_job(jid2, FakeSource(sponsors=0), settings)
    assert any("Nenhum segmento" in w for w in get(jid2).warnings)


@requires_ffmpeg
def test_progress_monotonic(settings, monkeypatch) -> None:  # type: ignore
    from app.tasks import pipeline
    seen: list[int] = []
    orig = pipeline.Progress.set

    def spy(self, v, force=False):  # type: ignore
        orig(self, v, force)
        seen.append(self.value)
    monkeypatch.setattr(pipeline.Progress, "set", spy)
    process_job(new_job(), FakeSource(), settings)
    assert seen == sorted(seen) and seen[-1] >= 95


@pytest.mark.parametrize("overrides,code", [
    ({"availability": "private"}, "video_private"),
    ({"availability": "subscriber_only"}, "video_members_only"),
    ({"availability": "premium_only"}, "video_members_only"),
    ({"age_limit": 18}, "video_age_restricted"),
    ({"availability": "needs_auth"}, "video_age_restricted"),
    ({"is_live": True}, "live_not_supported"),
    ({"live_status": "is_upcoming"}, "live_not_supported"),
    ({"has_drm": True}, "video_drm_protected"),
    ({"duration": 99999}, "duration_exceeded"),
    ({"estimated_size_bytes": 10**12}, "file_too_large"),
])
def test_out_of_scope_metadata(settings, overrides, code) -> None:  # type: ignore
    jid = new_job()
    assert process_job(jid, FakeSource(info_overrides=overrides), settings) == JobStatus.FAILED
    j = get(jid)
    assert j.error_code == code and j.error_message


@pytest.mark.parametrize("msg,code", [
    ("ERROR: Private video", "video_private"),
    ("not made this video available in your country", "video_geo_blocked"),
    ("Sign in to confirm you're not a bot", "source_blocked"),
    ("Unable to extract player response; please report this issue", "extractor_outdated"),
    ("This video is DRM protected", "video_drm_protected"),
    ("Sign in to confirm your age", "video_age_restricted"),
])
def test_extractor_errors_map(settings, msg, code) -> None:  # type: ignore
    from app.services.error_mapping import map_exception
    jid = new_job()
    assert process_job(jid, FakeSource(inspect_exc=map_exception(DownloadError(msg))), settings) == JobStatus.FAILED
    assert get(jid).error_code == code


def test_transient_error_requeues_when_not_final(settings) -> None:  # type: ignore
    jid = new_job()
    with pytest.raises(TransientJobError):
        process_job(jid, FakeSource(inspect_exc=TransientJobError("source_blocked")), settings, final_attempt=False)
    assert get(jid).status == JobStatus.QUEUED
    process_job(jid, FakeSource(inspect_exc=TransientJobError("source_blocked")), settings, final_attempt=True)
    assert get(jid).status == JobStatus.FAILED and get(jid).error_retryable


@requires_ffmpeg
def test_cancel_during_download(settings) -> None:  # type: ignore
    jid = new_job()
    src = FakeSource(on_download=lambda i: request_cancel(jid) if i == 2 else None)
    assert process_job(jid, src, settings) == JobStatus.CANCELLED
    assert get(jid).error_code == "cancelled"
    assert not list(Path(settings.tmp_dir).glob("*"))


@requires_ffmpeg
def test_cancel_during_conversion(settings, monkeypatch) -> None:  # type: ignore
    from app.services import converter
    jid = new_job("flac")
    orig = converter.convert

    def conv(*a, **k):  # type: ignore
        request_cancel(jid)
        return orig(*a, **k)
    monkeypatch.setattr(converter, "convert", conv)
    assert process_job(jid, FakeSource(duration=30), settings) == JobStatus.CANCELLED


def test_cancelled_before_start(settings) -> None:  # type: ignore
    jid = new_job()
    request_cancel(jid)
    assert process_job(jid, FakeSource(), settings) == JobStatus.CANCELLED
    assert process_job(jid, FakeSource(), settings) == JobStatus.CANCELLED  # idempotente
    assert process_job("job_missing", FakeSource(), settings) == "missing"


def test_timeout_and_internal_error(settings) -> None:  # type: ignore
    jid = new_job()
    process_job(jid, FakeSource(download_exc=JobError("timeout")), settings)
    assert get(jid).error_code == "timeout"
    jid = new_job()
    process_job(jid, FakeSource(download_exc=RuntimeError("boom")), settings)
    assert get(jid).error_code == "internal_error"
    assert not list(Path(settings.tmp_dir).glob("*"))


@requires_ffmpeg
def test_file_too_large_after_download(settings) -> None:  # type: ignore
    settings.max_file_size_mb = 0
    jid = new_job()
    process_job(jid, FakeSource(info_overrides={"estimated_size_bytes": None}), settings)
    assert get(jid).error_code == "file_too_large"


def test_worker_restart_recovers(settings) -> None:  # type: ignore
    jid = new_job()
    with session_scope() as db:
        j = db.get(Job, jid)
        j.status = JobStatus.PROCESSING  # type: ignore[union-attr]
        j.updated_at = datetime.now(UTC) - timedelta(hours=2)  # type: ignore[union-attr]
    orphan = Path(settings.tmp_dir) / "job_orphan"
    orphan.mkdir(parents=True)
    assert maintenance.reset_stuck_jobs(settings) == 1
    assert get(jid).status == JobStatus.QUEUED
    assert maintenance.cleanup_orphan_tmp(settings) == 1 and not orphan.exists()


@requires_ffmpeg
def test_expiration_cleanup(settings) -> None:  # type: ignore
    jid = new_job()
    process_job(jid, FakeSource(), settings)
    path = get(jid).file_path
    with session_scope() as db:
        db.get(Job, jid).expires_at = datetime.now(UTC) - timedelta(seconds=1)  # type: ignore[union-attr]
    assert maintenance.cleanup_expired(settings) == 1
    assert not Path(path or "").exists()
    with session_scope() as db:
        assert db.get(Job, jid) is None


def test_ytdlp_update_check(monkeypatch) -> None:  # type: ignore
    monkeypatch.setattr(maintenance, "latest_pypi_version", lambda: "2099.1.1")
    assert maintenance.check_ytdlp_update("2026.08.19") == "2099.1.1"
    monkeypatch.setattr(maintenance, "latest_pypi_version", lambda: None)
    assert maintenance.check_ytdlp_update("x") is None
