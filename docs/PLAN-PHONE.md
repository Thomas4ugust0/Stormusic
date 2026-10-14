# Stormusic — plano de implementação: extração no próprio celular

Preparado em 12/10/2026 a partir da análise do `Stormusic.zip`. Pensado para ser executado pelo GPT Astra (light), etapa por etapa, com prompt mestre e prompts de etapa no final.

## 1. Decisão e escopo

**Por quê.** O IP da VM da Oracle é de datacenter. No teste de hoje, 4 de 5 vídeos falharam nos 7 clients do yt-dlp testados, enquanto os mesmos vídeos listaram formatos normalmente no Termux do celular. Sem proxy pago, a extração precisa sair do IP do celular.

**Decisão.** O celular roda tudo: um servidor Node local (no Termux) serve o PWA e faz a extração com yt-dlp, na mesma origem `http://localhost:8787`. A Oracle e o AudioFlow (Python, Celery, Postgres, Redis, Caddy) saem do caminho crítico.

**Escopo.** Uso pessoal, Android com Chrome, Termux. Fora de escopo: iOS, multiusuário, API keys, conversão para MP3, SponsorBlock e migração de dados (não há dados a preservar). A VM da Oracle será desligada, sem espelho do PWA.

**Requisito de interface.** O app deve funcionar como hoje, sem perda visual: nome, artista, álbum, duração, capas e arte da notificação. Tudo isso já vem da API de busca e rádio e das capas do `i.ytimg.com`; nada depende de tags embutidas no arquivo, então tocar o m4a original não muda a interface.

**Requisito de operação.** Depois da instalação inicial, o dia a dia não pode exigir terminal: o servidor sobe sozinho com o celular, o yt-dlp e o app se atualizam por botões dentro do app, e um atalho na tela inicial religa o servidor com um toque.

**Dispositivo.** Samsung Galaxy Z Flip 4 (One UI), Chrome, e os apps Termux, Termux:Boot e Termux:Widget instalados pelo F-Droid.

**Achado principal da análise:** o repositório já contém a peça certa. `server/standalone.ts` foi escrito para rodar no Termux e `src/lib/stream.ts` já cai para `/api/resolve`. O que falta é: busca e rádio fora do AudioFlow, servir o PWA a partir do próprio servidor local, e tirar o AudioFlow da frente.

## 2. Mapa do projeto atual

| Área | Arquivos | Função | Destino |
| --- | --- | --- | --- |
| PWA (React 19, Vite 8, Tailwind v4) | `src/App.tsx` (\~40 KB, monolito), `src/index.css`, `vite.config.ts` | UI, player, abas, configurações; PWA via vite-plugin-pwa (Workbox) | Mantém; ajustes pontuais |
| Resolução de áudio | `src/lib/stream.ts` | Cascata: AudioFlow, depois relay (`/api/resolve`), depois Piped, depois demo | Reescrever a cascata (modo local) |
| Offline | `src/lib/offline.ts` | Supermix de 25 faixas em Cache Storage (`mix-<at>`) via `fetchAudioBlob` | Mantém; troca a fonte do blob |
| Gosto e Supermix | `src/lib/taste.ts`, `supermix.ts`, `data.ts` | Sinais, mix 80/20, catálogo estático de 42 faixas; usa `relatedMusic` | Não alterar a lógica |
| Relay Node | `server/relay.ts`, `server/standalone.ts` | `/api/resolve/:id` (yt-dlp local, depois Piped/Invidious) e `/api/audio` com Range | Base do novo servidor local |
| AudioFlow | `audioflow/` | FastAPI, Celery, Postgres, Redis, Caddy; jobs assíncronos; `search` e `related` via yt-dlp | Legado (fora do caminho) |
| Planos e docs | `plans/pwa-offline.md`, `audioflow/docs/*`, `AGENTS.md` | Plano antigo (Oracle + Caddy), convenções do Figma Make | Arquivar o plano; respeitar `AGENTS.md` |

## 3. Achados no código que o Opus precisa tratar

