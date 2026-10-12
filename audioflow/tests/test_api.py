import secrets
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.core.config import get_settings
from app.core.db import session_scope
from app.core.errors import JobError
from app.core.security import hash_api_key
from app.main import app
from app.models import ApiKey, Job, JobStatus
from app.tasks.pipeline import process_job
from tests.conftest import FakeSource, requires_ffmpeg

VID = "dQw4w9WgXcQ"
URL = f"https://www.youtube.com/watch?v={VID}"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sync_queue(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Substitui o Celery: processa a tarefa na hora com uma fonte falsa."""
    calls: list[str] = []

    def run(job_id: str) -> None:
        calls.append(job_id)
        process_job(job_id, FakeSource(), get_settings())

    monkeypatch.setattr(routes, "_enqueue", run)
    return calls


@pytest.fixture
def idle_queue(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []
    monkeypatch.setattr(routes, "_enqueue", calls.append)
    return calls


@pytest.fixture
def auth(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Ativa autenticação e cria uma chave válida; devolve os headers."""
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    key = "af_" + secrets.token_urlsafe(16)
    with session_scope() as db:
        db.add(ApiKey(id="key_a", name="a", key_hash=hash_api_key(key, "test-pepper")))
    return {"X-API-Key": key}


def _add_key(kid: str, revoked: bool = False) -> str:
    key = "af_" + secrets.token_urlsafe(16)
    with session_scope() as db:
        db.add(ApiKey(id=kid, name=kid, key_hash=hash_api_key(key, "test-pepper"), revoked=revoked))
    return key


def body(**kw: object) -> dict[str, object]:
    return {"source_url": URL, "format": "mp3", "terms_accepted": True} | kw


# --- criação ---------------------------------------------------------------

def test_create_job_returns_202_and_location(client: TestClient, idle_queue: list[str]) -> None:
    r = client.post("/api/v1/audio/jobs", json=body())
    assert r.status_code == 202, r.text
    data = r.json()
    assert data["status"] == "queued" and data["job_id"].startswith("job_")
    assert r.headers["Location"] == f"/api/v1/audio/jobs/{data['job_id']}"
    assert "X-RateLimit-Remaining" in r.headers and "X-Request-ID" in r.headers
    assert idle_queue == [data["job_id"]]


def test_terms_required(client: TestClient, idle_queue: list[str]) -> None:
    r = client.post("/api/v1/audio/jobs", json=body(terms_accepted=False))
    assert r.status_code == 422 and r.json()["error"]["code"] == "terms_not_accepted"
    assert idle_queue == []


@pytest.mark.parametrize("url", ["https://evil.com/watch?v=dQw4w9WgXcQ", "http://127.0.0.1/x", "not a url"])
def test_invalid_urls_rejected(client: TestClient, idle_queue: list[str], url: str) -> None:
    r = client.post("/api/v1/audio/jobs", json=body(source_url=url))
    assert 400 <= r.status_code < 500
    assert r.json()["error"]["code"]
    assert idle_queue == []


def test_malformed_json_is_400(client: TestClient) -> None:
    r = client.post("/api/v1/audio/jobs", content=b"{nope", headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"


def test_invalid_format_is_422(client: TestClient) -> None:
    r = client.post("/api/v1/audio/jobs", json=body(format="ogg"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_extra_fields_forbidden(client: TestClient) -> None:
    r = client.post("/api/v1/audio/jobs", json=body(callback="http://x"))
    assert r.status_code == 422


def test_queue_unavailable_marks_job_failed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_: str) -> None:
        raise ConnectionError("redis down")

    monkeypatch.setattr(routes, "_enqueue", boom)
    r = client.post("/api/v1/audio/jobs", json=body())
    assert r.status_code == 503 and r.json()["error"]["code"] == "queue_unavailable"
    with session_scope() as db:
        assert db.query(Job).one().status == JobStatus.FAILED


def test_queue_full(client: TestClient, idle_queue: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QUEUE_MAX_LENGTH", "1")
    get_settings.cache_clear()
    assert client.post("/api/v1/audio/jobs", json=body()).status_code == 202
    r = client.post("/api/v1/audio/jobs", json=body())
    assert r.status_code == 503 and r.headers["Retry-After"] == "60"


def test_rate_limit(client: TestClient, idle_queue: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "2")
    get_settings.cache_clear()
    codes = [client.post("/api/v1/audio/jobs", json=body()).status_code for _ in range(3)]
    assert codes == [202, 202, 429]


# --- status / download / delete --------------------------------------------

@requires_ffmpeg
def test_full_flow_status_and_download(client: TestClient, sync_queue: list[str]) -> None:
    jid = client.post("/api/v1/audio/jobs", json=body()).json()["job_id"]
    s = client.get(f"/api/v1/audio/jobs/{jid}").json()
    assert s["status"] == "completed" and s["progress"] == 100 and s["download_available"] is True
    assert s["video"]["id"] == VID

    r = client.get(f"/api/v1/audio/jobs/{jid}/download")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert "filename*=UTF-8''" in r.headers["content-disposition"]
    size = len(r.content)
    assert size == s["size_bytes"] and r.headers["accept-ranges"] == "bytes"

    part = client.get(f"/api/v1/audio/jobs/{jid}/download", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert part.headers["content-range"] == f"bytes 0-99/{size}"
    assert part.content == r.content[:100]

    tail = client.get(f"/api/v1/audio/jobs/{jid}/download", headers={"Range": "bytes=-10"})
    assert tail.status_code == 206 and tail.content == r.content[-10:]

    bad = client.get(f"/api/v1/audio/jobs/{jid}/download", headers={"Range": f"bytes={size + 5}-"})
    assert bad.status_code == 416

    assert client.delete(f"/api/v1/audio/jobs/{jid}").status_code == 204
    assert client.get(f"/api/v1/audio/jobs/{jid}").status_code == 404


def test_download_not_ready(client: TestClient, idle_queue: list[str]) -> None:
    jid = client.post("/api/v1/audio/jobs", json=body()).json()["job_id"]
    r = client.get(f"/api/v1/audio/jobs/{jid}/download")
    assert r.status_code == 409 and r.json()["error"]["retryable"] is True


@requires_ffmpeg
def test_download_expired(client: TestClient, sync_queue: list[str]) -> None:
    jid = client.post("/api/v1/audio/jobs", json=body()).json()["job_id"]
    with session_scope() as db:
        db.get(Job, jid).expires_at = datetime.now(UTC) - timedelta(minutes=1)  # type: ignore[union-attr]
    assert client.get(f"/api/v1/audio/jobs/{jid}/download").status_code == 410
    assert client.get(f"/api/v1/audio/jobs/{jid}").json()["download_available"] is False


def test_cancel_queued_job(client: TestClient, idle_queue: list[str]) -> None:
    jid = client.post("/api/v1/audio/jobs", json=body()).json()["job_id"]
    assert client.delete(f"/api/v1/audio/jobs/{jid}").status_code == 202
    s = client.get(f"/api/v1/audio/jobs/{jid}").json()
    assert s["status"] == "cancelled" and s["error"]["code"] == "cancelled"


@pytest.mark.parametrize("jid", ["nope", "job_" + "0" * 32, "job_" + "x" * 60])
def test_unknown_job_404(client: TestClient, jid: str) -> None:
    r = client.get(f"/api/v1/audio/jobs/{jid}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


# --- autenticação ----------------------------------------------------------

def test_auth_missing_and_invalid(client: TestClient, auth: dict[str, str], idle_queue: list[str]) -> None:
    r = client.post("/api/v1/audio/jobs", json=body())
    assert r.status_code == 401 and r.headers["WWW-Authenticate"] == "Bearer"
    r = client.post("/api/v1/audio/jobs", json=body(), headers={"X-API-Key": "af_wrong"})
    assert r.status_code == 401
    assert client.post("/api/v1/audio/jobs", json=body(), headers=auth).status_code == 202
    bearer = {"Authorization": f"Bearer {auth['X-API-Key']}"}
    assert client.post("/api/v1/audio/jobs", json=body(), headers=bearer).status_code == 202


def test_auth_revoked(client: TestClient, auth: dict[str, str]) -> None:
    key = _add_key("key_r", revoked=True)
    r = client.post("/api/v1/audio/jobs", json=body(), headers={"X-API-Key": key})
    assert r.status_code == 403


def test_jobs_isolated_per_key(client: TestClient, auth: dict[str, str], idle_queue: list[str]) -> None:
    jid = client.post("/api/v1/audio/jobs", json=body(), headers=auth).json()["job_id"]
    other = {"X-API-Key": _add_key("key_b")}
    assert client.get(f"/api/v1/audio/jobs/{jid}", headers=other).status_code == 404
    assert client.delete(f"/api/v1/audio/jobs/{jid}", headers=other).status_code == 404
    assert client.get(f"/api/v1/audio/jobs/{jid}", headers=auth).status_code == 200


def test_concurrent_limit_per_key(client: TestClient, auth: dict[str, str], idle_queue: list[str]) -> None:
    codes = [client.post("/api/v1/audio/jobs", json=body(), headers=auth).status_code for _ in range(3)]
    assert codes == [202, 202, 429]


# --- inspect ---------------------------------------------------------------

def test_inspect_ok(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes, "YtDlpSource", lambda s: FakeSource())
    r = client.post("/api/v1/audio/inspect", json={"source_url": URL})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["processable"] is True and d["source_audio"]["codec"] == "opus" and d["limitations"]


def test_inspect_unprocessable_video(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes, "YtDlpSource", lambda s: FakeSource(inspect_exc=JobError("video_private")))
    d = client.post("/api/v1/audio/inspect", json={"source_url": URL}).json()
    assert d["processable"] is False and d["error"]["code"] == "video_private"


def test_inspect_source_blocked_is_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes, "YtDlpSource", lambda s: FakeSource(inspect_exc=JobError("source_blocked")))
    assert client.post("/api/v1/audio/inspect", json={"source_url": URL}).status_code == 503


# --- ops / documentação ----------------------------------------------------

def test_health_and_security_headers(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "default-src 'self'" in r.headers["Content-Security-Policy"]


def test_ready_reports_checks(client: TestClient) -> None:
    r = client.get("/health/ready")
    assert r.status_code in (200, 503)
    checks = r.json()["checks"]
    assert checks["postgres"] == "ok" and checks["redis"] == "ok"


def test_metrics_internal_only(client: TestClient) -> None:
    r = client.get("/metrics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")


def test_openapi_and_docs_are_local(client: TestClient) -> None:
    spec = client.get("/openapi.json").json()
    assert "/api/v1/audio/jobs" in spec["paths"]
    html = client.get("/docs").text
    assert "/static/vendor/swagger-ui-bundle.js" in html and "cdn.jsdelivr" not in html
    assert "fonts.googleapis" not in client.get("/redoc").text


def test_404_and_405_use_error_envelope(client: TestClient) -> None:
    assert client.get("/nada").json()["error"]["code"] == "not_found"
    assert client.put("/api/v1/audio/jobs").json()["error"]["code"] == "method_not_allowed"
