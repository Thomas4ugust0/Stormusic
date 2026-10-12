"""Mapeamento centralizado de exceções do yt-dlp para códigos estáveis."""
from yt_dlp.utils import (
    DownloadCancelled,
    DownloadError,
    ExtractorError,
    GeoRestrictedError,
    UnavailableVideoError,
    UnsupportedError,
)

from app.core.errors import JobError, TransientJobError

# A ordem importa: padrões mais específicos primeiro.
MESSAGE_PATTERNS: list[tuple[str, tuple[str, ...]]] = [
    ("source_blocked", ("not a bot", "http error 429", "too many requests", "rate-limited", "rate limited",
                        "this content isn't available, try again later", "po token", "http error 403: forbidden")),
    ("video_private", ("private video", "this video is private", "video is private")),
    ("video_members_only", ("members-only", "members only", "join this channel", "requires payment",
                            "purchase", "rental", "premium_only", "subscriber_only")),
    ("video_age_restricted", ("confirm your age", "age-restricted", "age restricted", "inappropriate for some users",
                              "sign in to confirm", "login required", "needs_auth", "use --cookies")),
    ("video_geo_blocked", ("not available in your country", "geo restrict", "geo-restrict", "blocked it in your country",
                           "not made this video available in your country")),
    ("video_drm_protected", ("drm",)),
    ("live_not_supported", ("live event will begin", "premieres in", "is live", "is_live", "is_upcoming",
                            "this live event", "post_live", "live stream recording is not available")),
    ("duration_exceeded", ("duration_exceeded",)),
    ("file_too_large", ("larger than max-filesize", "file is larger than max", "file_too_large")),
    ("unsupported_source", ("unsupported url",)),
    ("extractor_outdated", ("unable to extract", "please report this issue", "nsig extraction failed",
                            "signature extraction failed", "failed to extract any player response",
                            "unable to decode", "no supported javascript runtime", "challenge solving failed")),
    ("video_unavailable", ("video unavailable", "has been removed", "does not exist", "no longer available",
                           "account associated with this video has been terminated", "not available",
                           "requested format is not available", "only images are available")),
    ("timeout", ("timed out", "read timeout")),
]

TRANSIENT = {"source_blocked", "timeout", "internal_error_network"}


def code_from_message(msg: str) -> str | None:
    m = msg.lower()
    for code, pats in MESSAGE_PATTERNS:
        if any(p in m for p in pats):
            return code
    return None


def map_exception(exc: BaseException) -> JobError:
    if isinstance(exc, JobError):
        return exc
    if isinstance(exc, DownloadCancelled):
        return JobError("cancelled")
    inner = exc
    if isinstance(exc, DownloadError) and getattr(exc, "exc_info", None):
        inner = exc.exc_info[1] or exc  # type: ignore[index]
    if isinstance(inner, GeoRestrictedError):
        return JobError("video_geo_blocked", str(exc))
    if isinstance(inner, UnsupportedError):
        return JobError("unsupported_source", str(exc))
    msg = f"{exc} {inner}"
    code = code_from_message(msg)
    if code is None and isinstance(inner, UnavailableVideoError):
        code = "video_unavailable"
    if code is None and isinstance(inner, ExtractorError) and getattr(inner, "expected", False):
        code = "video_unavailable"
    if code is None and isinstance(inner, TimeoutError | ConnectionError):
        code = "timeout"
    code = code or "internal_error"
    cls = TransientJobError if code in TRANSIENT else JobError
    return cls(code, msg[:500])
