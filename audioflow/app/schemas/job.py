from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AudioFormat = Literal["mp3", "wav", "m4a", "flac", "original"]
Quality = Literal["low", "medium", "high", "max"]
_URL_EX = "https://www.youtube.com/watch?v=VIDEO_ID"


class JobCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"examples": [{"source_url": _URL_EX, "format": "mp3", "quality": "high",
                                         "remove_sponsors": False, "terms_accepted": True}]},
    )
    source_url: str = Field(max_length=2048, description="URL de um vídeo público do YouTube.")
    format: AudioFormat = "mp3"
    quality: Quality = "high"
    remove_sponsors: bool = Field(False, description="Remove segmentos SponsorBlock (melhor esforço, serviço de terceiros).")
    terms_accepted: bool = Field(False, description="Confirma que você tem o direito de baixar e usar este conteúdo.")


class InspectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{"source_url": _URL_EX}]})
    source_url: str = Field(max_length=2048)


class JobCreated(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{
        "job_id": "job_9f2c1e7a4b8d4c3f9a1e5d6b7c8a0f12", "status": "queued", "format": "mp3",
        "message": "Tarefa criada com sucesso."}]})
    job_id: str
    status: str
    format: str
    message: str


class VideoInfoOut(BaseModel):
    id: str
    title: str | None = None
    uploader: str | None = None
    duration_seconds: float | None = None
    thumbnail_url: str | None = None


class SourceAudioOut(BaseModel):
    codec: str | None = None
    bitrate_kbps: float | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool
    request_id: str | None = None


class ErrorResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"error": {
        "code": "video_private", "message": "Este vídeo é privado e não pode ser processado.",
        "retryable": False, "request_id": "req_abc123"}}]})
    error: ErrorBody


class JobStatusOut(BaseModel):
    job_id: str
    status: str
    progress: int
    format: str
    quality: str
    video: VideoInfoOut | None = None
    source_audio: SourceAudioOut | None = None
    estimated_size_bytes: int | None = None
    size_bytes: int | None = None
    download_available: bool
    expires_at: datetime | None = None
    warnings: list[str] = []
    error: ErrorBody | None = None
    created_at: datetime
    updated_at: datetime


class InspectOut(BaseModel):
    video: VideoInfoOut
    source_audio: SourceAudioOut
    estimated_size_bytes: int | None = None
    limitations: list[str] = []
    processable: bool
    error: ErrorBody | None = None
