from functools import lru_cache

import redis

from app.core.config import get_settings


@lru_cache
def get_redis() -> "redis.Redis":
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True)


def cancel_key(job_id: str) -> str:
    return f"audioflow:cancel:{job_id}"


def request_cancel(job_id: str) -> None:
    get_redis().set(cancel_key(job_id), "1", ex=86400)


def is_cancelled(job_id: str) -> bool:
    return bool(get_redis().exists(cancel_key(job_id)))