1. **AudioFlow sempre é tentado primeiro.** `getAudioFlow()` e `pageHostAF()` em `stream.ts` preenchem `url` automaticamente (`http://<host>:8000`), então `afReady()` é sempre verdadeiro e cada faixa gasta uma tentativa inútil antes de cair no relay.
2. **Busca e Supermix dependem do AudioFlow.** `searchMusic` e `relatedMusic` exigem `getAudioFlow().url`; `taste.ts` chama `relatedMusic` para gerar a Supermix. O relay não tem esses endpoints.
3. **O download offline só funciona via AudioFlow.** `fetchAudioBlob` (usado por `offline.ts`) chama `viaAudioFlow`.
4. **Relay inseguro para rodar no celular.** Em `relay.ts`: CORS `*`, bind em `0.0.0.0` (em `standalone.ts`), sem limite de processos yt-dlp simultâneos, cache sem limite e pool de Piped/Invidious consultado a cada 30 min.
5. **Origem nova.** O PWA passa a viver em `localhost`, com `localStorage` e Cache Storage vazios. Como não há dados a preservar, não há migração: o app começa limpo.
6. **Chrome e rede local.** O Chrome exige permissão do usuário quando um site público faz requisições à rede local ou ao localhost (Local Network Access). Servir o PWA do próprio localhost evita isso: origem igual, sem prompt e sem mixed content.
7. **Documentação desatualizada.** O plano em `plans/pwa-offline.md` e o `deploy/README.md` descrevem a Oracle como destino.
8. **Nome, duração e capas.** Nome, artista e álbum vêm de `SearchHit` (via `hitToTrack`); a duração vem de `duration` na busca ou de `/api/resolve`; as capas e a arte da notificação (`MediaSession`) vêm de `thumb()` em `data.ts`, ou seja, `https://i.ytimg.com/vi/<id>/hqdefault.jpg`. Se a busca vier sem `duration`, a linha da faixa fica sem o tempo. O Service Worker só guarda capas já vistas (cache `thumbs`, `CacheFirst`), então uma Supermix baixada pode ficar sem capas em modo avião.
9. **Atualização sem terminal.** Hoje o AudioFlow só avisa que há versão nova do yt-dlp (`check_ytdlp_update`); quem atualiza é o script `deploy/update-ytdlp.sh`, no servidor. No celular é preciso um endpoint no servidor local e botões no app.

## 4. Arquitetura-alvo

```
Celular Android (Galaxy Z Flip 4)
├─ Chrome (PWA instalado em http://localhost:8787)
│    ├─ UI, taste/supermix, Cache Storage (offline)
│    ├─ painel "Motor local": atualizar yt-dlp, atualizar app
│    └─ fetch same-origin → /api/...
├─ Termux:Boot   → inicia o servidor quando o celular liga
├─ Termux:Widget → atalho na tela inicial que inicia o servidor
└─ Termux: node server/standalone.ts (127.0.0.1:8787)
     ├─ serve dist/ (PWA) com fallback SPA
     ├─ /api/resolve/:id e /api/audio?id=  (yt-dlp + proxy de bytes com Range)
     ├─ /api/v1/audio/search e /related    (yt-dlp --flat-playlist)
     ├─ /api/admin/update-ytdlp e update-app (pip e git, com proteção)
     └─ /health                            (versão do yt-dlp, estado da atualização)
          └─ yt-dlp + Node (desafio JS) → YouTube, com o IP do celular
```

## 5. Decisões

| Decisão | Motivo |
| --- | --- |
| PWA servido pelo próprio servidor local | Mesma origem; sem CORS, sem prompt de rede local, instalável e com service worker em `localhost` |
| Reaproveitar `relay.ts` em vez do AudioFlow | Sem Postgres, Redis ou Celery no celular; o PWA toca o m4a original, então o ffmpeg não é necessário |
| Manter o contrato do AudioFlow para busca e rádio | O frontend e os testes já conhecem o formato `{results:[...]}` |
| Interface lê metadados da API, não do arquivo | Nome, artista, álbum e duração vêm de `SearchHit`; capas vêm de `i.ytimg.com`; o m4a original não faz perder nada visível |
| Atualização por botões dentro do app | Sem terminal no dia a dia: `pip` (yt-dlp) e `git` (app) rodam no servidor local, com rollback e proteção contra chamadas de outros sites |
| Início por Termux:Boot e reinício por Termux:Widget | O servidor sobe com o celular e pode ser religado com um toque na tela inicial |
| Piped/Invidious desligado por padrão | Dependência externa instável; só com `RELAY_PUBLIC_FALLBACK=1` |
| AudioFlow vira "modo legado" | Evita apagar código que funcionou; some da UI principal |
| Build do PWA no PC ou no GitHub Actions, não no Termux | `pnpm install` e `vite build` são pesados no celular |
| Oracle desligada, sem espelho | O PWA e o servidor vivem só no celular |

## 6. Fases

### Fase 0 — Validar no celular (sem alterar código)

Objetivo: confirmar as premissas antes de investir. No Termux, um comando por vez.

