import hashlib
import hmac
import secrets


def new_job_id() -> str:
    return "job_" + secrets.token_hex(16)  # 128 bits aleatórios, nunca sequencial


def new_request_id() -> str:
    return "req_" + secrets.token_hex(8)


def new_api_key() -> str:
    return "af_" + secrets.token_urlsafe(32)


def hash_api_key(key: str, pepper: str) -> str:
    return hmac.new(pepper.encode(), key.encode(), hashlib.sha256).hexdigest()


def safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
