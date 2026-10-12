import hashlib
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Job, JobStatus


def cache_key(video_id: str, fmt: str, quality: str, remove_sponsors: bool) -> str:
    q = quality if fmt in ("mp3", "m4a") else "-"
    return hashlib.sha256(f"{video_id}|{fmt}|{q}|{int(remove_sponsors)}".encode()).hexdigest()


def find_cached(db: Session, key: str, exclude_id: str) -> Job | None:
    now = datetime.now(UTC)
    rows = db.scalars(
        select(Job).where(Job.cache_key == key, Job.status == JobStatus.COMPLETED, Job.id != exclude_id)
        .order_by(Job.created_at.desc()).limit(5)
    )
    for j in rows:
        exp = j.expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=UTC)
        if j.file_path and Path(j.file_path).exists() and (exp is None or exp > now):
            return j
    return None
