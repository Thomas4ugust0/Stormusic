from app.core.config import get_settings
from app.core.errors import TransientJobError
from app.core.logging import log
from app.core.redis import get_redis
from app.services.extractor import YtDlpSource
from app.services.ratelimit import hit
from app.tasks import maintenance
from app.tasks.celery_app import celery
from app.tasks.pipeline import process_job

MAX_RETRIES = 3


@celery.task(name="audioflow.run_job", bind=True, acks_late=True, max_retries=MAX_RETRIES)
def run_job(self, job_id: str) -> str:  # type: ignore[no-untyped-def]
    settings = get_settings()
    # Limite global de extrações/hora (bem abaixo do limite de sessões convidadas do YouTube).
    lim = hit(get_redis(), "global:extractions", settings.global_extractions_per_hour, 3600)
    if not lim.allowed:
        log.warning("global_extraction_limit", job_id=job_id, retry_in=lim.reset_in)
        raise self.retry(countdown=lim.reset_in, max_retries=None)
    try:
        return process_job(job_id, YtDlpSource(settings), settings, final_attempt=self.request.retries >= MAX_RETRIES)
    except TransientJobError as e:
        raise self.retry(exc=e, countdown=min(600, 30 * 2 ** self.request.retries)) from e


@celery.task(name="audioflow.cleanup")
def cleanup() -> int:
    s = get_settings()
    return maintenance.cleanup_expired(s) + maintenance.cleanup_orphan_tmp(s)


@celery.task(name="audioflow.check_ytdlp")
def check_ytdlp() -> str | None:
    return maintenance.check_ytdlp_update(YtDlpSource(get_settings()).version())


@celery.task(name="audioflow.canary")
def canary() -> bool:
    """Verifica o extrator com um vídeo curto Creative Commons (CANARY_VIDEO_URL)."""
    s = get_settings()
    if not s.canary_video_url:
        return True
    try:
        info = YtDlpSource(s).inspect(s.canary_video_url)
        log.info("canary_ok", duration=info.duration)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("canary_failed", error=str(e)[:300])
        return False


def enqueue(job_id: str) -> None:
    run_job.apply_async(args=[job_id], task_id=job_id)