1. Busca: `yt-dlp --flat-playlist -J "https://music.youtube.com/search?q=arctic+monkeys#songs" | head -c 600` — esperado: entradas com ids de 11 caracteres. Se falhar, testar `ytsearch5:arctic monkeys`.
2. Rádio: `yt-dlp --flat-playlist -J "https://music.youtube.com/watch?v=bpOSxM0rNPM&list=RDAMVMbpOSxM0rNPM" | head -c 600`.
3. Relay atual, sem mudanças: copiar a pasta `server/`, rodar `node server/standalone.ts`; em outra sessão: `curl -s localhost:8787/api/resolve/9bZkp7q19f0` (esperado: JSON com `source` "yt-dlp local") e `curl -s -r 0-99999 -o /dev/null -w "%{http_code} %{size_download}\n" "localhost:8787/api/audio?id=9bZkp7q19f0"` (esperado: `206 100000`).
4. Estabilidade: resolver 8 a 10 faixas diferentes em loop, no Wi-Fi e nos dados móveis; registrar a taxa de sucesso.
5. Metadados da interface: rodar a busca do passo 1 sem o `head` e conferir, em pelo menos 5 entradas, que existem título, artista (`artists` ou canal), álbum e `duration`; anotar quantas vêm sem `duration`. No Chrome do celular, abrir `https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg` para confirmar que a capa carrega na sua rede.

**Aceite:** passos 1 a 3 funcionam e o passo 4 passa em pelo menos 90% das faixas. Se a busca ou o rádio falharem, avaliar o pacote `ytmusicapi` como alternativa (não verificado) antes da Fase 1.

### Fase 1 — Servidor local (`server/`)

**1.1 `standalone.ts` serve o PWA.**

- Servir `dist/` (variável `WEB_DIR`, padrão `./dist`), sem dependências npm.
- MIME corretos (`.webmanifest` como `application/manifest+json`, `.js`, `.css`, `.svg`, `.png`, `.woff2`).
- Fallback SPA para `index.html`, exceto em `/api` e `/health`.
- `Cache-Control: no-cache` em `sw.js`, `registerSW.js`, `manifest.webmanifest` e `index.html`; `immutable` em `assets/*`.
- Bloquear path traversal (normalizar e exigir que o caminho comece na raiz).
- Bind em `127.0.0.1` por padrão (`RELAY_HOST`), porta `RELAY_PORT` (padrão 8787).
- Não enviar `Content-Security-Policy` restritiva: as capas vêm de `i.ytimg.com`, `ggpht.com` e `googleusercontent.com`, e o áudio chega por `blob:`. Se houver CSP, permitir esses hosts em `img-src` e `blob:` em `media-src`.

**1.2 Endurecer `relay.ts`.**

- Remover o CORS `*` (aceitar `RELAY_CORS_ORIGIN` opcional).
- `GET /health` retorna `{status, ytdlp_version, js_runtime}`; versão em cache por 10 min via `yt-dlp --version`. O painel atual (`testAudioFlow`) já espera `ytdlp_version`.
- Semáforo de yt-dlp simultâneos (padrão 2), timeout de 45 s (já existe), cache LRU de 200 entradas.
- Limite de resoluções por hora (`RELAY_MAX_RESOLVES_PER_HOUR`, padrão 120), portando `GLOBAL_EXTRACTIONS_PER_HOUR` do AudioFlow.
- Tier Piped/Invidious só com `RELAY_PUBLIC_FALLBACK=1`.
- Erros no formato `{error:{code,message,retryable}}`, portando `audioflow/app/services/error_mapping.py` (`source_blocked`, `video_private`, `video_age_restricted`, `live_not_supported`, `extractor_outdated`).
- URL expirada ou IP trocado (Wi-Fi ↔ dados): manter o re-resolve em 403/410, com no máximo 1 tentativa extra.

**1.3 Busca e rádio no relay, com o mesmo contrato do AudioFlow.**

- `GET /api/v1/audio/search?q=&limit=` retorna `{query, results:[{id,title,artist,album,duration}]}`.
- `GET /api/v1/audio/related?id=&limit=` retorna `{id, results:[...]}`.
- Cada resultado traz `title`, `artist`, `album` e `duration` em segundos. O frontend mostra o tempo na lista só quando `duration` existe; se faltar, ele completa ao resolver a faixa (item 2.4).
- Lógica portada de `audioflow/app/services/extractor.py` (`search_music`, `related_music`, `_music_entries`): busca em `https://music.youtube.com/search?q=<q>#songs`, com fallback `ytsearch<min(limit*3,60)>:<q>` aceitando só canais "- Topic" ou VEVO; rádio em `https://music.youtube.com/watch?v=<id>&list=RDAMVM<id>`, com fallback `https://www.youtube.com/watch?v=<id>&list=RD<id>`; flags `--flat-playlist -J --no-warnings`.
- Filtro de entradas: id de 11 caracteres, sem duplicatas, sem lives, artista vindo de `artists` ou do canal sem o sufixo " - Topic"/"VEVO".
- Cache em memória: 10 min (busca) e 6 h (rádio).
- Validação: `id` com `^[A-Za-z0-9_-]{11}$`, `q` com até 200 caracteres, `limit` de 1 a 50.
- Executar o yt-dlp sempre com `execFile` e array de argumentos, nunca por shell.

