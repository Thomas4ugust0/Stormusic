from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _csv(v: object) -> list[str]:
    if isinstance(v, str):
        return [x.strip().lower() if "://" not in x else x.strip() for x in v.split(",") if x.strip()]
    return list(v)  # type: ignore[call-overload]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "AudioFlow API"
    auth_enabled: bool = True
    api_key_pepper: str = ""
    database_url: str = "postgresql+psycopg://audioflow:audioflow@postgres:5432/audioflow"
    redis_url: str = "redis://redis:6379/0"
    storage_dir: str = "/data"
    tmp_dir: str = "/tmp/audioflow"  # noqa: S108 - diretório dedicado, isolado por tarefa
    allowed_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "youtube.com", "www.youtube.com", "m.youtube.com",
            "music.youtube.com", "youtu.be", "www.youtube-nocookie.com",
        ]
    )
    max_duration_seconds: int = 7200
    max_file_size_mb: int = 200
    job_timeout_seconds: int = 900
    max_concurrent_jobs: int = 4
    max_concurrent_jobs_per_key: int = 2
    queue_max_length: int = 200
    rate_limit_per_minute: int = 20
    global_extractions_per_hour: int = 120
    result_ttl_hours: int = 24
    cache_enabled: bool = True
    require_terms_acceptance: bool = True
    sponsorblock_categories: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["sponsor", "selfpromo", "interaction"]
    )
    ytdlp_options_json: str = "{}"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)
    log_level: str = "INFO"
    metrics_token: str = ""
    min_free_disk_mb: int = 500
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    deno_bin: str = "deno"
    canary_video_url: str = ""
    worker_metrics_port: int = 9101

    @field_validator("allowed_hosts", "sponsorblock_categories", "cors_origins", mode="before")
    @classmethod
    def split_csv(cls, v: object) -> list[str]:
        return _csv(v)

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
