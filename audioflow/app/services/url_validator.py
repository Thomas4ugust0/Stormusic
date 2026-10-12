"""Validação estrita e canonicalização de URLs do YouTube (anti-SSRF)."""
import ipaddress
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from app.core.errors import JobError

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_URL_LEN = 2048
_PATH_ID = {"shorts", "embed", "live", "v", "e"}
_NON_VIDEO = {"playlist", "channel", "c", "user", "results", "feed", "hashtag", "@"}


@dataclass(frozen=True)
class CanonicalURL:
    video_id: str
    url: str


def canonical(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def validate_youtube_url(raw: str, allowed_hosts: list[str]) -> CanonicalURL:
    if not isinstance(raw, str) or not raw or len(raw) > MAX_URL_LEN:
        raise JobError("invalid_url", "empty or too long")
    raw = raw.strip(" ")
    if any(unicodedata.category(c)[0] in "CZ" and c != " " for c in raw) or " " in raw or "\\" in raw:
        raise JobError("invalid_url", "control/whitespace characters")
    try:
        parts = urlsplit(raw)
        port = parts.port
    except ValueError as e:
        raise JobError("invalid_url", "unparseable") from e
    if parts.scheme != "https":
        raise JobError("invalid_url", "scheme must be https")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise JobError("invalid_url", "credentials in url")
    if port not in (None, 443):
        raise JobError("invalid_url", "non-standard port")
    host = (parts.hostname or "").rstrip(".")
    if not host:
        raise JobError("invalid_url", "missing host")
    if not host.isascii() or "xn--" in host:
        raise JobError("invalid_url", "idn host")
    try:
        ipaddress.ip_address(host.strip("[]"))
        raise JobError("invalid_url", "ip literal")
    except ValueError:
        pass
    host = host.lower()
    if host not in set(allowed_hosts):  # comparação exata
        raise JobError("invalid_url", "host not allowed")

    segs = [s for s in parts.path.split("/") if s]
    vid: str | None = None
    if host == "youtu.be":
        vid = segs[0] if len(segs) == 1 else None
    elif segs[:1] == ["watch"] and len(segs) == 1:
        v = parse_qs(parts.query).get("v", [])
        vid = v[0] if len(v) == 1 else None
    elif len(segs) == 2 and segs[0] in _PATH_ID:
        vid = segs[1]
    elif segs and (segs[0] in _NON_VIDEO or segs[0].startswith("@")):
        raise JobError("unsupported_source", "playlist/channel/search")
    if not vid or not VIDEO_ID_RE.fullmatch(vid):
        raise JobError("invalid_url", "no valid video id")
    return CanonicalURL(vid, canonical(vid))