**1.4 Testes (`node --test`).** yt-dlp falso via `YTDLP_PATH` (script que imprime fixtures JSON). Cobrir: resolve, Range 206, 403 seguido de re-resolve, formato de search e related, validação de entrada, path traversal, fallback SPA, headers do service worker.

**1.5 `package.json`.** Scripts `relay` (`node server/standalone.ts`), `build:phone` (`vite build` sem `FIGMA_PUBLIC_URL`, para `base: '/'`) e `test:relay`; campo `engines` com a versão mínima do Node.

**1.6 Atualização e reinício pelo app (novo arquivo `server/admin.ts`).**

- `POST /api/admin/update-ytdlp`: roda `pip install -U yt-dlp yt-dlp-ejs` (programa em `RELAY_PIP`, padrão `pip`) com `execFile` e argumentos fixos; um por vez (trava) e timeout de 300 s.
- Antes de atualizar, guardar as versões atuais; depois, conferir `yt-dlp --version` e o runtime JS. Se a conferência falhar, reinstalar as versões guardadas (rollback) e reportar `failed`.
- `GET /api/admin/update-status` e `GET /health` informam `{state: idle|running|ok|failed, ytdlp_version, updated_at, message}`; `message` com no máximo 20 linhas.
- `POST /api/admin/update-app`: roda `git fetch --depth 1 origin phone-dist` e `git reset --hard FETCH_HEAD` na raiz do repositório (programa em `RELAY_GIT`; a branch `phone-dist` já traz o `dist/`) e então encerra o processo com código 0, para o `start.sh` reiniciá-lo.
- Proteção: aceitar só `POST` com `Sec-Fetch-Site: same-origin` e o cabeçalho `X-Stormusic: 1`; responder 403 caso contrário. Os endpoints `/api/admin/*` não aceitam nenhum parâmetro vindo do cliente.
- Atualização automática: ao iniciar, se a última atualização do yt-dlp tem mais de 7 dias (`RELAY_AUTO_UPDATE_DAYS`, padrão 7; 0 desliga), atualizar em segundo plano sem bloquear as faixas. Estado em `~/.stormusic/state.json` (`RELAY_STATE_DIR`).
- Testes: `pip` e `git` falsos via `RELAY_PIP` e `RELAY_GIT`, cobrindo sucesso, falha com rollback, trava de concorrência e 403 sem os cabeçalhos.

**Aceite:** no PC, `pnpm build:phone` e `node server/standalone.ts` abrem o app em `http://localhost:8787`; os testes passam (incluindo os dos endpoints de atualização); no Termux, os `curl` dos endpoints respondem.

### Fase 2 — Frontend

**2.1 `stream.ts`: modo explícito.** Introduzir `ytm.mode` com `'local'` (padrão quando a página roda em `localhost` ou `127.0.0.1`) e `'audioflow'` (legado). No modo local:

- `run()` pula `viaAudioFlow` e usa `/api/resolve` same-origin;
- `searchMusic` e `relatedMusic` chamam `/api/v1/audio/*` same-origin, sem exigir URL configurada;
- `fetchAudioBlob` faz `/api/resolve/:id` e depois `/api/audio?id=` sem Range, devolvendo o Blob;
- remover, nesse modo, o retry por `pageHostAF` e o erro `mixed_content`.

**2.2 Mensagens de erro.** Servidor parado (falha em `/health`): "Servidor local parado. Abra o Termux e rode start.sh". `source_blocked`: "O YouTube recusou este IP; tente em outra rede".

**2.3 `App.tsx` (configurações, linhas \~385 a 415).** Substituir os painéis "Servidor de stream" e "AudioFlow API" por um painel "Motor local": status de `/health` (versão do yt-dlp), botão "Testar com uma faixa" e seção "Avançado" recolhida com o modo legado. Não refatorar o resto do monolito nesta fase.

**2.4 Paridade de interface (nome, duração e capas).** O app continua mostrando tudo como hoje:

