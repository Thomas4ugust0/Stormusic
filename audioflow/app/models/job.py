from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class JobStatus:
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ACTIVE = (QUEUED, PROCESSING)
    FINAL = (COMPLETED, FAILED, CANCELLED)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    api_key_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_id: Mapped[str] = mapped_column(String(11), index=True)
    source_url: Mapped[str] = mapped_column(String(64))
    format: Mapped[str] = mapped_column(String(10))
    quality: Mapped[str] = mapped_column(String(10))
    remove_sponsors: Mapped[bool] = mapped_column(Boolean, default=False)
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(12), index=True, default=JobStatus.QUEUED)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    video: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    source_audio: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    estimated_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_ext: Mapped[str | None] = mapped_column(String(8), nullable=True)
    download_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_retryable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
