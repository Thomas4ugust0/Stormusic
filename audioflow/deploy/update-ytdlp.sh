#!/bin/sh
# Cron semanal: 0 4 * * 1 /home/ubuntu/audioflow/deploy/update-ytdlp.sh
# Reconstrói a imagem com o yt-dlp mais recente (o container é read_only, então não dá pip install em runtime).
set -e
cd "$(dirname "$0")/.."
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --pull --build-arg YTDLP_LATEST=1 --build-arg CACHEBUST=$(date +%s) api worker beat migrate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
