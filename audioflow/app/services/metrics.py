from prometheus_client import Counter, Gauge, Histogram, Info

jobs_total = Counter("audio_jobs_total", "Tarefas por status final", ["status"])
job_duration = Histogram("audio_job_duration_seconds", "Duração das tarefas",
                         buckets=(1, 5, 10, 30, 60, 120, 300, 600, 900))
job_failures = Counter("audio_job_failures_total", "Falhas por código", ["code"])
queue_depth = Gauge("audio_queue_depth", "Tarefas em fila")
output_bytes = Counter("audio_output_bytes_total", "Bytes de áudio gerados")
ytdlp_version = Info("ytdlp_version", "Versão do yt-dlp em uso")
http_latency = Histogram("http_request_duration_seconds", "Latência HTTP", ["method", "route", "status"])
source_blocked = Counter("audio_source_blocked_total", "Bloqueios do YouTube detectados")
