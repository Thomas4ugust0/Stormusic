# Arquitetura

```text
Chrome / PWA (localhost:8787)
  ├── React: catálogo, busca, gosto, rádio e Supermix
  ├── Cache Storage: áudio integral + capas
  └── API de mesma origem
       └── Node no Termux, 127.0.0.1:8787
            ├── standalone.ts: dist/, MIME, SPA e proteção de caminhos/Host
            ├── relay.ts: resolve + áudio com Range e uma renovação em 403/410
            ├── music.ts: busca/rádio, filtros e caches
            ├── runtime.ts: processos limitados, execFile, erros e LRU
            └── admin.ts: atualizações, rollback e estado persistido
                 └── yt-dlp + yt-dlp-ejs + Node → YouTube pelo IP do celular
```

## Contratos

- `GET /api/resolve/:id`: URL local de áudio, duração, MIME, bitrate e fonte.
- `GET|HEAD /api/audio?id=`: stream completo ou intervalo único `Range`; reextrai uma vez em 403/410 usando a URL nova.
- `GET /api/v1/audio/search?q=&limit=` e `/related?id=&limit=`: `{query|id, results:[{id,title,artist,album,duration}]}`.
- `GET /health` e `/api/admin/update-status`: saúde, versão, runtime e estado da atualização.
- `POST /api/admin/update-ytdlp` e `/update-app`: sem corpo ou parâmetros; exigem `Sec-Fetch-Site: same-origin` e `X-Stormusic: 1`.
- Erros: `{error:{code,message,retryable}}`, sem logs de processos ou credenciais no cliente.

Extrações usam `--ignore-config` para não herdar cookies/proxies antigos. Concor­rência padrão 2; até 120 extrações por hora, incluindo tentativas de busca/rádio. Cache LRU de até 200 resultados por área; pesquisa por 10 min, rádio por 6 h, streams até a expiração. A fila reúne resoluções idênticas. Piped/Invidious só participa se explicitamente habilitado.

No frontend, `ytm.mode` é `local` por padrão; AudioFlow exige seleção explícita em Avançado. O modo local nunca substitui uma falha por demo. Downloads gravam áudio integral e duas capas por faixa. Um mix novo só substitui o anterior após conclusão completa; tentativas parciais podem ser retomadas. Durações resolvidas são persistidas no metadata sem alterar os sinais de gosto nem a composição 80/20.

O supervisor Termux usa `flock` para impedir duplicatas, PID informativo, wake lock, reinício e log de no máximo 1 MiB. O updater do app aceita somente checkout limpo na branch `phone-dist`, valida arquivos antes de resetar e tenta restaurar o commit anterior em falha de verificação. Não é um atualizador do checkout de desenvolvimento.

## Configuração do servidor

| Variável | Padrão |
| --- | --- |
| `RELAY_HOST`, `RELAY_PORT` | `127.0.0.1`, `8787` |
| `WEB_DIR` | `dist/` junto ao projeto |
| `YTDLP_PATH` | `yt-dlp` |
| `RELAY_CONCURRENCY` | `2` |
| `RELAY_MAX_RESOLVES_PER_HOUR` | `120` |
| `RELAY_PUBLIC_FALLBACK` | desligado; `1` habilita |
| `RELAY_CORS_ORIGIN` | nenhum; aceita uma origem exata, nunca `*` |
| `RELAY_PIP`, `RELAY_GIT` | `pip`, `git` |
| `RELAY_STATE_DIR` | `~/.stormusic` |
| `RELAY_AUTO_UPDATE_DAYS` | `7`; `0` desliga |
| `RELAY_APP_DIR` | raiz do pacote; usado também para isolar testes |

Oracle, Celery, Redis, Postgres e ffmpeg permanecem somente em `audioflow/`, marcado como legado.
