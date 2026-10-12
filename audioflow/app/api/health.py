import ipaddress

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import func, select, text

from app.core.config import Settings, get_settings
from app.core.db import session_scope
from app.core.errors import APIError
from app.core.redis import get_redis
from app.core.security import safe_equal
from app.models import Job, JobStatus
from app.services import metrics
from app.services.converter import tool_version
from app.services.extractor import YtDlpSource
from app.services.storage import free_disk_mb

router = APIRouter(tags=["ops"])


@router.get("/health", summary="Liveness", responses={200: {"content": {"application/json": {
    "example": {"status": "ok", "ytdlp_version": "2025.12.08"}}}}})
def health(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {"status": "ok", "ytdlp_version": YtDlpSource(settings).version()}


@router.get("/health/ready", summary="Readiness")
def ready(settings: Settings = Depends(get_settings)) -> JSONResponse:
    checks: dict[str, object] = {}
    try:
        with session_scope() as db:
            db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception:  # noqa: BLE001
        checks["postgres"] = "error"
    try:
        checks["redis"] = "ok" if get_redis().ping() else "error"
    except Exception:  # noqa: BLE001
        checks["redis"] = "error"
    checks["ffmpeg"] = tool_version(settings.ffmpeg_bin) or "missing"
    checks["ffprobe"] = tool_version(settings.ffprobe_bin) or "missing"
    checks["deno"] = tool_version(settings.deno_bin, "--version") or "missing"
    checks["ytdlp_version"] = YtDlpSource(settings).version()
    try:
        free = free_disk_mb(settings.storage_dir)
        checks["disk_free_mb"] = round(free)
        disk_ok = free >= settings.min_free_disk_mb
    except OSError:
        disk_ok = False
        checks["disk_free_mb"] = "error"
    ok = (checks["postgres"] == "ok" and checks["redis"] == "ok" and disk_ok
          and all(checks[k] != "missing" for k in ("ffmpeg", "ffprobe", "deno")))
    return JSONResponse({"status": "ready" if ok else "not_ready", "checks": checks}, status_code=200 if ok else 503)


@router.get("/metrics", include_in_schema=False)
def metrics_endpoint(request: Request, settings: Settings = Depends(get_settings)) -> Response:
    host = request.client.host if request.client else ""
    try:
        internal = ipaddress.ip_address(host).is_private
    except ValueError:
        internal = host == "testclient"
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if settings.metrics_token:
        if not safe_equal(token, settings.metrics_token):
            raise APIError(403, "forbidden", "Acesso às métricas negado.")
    elif not internal:
        raise APIError(403, "forbidden", "Métricas disponíveis apenas na rede interna.")
    try:
        with session_scope() as db:
            metrics.queue_depth.set(db.scalar(select(func.count()).select_from(Job)
                                              .where(Job.status == JobStatus.QUEUED)) or 0)
    except Exception:  # noqa: BLE001, S110 - métrica best-effort
        pass
    metrics.ytdlp_version.info({"version": YtDlpSource(settings).version()})
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
