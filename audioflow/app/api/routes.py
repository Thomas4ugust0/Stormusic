import contextlib
import json
from pathlib import Path

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, authenticate, rate_limited
from app.api.files import stream_file
from app.api.serialize import is_expired, to_status
from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.errors import JOB_ERROR_HTTP, APIError, JobError
from app.core.redis import get_redis, request_cancel
from app.core.security import new_job_id
from app.models import Job, JobStatus
from app.schemas.job import ErrorBody, ErrorResponse, InspectOut, InspectRequest, JobCreate, JobCreated, JobStatusOut
from app.services import storage
from app.services.cache import cache_key
from app.services.extractor import YtDlpSource, classify
from app.services.url_validator import validate_youtube_url

router = APIRouter(prefix="/api/v1/audio", tags=["audio"])
E = {c: {"model": ErrorResponse} for c in (400, 401, 403, 404, 409, 410, 413, 422, 429, 500, 503)}


def _enqueue(job_id: str) -> None:
    from app.tasks.jobs import enqueue  # import tardio: a API não depende do worker para iniciar

    enqueue(job_id)


def _get_owned(db: Session, job_id: str, p: Principal) -> Job:
    job = db.get(Job, job_id) if job_id.startswith("job_") and len(job_id) <= 40 else None
    if job is None or (p.key_id is not None and job.api_key_id != p.key_id):
        raise APIError(404, "not_found", "Tarefa não encontrada.")
    return job


def _url_error(e: JobError) -> APIError:
    return APIError(JOB_ERROR_HTTP.get(e.code, 400), e.code, e.message, e.retryable)


@router.post("/jobs", status_code=202, response_model=JobCreated, responses=E,
             summary="Cria uma tarefa de extração de áudio")