- Nome, artista e álbum: vêm de `SearchHit` via `hitToTrack`; nunca de tags do arquivo.
- Duração: se a busca vier sem `duration`, preencher ao resolver a faixa (`r.duration`) e guardar no `meta` da faixa em `taste.ts`, para a lista e o player mostrarem o tempo nas próximas vezes.
- Capas: continuam em `thumb()` (`i.ytimg.com`). Ao baixar a Supermix offline, buscar também a capa `hqdefault` e a `mqdefault` de cada faixa, para o Service Worker (`CacheFirst` no cache `thumbs`, 200 entradas) guardá-las e a Supermix aparecer com capas em modo avião.
- Arte da notificação (`MediaSession`) e capa grande do player: sem mudança de código; validar com a rede desligada.

**2.5 PWA.** Incluir `/health` em `navigateFallbackDenylist`; manter o `NetworkFirst` de `/api/v1/audio/(search|related)`; conferir que o `autoUpdate` do service worker funciona em `localhost`.

**2.6 `offline.ts`.** Contrato inalterado. Validar o novo `fetchAudioBlob` e ajustar a concorrência para 1 ou 2, conforme o desempenho no celular.

**2.7 Botões de atualização no painel "Motor local".**

- "Atualizar yt-dlp": faz o `POST` com o cabeçalho `X-Stormusic: 1`, consulta `/health` a cada 2 s enquanto `state` for `running` e mostra a versão antes e depois, com mensagens em português.
- "Atualizar app": pede confirmação, faz o `POST` em `update-app`, espera o servidor voltar (até 30 s consultando `/health`) e então recarrega a página; o service worker (`autoUpdate`) pega os arquivos novos.
- Aviso quando `updated_at` for de mais de 14 dias, com o botão de atualizar ao lado.
- Servidor parado (falha em `/health`): mostrar "Servidor parado. Toque no atalho Stormusic na tela inicial" e um botão "Tentar de novo".

**Aceite:** no Chrome do celular, `http://localhost:8787` abre, o Chrome oferece "Instalar app", toca uma faixa do catálogo, a busca e a Supermix online funcionam, o download offline da Supermix conclui e, em modo avião, as 25 faixas tocam com nome, artista, duração e capas visíveis, e a notificação do Android mostra a arte.

### Fase 3 — Operação no Android (`phone/`)

- Apps (todos pelo F-Droid, sem misturar com a Play Store): Termux, Termux:Boot e Termux:Widget. Abrir o Termux:Boot uma vez, para o Android registrar o início automático.
- `phone/setup.sh` (idempotente; roda uma única vez): `pkg install -y python nodejs git` (sem ffmpeg: o relay repassa o m4a original e nada no app converte áudio, o que também evita os conflitos de bibliotecas que você teve no Termux); `pip install -U yt-dlp yt-dlp-ejs`; clonar a branch `phone-dist` (já traz `dist/`) em `~/stormusic`; criar `~/.termux/boot/stormusic.sh` e `~/.shortcuts/tasks/Stormusic.sh`, ambos chamando `phone/start.sh`, com `chmod +x`.
- `phone/start.sh`: idempotente (arquivo de PID: se já houver servidor rodando, não inicia outro); `termux-wake-lock`; `RELAY_HOST=127.0.0.1 node server/standalone.ts`; reinicia se o processo sair (o `update-app` encerra o processo de propósito para isso); log em `~/.stormusic/server.log`, limitado a 1 MB.
- `phone/update.sh`: faz o mesmo que os botões do app, para uso manual (`pip install -U yt-dlp yt-dlp-ejs`; `git fetch` e `reset`). O uso normal é pelos botões.
- Distribuir o `dist/`: um workflow do GitHub Actions faz o build e publica a branch `phone-dist` (somente `dist/`, `server/`, `phone/` e `package.json`). Se o repositório não estiver no GitHub, pular e registrar a pendência. Evitar `pnpm install` e `vite build` no Termux.

**Z Flip 4 (Samsung One UI): documentar em `docs/PHONE.md` e testar no aparelho.**

- Bateria: para Termux, Termux:Boot, Termux:Widget e Chrome, usar bateria "Sem restrições" e incluir em "Apps que nunca dormem" (Configurações > Bateria > Limites de uso em segundo plano); desligar "Colocar apps não usados para dormir". Os nomes dos menus variam com a versão da One UI (verificar no aparelho).
- O Android 12 ou superior pode encerrar processos filhos do Termux ("phantom process killer"). Só se o servidor morrer em segundo plano: procurar em Opções do desenvolvedor a opção de desativar restrições de processos filhos (existe só em algumas versões). Há também um método avançado por `adb`; documentar como opcional, sem verificação.
- Instalar o PWA pelo Chrome, não pelo Samsung Internet: o armazenamento e o service worker ficam no navegador que instalou o app.
- Dobrar e desdobrar: com música tocando, o áudio deve continuar e o app não deve recarregar. Se a música parar ao dobrar, revisar nas configurações do aparelho a opção de continuar apps na tela externa (verificar no aparelho).
- Tela alta e estreita (22:9): conferir que o player e as listas não cortam conteúdo, aberto e no modo Flex (meio dobrado).

