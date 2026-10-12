import logging
import re
import sys
from typing import Any

import structlog

SENSITIVE_KEYS = {"api_key", "x-api-key", "authorization", "cookie", "cookies", "set-cookie", "password", "token", "pepper"}
# URLs assinadas de mídia (googlevideo etc.) e query strings com assinatura
_SIGNED = re.compile(r"https?://[^\s\"']*(googlevideo\.com|[?&](sig|signature|expire|lsig)=)[^\s\"']*", re.I)
_KEYLIKE = re.compile(r"(af_[A-Za-z0-9_-]{16,})")


def redact_value(v: Any) -> Any:
    if isinstance(v, str):
        v = _SIGNED.sub("[signed-url-redacted]", v)
        return _KEYLIKE.sub("[key-redacted]", v)
    if isinstance(v, dict):
        return {k: ("[redacted]" if str(k).lower() in SENSITIVE_KEYS else redact_value(x)) for k, x in v.items()}
    if isinstance(v, list | tuple):
        return [redact_value(x) for x in v]
    return v


def _redact(_: Any, __: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    return redact_value(event_dict)  # type: ignore[no-any-return]


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level.upper())
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            _redact,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )


log = structlog.get_logger("audioflow")
