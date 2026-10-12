"""Rate limiting de janela fixa em Redis."""
import time
from dataclasses import dataclass

import redis


@dataclass
class Limit:
    allowed: bool
    limit: int
    remaining: int
    reset_in: int


def hit(r: "redis.Redis", key: str, limit: int, window: int) -> Limit:
    now = int(time.time())
    bucket = now // window
    k = f"audioflow:rl:{key}:{bucket}"
    p = r.pipeline()
    p.incr(k)
    p.expire(k, window + 5)
    count = int(p.execute()[0])
    reset = window - (now % window)
    return Limit(count <= limit, limit, max(0, limit - count), reset)


def peek(r: "redis.Redis", key: str, window: int) -> int:
    bucket = int(time.time()) // window
    return int(r.get(f"audioflow:rl:{key}:{bucket}") or 0)
