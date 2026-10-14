> **Legado / superado:** o modo principal agora roda no celular. Consulte [PHONE.md](../docs/PHONE.md). Este documento descreve somente a arquitetura anterior.

# AudioFlow API

API REST para extrair o áudio de vídeos **públicos** do YouTube, entregue **sem anúncios**
(anúncios são inseridos pelo player e nunca fazem parte dos streams baixados). Formatos: `mp3`, `m4a`,
`wav`, `flac` e `original` (sem recodificação). Remoção opcional de patrocínios via SponsorBlock.

> Use apenas com conteúdo que você tem o direito de baixar. Leia [docs/LEGAL.md](docs/LEGAL.md).

## Subindo com Docker

```sh
cp .env.example .env          # ajuste API_KEY_PEPPER e POSTGRES_PASSWORD
make up                       # baixa assets da doc, builda, roda migrações e sobe api/worker/beat
make key NAME=meu-cliente     # imprime a API key (exibida uma única vez)
```

A API fica em `http://127.0.0.1:8000`; documentação em `/docs` (Swagger) e `/redoc`, servidas localmente.

## Uso

```sh
KEY=af_...
curl -s -X POST localhost:8000/api/v1/audio/jobs -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"source_url":"https://www.youtube.com/watch?v=VIDEO_ID","format":"mp3","quality":"high","terms_accepted":true}'
# => 202 {"job_id":"job_...","status":"queued",...}

curl -s localhost:8000/api/v1/audio/jobs/job_... -H "X-API-Key: $KEY"          # status + progresso
curl -OJ localhost:8000/api/v1/audio/jobs/job_.../download -H "X-API-Key: $KEY" # arquivo (suporta Range)
curl -X DELETE localhost:8000/api/v1/audio/jobs/job_... -H "X-API-Key: $KEY"    # cancela / remove
```

`POST /api/v1/audio/inspect` valida a URL e retorna metadados sem baixar nada.

| Endpoint | Descrição |
|---|---|
| `POST /api/v1/audio/jobs` | Cria tarefa (202) |
| `GET /api/v1/audio/jobs/{id}` | Status, progresso, metadados, erro |
| `GET /api/v1/audio/jobs/{id}/download` | Download em streaming (200/206, 409 se não pronto, 410 se expirado) |
| `DELETE /api/v1/audio/jobs/{id}` | 202 cancela ativa; 204 remove concluída |
| `POST /api/v1/audio/inspect` | Pré-validação |
| `GET /health`, `/health/ready`, `/metrics` | Operação (métricas só em rede interna ou com `METRICS_TOKEN`) |

Erros seguem sempre `{"error": {"code", "message", "retryable", "request_id"}}`.

## Desenvolvimento

```sh
make install && make test     # SQLite + fakeredis + FFmpeg real; sem acesso à rede
make lint typecheck security
```

Mais detalhes: [ARCHITECTURE](docs/ARCHITECTURE.md) · [DECISIONS](docs/DECISIONS.md) · [LEGAL](docs/LEGAL.md).
