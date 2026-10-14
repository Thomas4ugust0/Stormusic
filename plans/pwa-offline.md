> **Legado / superado:** o modo principal agora roda no celular. Consulte [PHONE.md](../docs/PHONE.md). Este documento descreve somente a arquitetura anterior.

# PWA instalável + Supermix offline (25 faixas)

## Decisões
- Backend: VPS grátis Oracle Cloud (ARM Ampere), `docker compose` do `audioflow/`, HTTPS obrigatório (PWA/Service Worker exigem origem segura).
- Supermix diária: 25 músicas (~75 MB, m4a ~128 kbps).
- Retenção: só a mix mais recente fica no cache; a anterior é apagada após a nova baixar 100%.

## 1. Backend na Oracle Cloud
1. Criar VM `VM.Standard.A1.Flex` (Ubuntu 22.04 ARM, 2 OCPU/12 GB). Abrir portas 80/443 na Security List e no `iptables` da VM.
2. Instalar Docker + compose plugin; clonar `audioflow/`; confirmar que as imagens (python, postgres, redis, ffmpeg) são multi-arch (arm64) — ajustar `Dockerfile` se usar base amd64.
3. Domínio grátis (DuckDNS) + Caddy como proxy reverso (`caddy` service no compose, `reverse_proxy api:8000`) com TLS automático.
4. `.env` de produção: `AUTH_ENABLED=true` com uma API key (já suportado por `AudioFlowCfg.key`), `CORS_ORIGINS=https://<origem-do-frontend>`, senha forte do Postgres.
5. yt-dlp: cron semanal `docker compose exec api pip install -U yt-dlp` (IPs de datacenter podem receber bloqueio; mitigação: cookies opcionais do yt-dlp via volume).

## 2. Frontend como PWA
- Adicionar `vite-plugin-pwa` (Workbox, `registerType: 'autoUpdate'`).
- `manifest`: nome "Music", `display: standalone`, `theme_color/background_color` escuros, `orientation: portrait`, ícones 192/512 + maskable em `public/`.
- Precache do app shell (JS/CSS/HTML/ícones); `navigateFallback: index.html`.
- Runtime cache: thumbnails (`CacheFirst`, cache `thumbs`, 200 entradas); chamadas `/api/v1/audio/search|related` `NetworkFirst` com timeout 4s.
- Hospedar o frontend estático (build) no mesmo Caddy da VM (mesma origem → sem CORS) — `pnpm build` e copiar `dist/` para o volume do Caddy.
- Default de `getAudioFlow().url` = origem da página quando servido em HTTPS.

## 3. Download offline da Supermix
Novo módulo `src/lib/offline.ts`:
- `downloadMix(mix: Mix, onProgress)`: para cada faixa, `resolveAudio` → `fetch` do áudio completo (sem Range) → `caches.open('mix-<at>').put('/offline/<ytId>', resp)`. Concorrência 2, retry 2x, faixa que falhar é pulada.
- Ao concluir: grava `localStorage['ytm.offlineMix'] = {at, ids}` e apaga outros caches `mix-*` (regra "só a mais recente").
- `offlineUrl(ytId)`: se cacheado, retorna `URL.createObjectURL(blob)`; integrar em `resolveAudio` como primeira fonte (`source: 'offline'`).
- `navigator.storage.persist()` na primeira execução; checar `storage.estimate()` e avisar se < 150 MB.
- Gatilhos: ao gerar uma nova Supermix (já a cada 12h em `taste.ts`, `size=25`) e o app estar aberto em Wi-Fi/online. Sem Background Sync periódico garantido no Android → download ocorre quando o app é aberto.
- Offline (`navigator.onLine === false`): a tela Supermix toca apenas faixas cacheadas; busca/rádio mostram estado "sem conexão".

## 4. UI
- Na Supermix: badge "Disponível offline" / barra de progresso "Baixando 12/25"; botão manual "Baixar agora".
- Configurações: espaço usado, botão "Limpar offline".
- Prompt de instalação (`beforeinstallprompt`) com botão "Instalar app".
- Sinais de gosto gerados offline ficam no localStorage (já é o caso) e são usados na próxima geração.

## Verificação
- Lighthouse PWA "installable" no Chrome Android; instalar pela tela inicial.
- Baixar mix, ativar modo avião, tocar as 25 faixas, pular, curtir.
- Forçar nova geração: cache antigo removido, só `mix-<novo at>` em DevTools > Cache Storage.
- Reiniciar o celular e confirmar que o cache persiste.
