"""Pipeline de uma tarefa (seção 6). Independente do Celery para ser testável."""
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.core.config import Settings
from app.core.db import session_scope
from app.core.errors import JobError, TransientJobError
from app.core.logging import log
from app.core.redis import is_cancelled
from app.models import Job, JobStatus
from app.services import converter, metrics, storage
from app.services.cache import find_cached
from app.services.extractor import AudioSource, classify


class Progress:
    """Progresso monotônico, persistido com no máximo ~2 escritas/s."""

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.value = 0
        self._last_write = 0.0

    def set(self, v: float, force: bool = False) -> None:
        iv = int(max(self.value, min(100, v)))
        if iv == self.value and not force:
            return
        self.value = iv
        now = time.monotonic()
        if force or now - self._last_write > 0.5:
            self._last_write = now
            with session_scope() as db:
                j = db.get(Job, self.job_id)
                if j and j.status == JobStatus.PROCESSING:
                    j.progress = iv

    def span(self, lo: float, hi: float):  # type: ignore[no-untyped-def]
        return lambda frac: self.set(lo + (hi - lo) * frac)


def _update(job_id: str, **fields: object) -> None:
    with session_scope() as db:
        j = db.get(Job, job_id)
        if j:
            for k, v in fields.items():
                setattr(j, k, v)


def _fail(job_id: str, err: JobError) -> None:
    status = JobStatus.CANCELLED if err.code == "cancelled" else JobStatus.FAILED
    _update(job_id, status=status, error_code=err.code, error_message=err.message, error_retryable=err.retryable)
    metrics.jobs_total.labels(status=status).inc()
    metrics.job_failures.labels(code=err.code).inc()
    if err.code == "source_blocked":
        metrics.source_blocked.inc()
    log.warning("job_failed", job_id=job_id, code=err.code, detail=(err.detail or "")[:300])