def create_job(body: JobCreate, request: Request, response: Response, p: Principal = Depends(rate_limited),
               db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> JobCreated:
    if settings.require_terms_acceptance and not body.terms_accepted:
        raise APIError(422, "terms_not_accepted",
                       "É necessário confirmar terms_accepted=true: você tem o direito de baixar e usar este conteúdo.")
    try:
        canon = validate_youtube_url(body.source_url, settings.allowed_hosts)
    except JobError as e:
        raise _url_error(e) from e
    queued = db.scalar(select(func.count()).select_from(Job).where(Job.status == JobStatus.QUEUED)) or 0
    if queued >= settings.queue_max_length:
        raise APIError(503, "queue_full", "A fila está cheia. Tente novamente em alguns minutos.", True,
                       headers={"Retry-After": "60"})
    if p.key_id:
        active = db.scalar(select(func.count()).select_from(Job).where(
            Job.api_key_id == p.key_id, Job.status.in_(JobStatus.ACTIVE))) or 0
        if active >= settings.max_concurrent_jobs_per_key:
            raise APIError(429, "too_many_active_jobs", "Limite de tarefas simultâneas por chave atingido.", True,
                           headers={"Retry-After": "30"})
    job = Job(id=new_job_id(), api_key_id=p.key_id, client_ip=p.ip, video_id=canon.video_id,
              source_url=canon.url, format=body.format, quality=body.quality, remove_sponsors=body.remove_sponsors,
              cache_key=cache_key(canon.video_id, body.format, body.quality, body.remove_sponsors),
              status=JobStatus.QUEUED, progress=0, warnings=[])
    db.add(job)
    db.commit()
    try:
        _enqueue(job.id)
    except Exception as e:  # noqa: BLE001
        job.status, job.error_code = JobStatus.FAILED, "internal_error"
        job.error_message, job.error_retryable = "Fila indisponível.", True
        db.commit()
        raise APIError(503, "queue_unavailable", "Fila de processamento indisponível.", True) from e
    response.headers["Location"] = f"/api/v1/audio/jobs/{job.id}"
    for k, v in getattr(request.state, "rate_headers", {}).items():
        response.headers[k] = v
    return JobCreated(job_id=job.id, status=job.status, format=job.format, message="Tarefa criada com sucesso.")


@router.get("/jobs/{job_id}", response_model=JobStatusOut, responses=E, summary="Status e progresso")
def get_job(job_id: str, request: Request, p: Principal = Depends(authenticate),
            db: Session = Depends(get_db)) -> JobStatusOut:
    return to_status(_get_owned(db, job_id, p), getattr(request.state, "request_id", None))


@router.get("/jobs/{job_id}/download", responses=E | {200: {"content": {"audio/mpeg": {}}}, 206: {}},
            summary="Baixa o áudio (streaming, suporta Range)")
def download(job_id: str, p: Principal = Depends(authenticate), db: Session = Depends(get_db),
             range: str | None = Header(default=None)) -> Response:  # noqa: A002
    job = _get_owned(db, job_id, p)
    if job.status != JobStatus.COMPLETED:
        raise APIError(409, "not_ready", f"A tarefa ainda não foi concluída (status: {job.status}).", True)
    if is_expired(job) or not job.file_path or not Path(job.file_path).exists():
        raise APIError(410, "expired", "O resultado expirou e foi removido.")
    return stream_file(Path(job.file_path), job.file_ext or "bin", job.download_name or f"audio.{job.file_ext}", range)


@router.delete("/jobs/{job_id}", status_code=204, responses=E | {202: {"description": "Cancelamento solicitado"}},
               summary="Cancela a tarefa ou remove o resultado")
def delete_job(job_id: str, p: Principal = Depends(authenticate), db: Session = Depends(get_db)) -> Response:
    job = _get_owned(db, job_id, p)
    if job.status in JobStatus.ACTIVE:
        request_cancel(job.id)
        if job.status == JobStatus.QUEUED:
            je = JobError("cancelled")
            job.status, job.error_code, job.error_message, job.error_retryable = (
                JobStatus.CANCELLED, je.code, je.message, False)
        return Response(status_code=status.HTTP_202_ACCEPTED)
    storage.remove_file(job.file_path)
    db.delete(job)
    return Response(status_code=204)


@router.post("/inspect", response_model=InspectOut, responses=E, summary="Valida a URL e devolve metadados")
def inspect(body: InspectRequest, _: Principal = Depends(rate_limited),
            settings: Settings = Depends(get_settings)) -> InspectOut:
    try:
        canon = validate_youtube_url(body.source_url, settings.allowed_hosts)
    except JobError as e:
        raise _url_error(e) from e
    try:
        info = YtDlpSource(settings).inspect(canon.url)
    except JobError as e:
        if e.code in ("source_blocked", "extractor_outdated", "timeout", "internal_error"):
            raise APIError(503, e.code, e.message, e.retryable) from e
        return InspectOut(video={"id": canon.video_id}, source_audio={}, processable=False,
                          error=ErrorBody(code=e.code, message=e.message, retryable=e.retryable))
    lim: list[str] = []
    error = None
    try:
        classify(info, settings)
    except JobError as e:
        error = ErrorBody(code=e.code, message=e.message, retryable=e.retryable)
    if info.bitrate_kbps:
        lim.append(f"Qualidade máxima da fonte: ~{info.bitrate_kbps:.0f} kbps ({info.codec}).")
    lim.append("Patrocínios inseridos pelo criador fazem parte do conteúdo (remove_sponsors é melhor esforço).")
    return InspectOut(video=info.public(), source_audio={"codec": info.codec, "bitrate_kbps": info.bitrate_kbps},
                      estimated_size_bytes=info.estimated_size_bytes, limitations=lim,
                      processable=error is None, error=error)


@router.get("/search", responses=E, summary="Busca músicas no YouTube Music (somente faixas da categoria música)")
def search(q: str = Query(min_length=1, max_length=200), limit: int = Query(20, ge=1, le=40),
           _: Principal = Depends(rate_limited), settings: Settings = Depends(get_settings)) -> dict[str, object]:
    query = " ".join(q.split())
    ck = f"search:{limit}:{query.lower()}"
    with contextlib.suppress(Exception):  # cache é opcional
        if hit := get_redis().get(ck):
            return {"query": query, "results": json.loads(hit)}
    try:
        results = YtDlpSource(settings).search_music(query, limit)
    except Exception as e:  # noqa: BLE001
        raise APIError(503, "search_failed", f"Falha na busca do YouTube: {str(e)[:400]}", True) from e
    with contextlib.suppress(Exception):
        get_redis().setex(ck, 600, json.dumps(results))
    return {"query": query, "results": results}


@router.get("/related", responses=E, summary="Rádio do YouTube Music para uma faixa (recomendações do algoritmo)")
def related(id: str = Query(min_length=11, max_length=11, pattern=r"^[A-Za-z0-9_-]{11}$"),  # noqa: A002
            limit: int = Query(25, ge=1, le=50),
            _: Principal = Depends(rate_limited), settings: Settings = Depends(get_settings)) -> dict[str, object]:
    ck = f"related:{limit}:{id}"
    with contextlib.suppress(Exception):
        if hit := get_redis().get(ck):
            return {"id": id, "results": json.loads(hit)}
    try:
        results = YtDlpSource(settings).related_music(id, limit)
    except Exception as e:  # noqa: BLE001
        raise APIError(503, "related_failed", f"Falha ao buscar recomendações: {str(e)[:400]}", True) from e
    with contextlib.suppress(Exception):
        get_redis().setex(ck, 6 * 3600, json.dumps(results))
    return {"id": id, "results": results}