**Aceite:** reiniciar o celular, abrir o app e tocar uma faixa sem digitar nenhum comando; com o servidor parado, o atalho "Stormusic" da tela inicial o religa sem abrir o terminal; os botões do painel "Motor local" atualizam o yt-dlp e o app; com a tela apagada por 30 minutos e depois de dobrar e desdobrar o aparelho, a música continua (testar no Z Flip 4).

### Fase 4 — Limpeza e documentação

- Mover `audioflow/` para `legacy/audioflow/` (ou marcá-lo como modo legado); tirar `deploy/` da Oracle do fluxo.
- Escrever `docs/PHONE.md`; atualizar o README e o `ARCHITECTURE.md`; arquivar `plans/pwa-offline.md` como superado.
- Segurança: revogar as credenciais da Bright Data e do Zyte, trocar a senha do Postgres, apagar `cookies.txt` e o `yt-dlp.conf` com proxy; se o repositório usa git, remover esses arquivos do histórico. Adicionar `cookies.txt` e `yt-dlp.conf` ao `.gitignore`.
- Desligar a VM da Oracle (decidido), sem espelho do PWA. Antes, conferir que todo o código da VM está no repositório.

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Android encerra o Termux | O stream corta no meio da faixa | Supermix offline e prefetch; `termux-wake-lock`; Termux:Boot; sem otimização de bateria |
| Samsung One UI coloca o Termux para dormir | O servidor para com a tela apagada | "Apps que nunca dormem" e bateria sem restrições; wake-lock; testar 1 hora com a tela apagada |
| IP móvel do celular marcado pelo YouTube | Faixas recusadas | Trocar de rede; limitar a taxa (`RELAY_MAX_RESOLVES_PER_HOUR`) |
| YouTube muda o extrator | Falhas após dias sem atualizar | Botão "Atualizar yt-dlp", atualização semanal automática; `/health` mostra a versão |
| Atualização do yt-dlp quebra a extração | Faixas falham logo após atualizar | Rollback automático para as versões anteriores (item 1.6) |
| Site malicioso chama os endpoints de atualização | Execução de `pip` ou `git` não pedida | Bind em 127.0.0.1, `Sec-Fetch-Site` same-origin, cabeçalho `X-Stormusic`, sem parâmetros do cliente |
| Busca e rádio falham no celular | Sem Supermix online nem busca | Fase 0 valida antes; alternativa a avaliar: `ytmusicapi` |
| Busca sem `duration` | Lista sem o tempo da faixa | Completar ao resolver e guardar no `meta` (item 2.4) |
| Capas em branco em modo avião | Supermix offline sem imagens | Baixar as capas junto com o áudio (item 2.4) |
| Node sem suporte a `--experimental-strip-types` | O servidor não inicia | O Node atual do Termux (v26.4) executa `.ts`; fixar `engines` |
| PWA servido fora do localhost no futuro | Prompt de permissão de rede local | Manter same-origin |

## 8. Critérios de aceite finais

- [ ] Fase 0: busca, rádio, resolve, Range 206 e estabilidade ≥ 90% no celular.
- [ ] `http://localhost:8787` instala como PWA (pelo Chrome) e abre sem a Oracle.
- [ ] Tocar, buscar, Supermix online, Supermix offline em modo avião.
- [ ] Nome, artista, álbum, duração e capas aparecem na busca, no player e na notificação, iguais ao comportamento atual.
- [ ] Em modo avião, a Supermix baixada mostra as capas e os tempos.
- [ ] Nenhuma requisição ao AudioFlow no modo local (conferir na aba Network).
- [ ] Servidor só em `127.0.0.1`, sem CORS aberto, com limites de taxa e de processos; `/api/admin/*` recusa chamadas sem os cabeçalhos de proteção.
- [ ] "Atualizar yt-dlp" mostra a versão nova; numa falha simulada, o rollback restaura a anterior.
- [ ] "Atualizar app" traz o `dist` novo e o app recarrega sozinho.
- [ ] Reiniciar o celular: o servidor sobe sozinho (Termux:Boot).
- [ ] Servidor parado: o atalho "Stormusic" na tela inicial o religa sem abrir o terminal.
- [ ] Z Flip 4: 30 minutos com a tela apagada e dobrar e desdobrar não interrompem a música.
- [ ] `/health` mostra a versão do yt-dlp e a data da última atualização.
- [ ] Credenciais antigas revogadas; docs atualizados.