def process_job(job_id: str, source: AudioSource, settings: Settings, *, final_attempt: bool = True) -> str:
    """Executa a tarefa. Retorna o status final. Levanta TransientJobError se não for a última tentativa."""
    started = time.monotonic()
    deadline = started + settings.job_timeout_seconds
    with session_scope() as db:
        job = db.get(Job, job_id)
        if job is None or job.status in JobStatus.FINAL:
            return job.status if job else "missing"
        if is_cancelled(job_id):
            job.status, job.error_code = JobStatus.CANCELLED, "cancelled"
            job.error_message, job.error_retryable = JobError("cancelled").message, False
            return JobStatus.CANCELLED
        job.status, job.attempts = JobStatus.PROCESSING, job.attempts + 1
        snapshot = {c: getattr(job, c) for c in ("source_url", "format", "quality", "remove_sponsors", "cache_key")}

    prog = Progress(job_id)
    cancel = lambda: is_cancelled(job_id)  # noqa: E731
    workdir = storage.job_tmp_dir(settings, job_id)
    warnings: list[str] = []
    try:
        prog.set(1, force=True)
        # 2. Cache
        if settings.cache_enabled:
            with session_scope() as db:
                hit = find_cached(db, snapshot["cache_key"], job_id)
                if hit and hit.file_path:
                    dst = storage.final_path(settings, job_id, hit.file_ext or "bin")
                    storage.link_or_copy(Path(hit.file_path), dst)
                    job = db.get(Job, job_id)
                    assert job is not None
                    job.video, job.source_audio = hit.video, hit.source_audio
                    job.file_path, job.file_ext, job.download_name = str(dst), hit.file_ext, hit.download_name
                    job.size_bytes, job.estimated_size_bytes = hit.size_bytes, hit.estimated_size_bytes
                    job.warnings = list(hit.warnings or []) + ["Resultado reaproveitado do cache."]
                    job.expires_at = datetime.now(UTC) + timedelta(hours=settings.result_ttl_hours)
                    job.status, job.progress = JobStatus.COMPLETED, 100
                    metrics.jobs_total.labels(status="completed").inc()
                    log.info("job_cache_hit", job_id=job_id)
                    return JobStatus.COMPLETED

        # 3. Inspeção
        info = source.inspect(snapshot["source_url"])
        classify(info, settings)
        _update(job_id, video=info.public(), estimated_size_bytes=info.estimated_size_bytes,
                source_audio={"codec": info.codec, "bitrate_kbps": info.bitrate_kbps})
        prog.set(5, force=True)
        if cancel():
            raise JobError("cancelled")

        # 4. Download (5-60%)
        dl = source.download(snapshot["source_url"], workdir, remove_sponsors=snapshot["remove_sponsors"],
                             on_progress=prog.span(5, 60), should_cancel=cancel, deadline=deadline)
        if dl.audio_path.stat().st_size > settings.max_file_size_bytes:
            raise JobError("file_too_large")
        src = converter.probe(dl.audio_path, settings.ffprobe_bin)
        src_codec = src["codec"] or info.codec
        src_kbps = src["bitrate_kbps"] or info.bitrate_kbps
        _update(job_id, source_audio={"codec": src_codec, "bitrate_kbps": src_kbps})
        prog.set(60, force=True)

        # 5. Conversão (60-95%)
        fmt = snapshot["format"]
        cover = None
        if dl.thumbnail_path and fmt in ("mp3", "m4a", "flac"):
            cover = converter.prepare_cover(dl.thumbnail_path, workdir, settings.ffmpeg_bin)
        plan, qwarn = converter.plan(fmt, snapshot["quality"], src_codec, src_kbps, dl.audio_path.suffix,
                                     cover is not None)
        warnings += qwarn
        meta = converter.Metadata(title=info.title, artist=info.uploader,
                                  date=(info.upload_date or "")[:4] or None,
                                  comment=f"https://www.youtube.com/watch?v={info.id}")
        remaining = max(5.0, deadline - time.monotonic())
        out = converter.convert(dl.audio_path, workdir, plan, meta, cover, duration=src["duration"] or info.duration,
                                ffmpeg=settings.ffmpeg_bin, timeout=remaining, should_cancel=cancel,
                                on_progress=prog.span(60, 95))
        result = converter.probe(out, settings.ffprobe_bin)

        # Verificação "sem anúncios": duração igual à do vídeo (±1 s)
        if info.duration:
            diff = abs(result["duration"] - info.duration)
            if snapshot["remove_sponsors"]:
                if dl.sponsor_segments_removed == 0:
                    warnings.append("Nenhum segmento de patrocínio encontrado no SponsorBlock; o áudio está completo.")
                else:
                    warnings.append(f"{dl.sponsor_segments_removed} segmento(s) de patrocínio removido(s) "
                                    f"({diff:.0f} s a menos que o vídeo) via SponsorBlock (melhor esforço).")
            elif diff > 1.0:
                warnings.append(f"A duração do áudio difere {diff:.1f} s da duração informada do vídeo.")
        if not snapshot["remove_sponsors"]:
            warnings.append("Patrocínios inseridos pelo próprio criador fazem parte do conteúdo e não foram "
                            "removidos (use remove_sponsors=true para tentar removê-los).")

        # 6. Armazenamento
        size = out.stat().st_size
        if size > settings.max_file_size_bytes:
            raise JobError("file_too_large")
        dst = storage.final_path(settings, job_id, plan.ext)
        storage.store(out, dst)
        _update(job_id, status=JobStatus.COMPLETED, progress=100, file_path=str(dst), file_ext=plan.ext,
                size_bytes=size, warnings=warnings,
                download_name=storage.sanitize_filename(info.title, plan.ext),
                expires_at=datetime.now(UTC) + timedelta(hours=settings.result_ttl_hours))
        metrics.jobs_total.labels(status="completed").inc()
        metrics.output_bytes.inc(size)
        log.info("job_completed", job_id=job_id, size=size, seconds=round(time.monotonic() - started, 2))
        return JobStatus.COMPLETED
    except JobError as e:
        if isinstance(e, TransientJobError) and not final_attempt:
            _update(job_id, status=JobStatus.QUEUED, progress=0)
            raise
        _fail(job_id, e)
        return JobStatus.CANCELLED if e.code == "cancelled" else JobStatus.FAILED
    except Exception as e:  # noqa: BLE001
        log.exception("job_internal_error", job_id=job_id)
        _fail(job_id, JobError("internal_error", str(e)[:300]))
        return JobStatus.FAILED
    finally:
        storage.remove_tree(workdir)  # 7. limpeza sempre
        metrics.job_duration.observe(time.monotonic() - started)
