# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DENO_INSTALL=/usr/local
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip \
 && curl -fsSL https://deno.land/install.sh | sh -s -- -y \
 && apt-get purge -y curl unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 audioflow \
 && mkdir -p /data /tmp/audioflow && chown audioflow:audioflow /data /tmp/audioflow
WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install .
# deploy/update-ytdlp.sh passa YTDLP_LATEST=1 para ignorar o pin do pyproject e pegar o yt-dlp mais novo.
ARG YTDLP_LATEST=0
ARG CACHEBUST=0
RUN if [ "$YTDLP_LATEST" = 1 ]; then pip install -U "yt-dlp[default]"; fi
COPY alembic.ini ./
COPY migrations ./migrations
USER audioflow
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]