## 9. Prompt mestre e etapas de execução (GPT Astra light)

Não conheço o GPT Astra (light); por isso o prompt é autossuficiente, divide o trabalho em etapas pequenas e usa o arquivo `PROGRESS.md` como memória entre sessões. **Antes de começar:** exporte este documento em Markdown e salve como `docs/PLAN-PHONE.md` no repositório; o prompt mestre depende desse arquivo.

**Etapas de execução** (você faz a E0 no celular; as demais são do executor, uma por vez e nesta ordem):

| Etapa | Itens do plano | Arquivos | Verificação |
| --- | --- | --- | --- |
| E0 | Fase 0 | nenhum | Você roda os 5 testes no Termux e cola os resultados em `PROGRESS.md` |
| E1 | 1.1 e 1.5 | `server/standalone.ts`, `package.json` | `pnpm build:phone`; `node server/standalone.ts`; abrir `http://localhost:8787` |
| E2 | 1.2 | `server/relay.ts` | `curl -s localhost:8787/health` mostra `ytdlp_version`; CORS aberto removido; erros no formato do plano |
| E3 | 1.3 | `server/music.ts` (novo), `server/relay.ts` | `curl` em `/api/v1/audio/search?q=arctic+monkeys` e em `/related?id=bpOSxM0rNPM` retornam `results` com título, artista, álbum e duração |
| E4 | 1.4 | `server/*.test.ts`, `server/fixtures/` | `pnpm test:relay` passa |
| E5 | 1.6 | `server/admin.ts` (novo), `server/relay.ts` | Testes com `RELAY_PIP` e `RELAY_GIT` falsos: sucesso, rollback, trava e 403 |
| E6 | 2.1 e 2.2 | `src/lib/stream.ts` | `pnpm build`; em `http://localhost:8787`, tocar uma faixa sem chamadas ao AudioFlow (aba Network) |
| E7 | 2.3 e 2.7 | `src/App.tsx` | `pnpm build`; botões de atualização e aviso de servidor parado funcionam |
| E8 | 2.4, 2.5 e 2.6 | `src/lib/taste.ts` (só o `meta`), `src/lib/offline.ts`, `vite.config.ts` | `pnpm build`; Supermix offline com capas e tempos em modo avião |
| E9 | Fase 3 | `phone/*`, `.github/workflows/phone-dist.yml`, `docs/PHONE.md` | No aparelho: reiniciar, tocar, atalho, botões, 30 min de tela apagada, dobrar e desdobrar (pode ser dividida em 3 entregas) |
| E10 | Fase 4 | repositório e `docs/` | `grep` sem credenciais; docs atualizados; legado movido |

**Prompt mestre (cole uma vez no início de cada sessão):**

