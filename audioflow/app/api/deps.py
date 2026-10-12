from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.errors import APIError
from app.core.redis import get_redis
from app.core.security import hash_api_key
from app.models import ApiKey
from app.services.ratelimit import hit


@dataclass
class Principal:
    key_id: str | None
    ip: str


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _extract_key(request: Request) -> str | None:
    k = request.headers.get("x-api-key")
    if k:
        return k.strip()
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def authenticate(request: Request, db: Session = Depends(get_db),
                 settings: Settings = Depends(get_settings)) -> Principal:
    ip = client_ip(request)
    if not settings.auth_enabled:
        return Principal(None, ip)
    key = _extract_key(request)
    if not key:
        raise APIError(401, "unauthorized", "API key ausente. Envie X-API-Key ou Authorization: Bearer.",
                       headers={"WWW-Authenticate": "Bearer"})
    row = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(key, settings.api_key_pepper)))
    if row is None:
        raise APIError(401, "unauthorized", "API key inválida.", headers={"WWW-Authenticate": "Bearer"})
    if row.revoked:
        raise APIError(403, "forbidden", "API key revogada.")
    return Principal(row.id, ip)


def rate_limited(request: Request, principal: Principal = Depends(authenticate),
                 settings: Settings = Depends(get_settings)) -> Principal:
    r = get_redis()
    keys = [f"ip:{principal.ip}"] + ([f"key:{principal.key_id}"] if principal.key_id else [])
    worst = None
    for k in keys:
        lim = hit(r, k, settings.rate_limit_per_minute, 60)
        if worst is None or lim.remaining < worst.remaining:
            worst = lim
        if not lim.allowed:
            raise APIError(429, "rate_limited", "Limite de requisições excedido. Tente novamente em instantes.",
                           retryable=True, headers={"Retry-After": str(lim.reset_in),
                                                    "X-RateLimit-Limit": str(lim.limit),
                                                    "X-RateLimit-Remaining": "0",
                                                    "X-RateLimit-Reset": str(lim.reset_in)})
    assert worst is not None
    request.state.rate_headers = {"X-RateLimit-Limit": str(worst.limit),
                                  "X-RateLimit-Remaining": str(worst.remaining),
                                  "X-RateLimit-Reset": str(worst.reset_in)}
    return principal
