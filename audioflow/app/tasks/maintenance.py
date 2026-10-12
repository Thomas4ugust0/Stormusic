"""Rotinas periódicas: expiração, temporários órfãos, versão do yt-dlp, canário."""
import json
import urllib.request
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from app.core.config import Settings
from app.core.db import session_scope
from app.core.logging import log
from app.models import Job, JobStatus
from app.services import storage


def cleanup_expired(settings: Settings) -> int:
    now = datetime.now(UTC)
    stale = now - timedelta(hours=settings.result_ttl_hours * 2)
    n = 0
    with session_scope() as db:
        rows = db.scalars(select(Job).where(or_(
            Job.expires_at < now,
            (Job.status.in_([JobStatus.FAILED, JobStatus.CANCELLED])) & (Job.updated_at < stale),
        ))).all()
        for j in rows:
            storage.remove_file(j.file_path)
            db.delete(j)
            n += 1
    log.info("cleanup_expired", removed=n)
    return n


def cleanup_orphan_tmp(settings: Settings) -> int:
    with session_scope() as db:
        active = set(db.scalars(select(Job.id).where(Job.status == JobStatus.PROCESSING)))
    n = storage.cleanup_orphans(settings, active)
    if n:
        log.info("cleanup_orphan_tmp", removed=n)
    return n


def reset_stuck_jobs(settings: Settings) -> int:
    """No reinício do worker, tarefas 'processing' paradas além do timeout voltam à fila (acks_late as reentrega)."""
    limit = datetime.now(UTC) - timedelta(seconds=settings.job_timeout_seconds)
    with session_scope() as db:
        rows = db.scalars(select(Job).where(Job.status == JobStatus.PROCESSING, Job.updated_at < limit)).all()
        for j in rows:
            j.status, j.progress = JobStatus.QUEUED, 0
        return len(rows)


def latest_pypi_version(timeout: int = 10) -> str | None:
    try:
        with urllib.request.urlopen("https://pypi.org/pypi/yt-dlp/json", timeout=timeout) as r:  # noqa: S310
            return str(json.load(r)["info"]["version"])
    except Exception:  # noqa: BLE001
        return None


def check_ytdlp_update(current: str) -> str | None:
    latest = latest_pypi_version()
    if latest and latest != current:
        log.warning("ytdlp_update_available", current=current, latest=latest,
                    hint="rode `make update-ytdlp` e reconstrua as imagens")
    return latest