```text
PAPEL
Você é o engenheiro que vai adaptar o projeto Stormusic para extrair áudio no próprio celular. Trabalhe em etapas pequenas e use só o que está no repositório e no plano. Não invente nomes de funções, arquivos ou endpoints.

OBJETIVO
O Stormusic (PWA em React + Vite) deve tocar música em um Samsung Galaxy Z Flip 4 (Android, Chrome) usando um servidor Node local que roda no Termux. Esse servidor serve o PWA e extrai o áudio com yt-dlp, tudo em http://localhost:8787. Sem Docker, sem a VM da Oracle, sem proxy. Depois da instalação inicial, o usuário não pode precisar abrir o terminal no dia a dia.

ARQUIVOS DE REFERÊNCIA (leia antes de alterar qualquer coisa)
1. docs/PLAN-PHONE.md: plano completo, com contratos e critérios de aceite. Se não existir, pare e peça ao usuário para salvá-lo nesse caminho.
2. AGENTS.md: convenções do projeto (aspas duplas em strings com apóstrofo; componentes com export default).
3. PROGRESS.md: seu diário. Se não existir, crie na raiz com o título "Progresso" e a lista de etapas E0 a E10, todas desmarcadas.
4. Código que você vai alterar ou portar: server/relay.ts, server/standalone.ts, src/lib/stream.ts, src/lib/offline.ts e audioflow/app/services/extractor.py.

REGRAS
1. Faça somente a etapa pedida. Não adiante etapas, não refatore o que não foi pedido, não renomeie arquivos fora do plano.
2. Não altere src/lib/supermix.ts nem src/lib/data.ts. Em src/lib/taste.ts, só o que o plano autorizar (item 2.4: guardar a duração no meta).
3. Servidor Node: nenhuma dependência npm nova; só módulos nativos do Node. Use apenas sintaxe TypeScript removível (sem enum, namespace ou parameter properties), porque o Node executa os .ts apagando os tipos.
4. Nunca chame programas externos por shell. Use execFile com lista de argumentos fixos. Nunca coloque texto vindo do cliente em um comando.
5. Valide toda entrada do cliente (id de vídeo: ^[A-Za-z0-9_-]{11}$; limites de tamanho e de quantidade).
6. Nunca escreva credenciais, tokens ou senhas em arquivos, logs ou respostas. Se encontrar alguma no repositório (por exemplo em yt-dlp.conf ou .env), não repita o valor; avise o usuário.
7. Textos de interface em português do Brasil.
8. Ficam fora do caminho do modo local: ffmpeg, Docker, proxy, cookies e AudioFlow.
9. Se o plano for ambíguo ou contradisser o código, pare e pergunte. Não escolha sozinho.

COMO TRABALHAR
1. Leia PROGRESS.md e confirme a próxima etapa (tabela de etapas, seção 9 do plano).
2. Releia os itens do plano daquela etapa e os arquivos que serão alterados.
3. Escreva um plano de no máximo 8 linhas e comece.
4. Altere o mínimo de arquivos. Entregue cada arquivo alterado por completo ou como diff claro. Se a etapa pedir mais de 300 linhas novas de uma vez, divida em entregas menores e avise.
5. Verifique: rode os comandos da coluna "Verificação" da etapa. Se você não tiver terminal, escreva os comandos para o usuário rodar e espere a resposta.
6. Atualize PROGRESS.md: etapa concluída, arquivos alterados, resultado da verificação e pendências.
7. Termine com três blocos: "O que foi feito", "Como validar" e "O que o usuário precisa fazer no celular". Depois pare. Não comece a próxima etapa.

CONTEXTO TÉCNICO ESSENCIAL
- O YouTube bloqueia o IP da VM da Oracle, mas aceita o IP do celular. Por isso a extração passa para o celular.
- Mesma origem: o servidor local serve o dist/ e a API: /api/resolve/:id, /api/audio?id=, /api/v1/audio/search, /api/v1/audio/related, /health e /api/admin/*.
- O app toca o m4a original. Nome, artista, álbum e duração vêm da API; as capas vêm de https://i.ytimg.com/vi/<id>/hqdefault.jpg. Nada depende de tags dentro do arquivo.
- Formato de erro da API: {"error":{"code":"...","message":"...","retryable":true}}
- Ambiente alvo: Termux; Node v26 executa .ts; yt-dlp instalado com pip; servidor em 127.0.0.1:8787.

PRONTO SIGNIFICA
A verificação da etapa passou, PROGRESS.md foi atualizado, nenhum arquivo fora do escopo mudou e nenhuma credencial apareceu em arquivo ou resposta.

CONFIRMAÇÃO
Se entendeu, responda apenas com: (a) quais arquivos de referência você encontrou, (b) qual é a próxima etapa segundo PROGRESS.md, (c) suas dúvidas. Não escreva código ainda.
```

**Prompt de cada etapa** (troque E\_\_ pelo número da etapa):

```text
Execute a etapa E__ do docs/PLAN-PHONE.md (seção 9, tabela de etapas). Siga as regras e o modo de trabalho do prompt mestre. Altere somente os arquivos da etapa. Ao final, rode a verificação, atualize PROGRESS.md e pare.
```

**Prompt de retomada** (use ao abrir uma sessão nova):

```text
Retomada de sessão. Releia docs/PLAN-PHONE.md, AGENTS.md e PROGRESS.md. Responda só com: a última etapa concluída, a próxima etapa e qualquer pendência registrada. Não altere nenhum arquivo até eu confirmar.
```

**Prompt de revisão** (use ao fim de cada etapa, antes de seguir):

```text
Revise a etapa E__ sem alterar arquivos. Compare o que foi feito com os itens do plano e com as regras do prompt mestre. Liste: (1) itens do plano não atendidos, (2) arquivos alterados fora do escopo, (3) riscos de segurança (shell, entrada do cliente, credenciais), (4) comandos de verificação que ainda não foram rodados. Seja objetivo e não corrija nada até eu pedir.
```

## 10. Decisões confirmadas

1. **Dados do app antigo:** não há nada a preservar; sem exportar nem importar, e o app começa limpo em `localhost`.
2. **VM da Oracle:** será desligada, sem espelho do PWA.
3. **Formato do áudio:** m4a original, sem conversão. A interface continua completa (nome, artista, álbum, duração, capas, arte da notificação) porque esses dados vêm da API e de `i.ytimg.com`, não de tags no arquivo.
