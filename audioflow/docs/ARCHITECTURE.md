# Arquitetura

```
cliente ─HTTP─▶ api (FastAPI) ──▶ PostgreSQL (jobs, api_keys)
                   │  enqueue
                   ▼
                 Redis ◀── worker (Celery) ──▶ yt-dlp ─▶ YouTube
                   ▲          │                 SponsorBlock (opcional)
                 beat         ▼
          (limpeza, canário)  FFmpeg ─▶ /data (volume, TTL)
```

## Módulos

| Caminho | Responsabilidade |
|---|---|
| `app/api/` | Rotas, autenticação (`deps.py`), streaming com Range (`files.py`), health/métricas |
| `app/core/` | Configuração, banco, Redis, erros tipados, logging estruturado, segurança |
| `app/services/url_validator.py` | Allowlist de hosts e normalização para `watch?v=ID` (anti-SSRF) |
| `app/services/extractor.py` | Única fronteira com o yt-dlp (`AudioSource`); substituível em testes |
| `app/services/error_mapping.py` | Converte exceções do yt-dlp em códigos estáveis da API |
| `app/services/converter.py` | FFmpeg/ffprobe: conversão, metadados, capa, verificação de duração |
| `app/services/cache.py`, `storage.py` | Reuso de resultados idênticos; arquivos e nomes seguros |
| `app/tasks/pipeline.py` | Pipeline do worker: inspecionar → baixar → converter → verificar → publicar |
| `app/tasks/jobs.py`, `maintenance.py` | Tarefas Celery, retentativas, limite global, limpeza |

## Ciclo de vida de uma tarefa

`queued → processing → completed | failed | cancelled`. O progresso é monotônico (0–100).
Cancelamento é cooperativo: a API grava uma flag no Redis que o worker verifica durante o download.
Falhas transitórias (bloqueio temporário, timeout de rede) são reprocessadas com backoff exponencial;
as definitivas (privado, removido, restrição de idade, ao vivo) falham imediatamente com código específico.

## Isolamento

Cada tarefa usa um diretório temporário próprio, removido ao final. Os contêineres rodam como usuário
não-root, com sistema de arquivos somente-leitura, `cap_drop: ALL` e `no-new-privileges`.
Resultados expiram após `RESULT_TTL_HOURS` e são apagados pelo `beat`.
