import pytest
from yt_dlp.utils import DownloadCancelled, DownloadError, ExtractorError, GeoRestrictedError, UnavailableVideoError

from app.core.errors import JOB_ERRORS, JobError, TransientJobError
from app.services.error_mapping import code_from_message, map_exception


@pytest.mark.parametrize("msg,code", [
    ("ERROR: [youtube] x: Private video. Sign in if you've been granted access", "video_private"),
    ("ERROR: [youtube] x: Join this channel to get access to members-only content", "video_members_only"),
    ("This video requires payment to watch", "video_members_only"),
    ("ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate", "video_age_restricted"),
    ("The uploader has not made this video available in your country", "video_geo_blocked"),
    ("This video is DRM protected", "video_drm_protected"),
    ("This live event will begin in 3 hours", "live_not_supported"),
    ("Premieres in 2 days", "live_not_supported"),
    ("Sign in to confirm you're not a bot. Use --cookies", "source_blocked"),
    ("HTTP Error 429: Too Many Requests", "source_blocked"),
    ("Unable to extract yt initial data; please report this issue", "extractor_outdated"),
    ("nsig extraction failed: You may experience throttling", "extractor_outdated"),
    ("Video unavailable. This video has been removed by the uploader", "video_unavailable"),
    ("File is larger than max-filesize (1000 bytes > 10 bytes)", "file_too_large"),
    ("Unsupported URL: https://x", "unsupported_source"),
    ("Read timed out.", "timeout"),
])
def test_message_patterns(msg: str, code: str) -> None:
    assert code_from_message(msg) == code
    assert map_exception(DownloadError(msg)).code == code


def test_typed_exceptions() -> None:
    assert map_exception(DownloadCancelled("x")).code == "cancelled"
    geo = GeoRestrictedError("blocked")
    assert map_exception(DownloadError("wrapped", exc_info=(type(geo), geo, None))).code == "video_geo_blocked"
    assert map_exception(UnavailableVideoError("x")).code == "video_unavailable"
    assert map_exception(ExtractorError("weird expected", expected=True)).code == "video_unavailable"
    assert map_exception(ConnectionError("boom")).code == "timeout"
    assert map_exception(RuntimeError("???")).code == "internal_error"
    je = JobError("video_private")
    assert map_exception(je) is je


def test_transient_classification() -> None:
    assert isinstance(map_exception(DownloadError("HTTP Error 429")), TransientJobError)
    assert not isinstance(map_exception(DownloadError("Private video")), TransientJobError)


def test_all_codes_have_portuguese_messages() -> None:
    for code, (msg, retry) in JOB_ERRORS.items():
        assert msg and isinstance(retry, bool)
    assert JobError("nonexistent").code == "internal_error"
