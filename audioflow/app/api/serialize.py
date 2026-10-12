from datetime import UTC, datetime
from pathlib import Path

from app.core.errors import JobError
from app.models import Job, JobStatus
from app.schemas.job import ErrorBody, JobStatusOut, SourceAudioOut, VideoInfoOut


def aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def is_expired(job: Job) -> bool:
    exp = aware(job.expires_at)
    return exp is not None and exp <= datetime.now(UTC)


def to_status(job: Job, request_id: str | None = None) -> JobStatusOut:
    available = (job.status == JobStatus.COMPLETED and not is_expired(job)
                 and bool(job.file_path) and Path(job.file_path or "").exists())
    err = None
    if job.error_code:
        je = JobError(job.error_code)
        err = ErrorBody(code=je.code, message=job.error_message or je.message,
                        retryable=bool(job.error_retryable), request_id=request_id)
    return JobStatusOut(
        job_id=job.id, status=job.status, progress=job.progress, format=job.format, quality=job.quality,
        video=VideoInfoOut(**job.video) if job.video else None,
        source_audio=SourceAudioOut(**job.source_audio) if job.source_audio else None,
        estimated_size_bytes=job.estimated_size_bytes, size_bytes=job.size_bytes, download_available=available,
        expires_at=aware(job.expires_at), warnings=list(job.warnings or []), error=err,
        created_at=aware(job.created_at) or datetime.now(UTC), updated_at=aware(job.updated_at) or datetime.now(UTC),
    )
