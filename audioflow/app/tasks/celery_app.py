from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_ready

from app.core.config import get_settings
from app.core.logging import log, setup_logging

settings = get_settings()
setup_logging(settings.log_level)

celery = Celery("audioflow", broker=settings.redis_url, include=["app.tasks.jobs"])
celery.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="audio",
    broker_connection_retry_on_startup=True,
    task_ignore_result=True,
    beat_schedule={
        "cleanup-expired": {"task": "audioflow.cleanup", "schedule": 900.0},
        "ytdlp-version": {"task": "audioflow.check_ytdlp", "schedule": crontab(hour=6, minute=0)},
        "canary": {"task": "audioflow.canary", "schedule": crontab(hour=7, minute=0)},
    },
)


@worker_ready.connect
def _on_ready(**_: object) -> None:
    from prometheus_client import start_http_server

    from app.services.converter import tool_version
    from app.services.extractor import YtDlpSource
    from app.services.metrics import ytdlp_version
    from app.tasks.maintenance import cleanup_orphan_tmp, reset_stuck_jobs

    if not tool_version(settings.deno_bin, "--version"):
        log.error("deno_missing", hint="yt-dlp precisa de um runtime JS (Deno) para o YouTube")
    if not tool_version(settings.ffmpeg_bin):
        log.error("ffmpeg_missing")
    ytdlp_version.info({"version": YtDlpSource(settings).version()})
    log.info("worker_ready", orphans_removed=cleanup_orphan_tmp(settings), requeued=reset_stuck_jobs(settings))
    try:
        start_http_server(settings.worker_metrics_port)
    except OSError:
        log.warning("worker_metrics_port_busy")
