# Stormusic — plano de refinamento (v2)

Preparado em 13/10/2026, sobre o app que já roda no Z Flip 4. Foco: fluidez, downloads confiáveis, regras do dia, segurança dos dados e marca. Escrito para um executor leve (GPT Astra light), etapa por etapa. As causas abaixo foram lidas no zip original do projeto; o executor deve confirmá-las no código atual (etapa R1) antes de mudar qualquer coisa.

## 1. Metas mensuráveis

| Meta | Alvo | Como medir |
| --- | --- | --- |
| Primeiro som, faixa não baixada | até 5 s do toque ao som (meta: 3 s) | `performance.now()` do toque até o evento `playing`, gravado nas métricas |
| Primeiro som, faixa baixada ou já resolvida | até 1 s | idem |
| Intervalo entre faixas | até 200 ms, sem tela “Resolvendo…” | tempo entre o fim da faixa e o `playing` da próxima |
| Play/pause | estado da tela sempre igual ao áudio real, em 100% dos toques | testes da máquina de estados e 20 toques no aparelho |
| Lote diário | 25 faixas prontas entre 00:00 e 07:00 | `GET /api/v1/library` (`lastRun`) |
| Cobertura offline | pelo menos 120 min de áudio baixado | `summary.minutes` |
| Dados | nenhuma ação destrutiva sem confirmação ou desfazer | busca por `localStorage.clear` no código |

## 2. Diagnóstico: causas lidas no código

| Sintoma | Causa provável | Onde |
| --- | --- | --- |
| Play/pause não pausa | O efeito que resolve a faixa chama `audio.play()` dentro do `.then` usando o valor antigo de `playing` (closure obsoleta): se você pausa durante a resolução, a música começa depois. O efeito de `playing` ignora o toque quando ainda não há `src`. O `<audio>` não tem `onPlay`/`onPause`, então fone, ligação ou perda de foco de áudio deixam a tela errada. | `src/App.tsx` (efeitos de stream e de `playing`; botões com `setPlaying(!playing)`) |
| Perfil apaga as curtidas | O botão “EU” do cabeçalho executa `localStorage.clear(); location.reload()` sem perguntar. | `src/App.tsx` (header) |
| Botões sem uso | `Cast`, `Shuffle`, `Repeat`, o botão `Heart` do player e o texto “Relacionado” não têm ação. “Letra” e a aba “Amostras” precisam ser conferidas. | `src/App.tsx` |
| Rótulos sem valor | “80% favoritos / 20% descobertas” no card do Mix e os selos fav/descoberta nas linhas. | `src/App.tsx` (`Mix`, `kindOf`) |
| Espera ao tocar e vão entre faixas | A resolução só começa depois que o índice muda; `prefetch` aquece só a URL, não os bytes; a troca reaproveita o mesmo `<audio>`; não há elemento reserva. | `src/App.tsx`, `src/lib/stream.ts` |
| Downloads param em \~5 | Rodam dentro da página (param quando a tela apaga ou o Android congela a aba); cada faixa faz resolver + baixar tudo em memória + `cache.put`, com 2 em paralelo; o estado `ytm.offlineMix` só é salvo no fim, então uma interrupção deixa faixas órfãs e invisíveis; falhas não são retomadas. Hipóteses a medir: fila do yt-dlp com limite de 45 s derrubando pedidos, e o limite de 6 conexões por origem do Chrome com áudio, downloads e consultas ao mesmo tempo. | `src/lib/offline.ts`, `server/relay.ts` |
| Sem feedback de download | O progresso é só `{done, total, failed}`: não diz qual faixa nem quanto falta. Não existe lista de baixadas. | `src/lib/offline.ts`, `src/App.tsx` |
| Regras do dia não existem | O Supermix renova a cada 12 h (`REFRESH_MS`) no navegador, ao abrir o app, e troca as 25 faixas de uma vez. Não há 00:00, nem manter as não ouvidas, nem prazo das 07:00. Com o app fechado o navegador não executa nada à meia-noite. | `src/lib/taste.ts`, `src/App.tsx` |
| Gosto | Já existe (like +4, ouviu 30 s ou mais +1, pulou antes de 30 s −1, dislike −6, com decaimento), mas sem testes. O pulo só conta se a faixa tocou 1 s ou mais, e o dislike também dispara o fechamento da escuta, somando um sinal extra. | `src/lib/taste.ts`, `src/App.tsx` |

## 3. Arquitetura-alvo

A ideia central: o trabalho pesado sai da página e passa para o servidor local do Termux, que não depende de a tela estar ligada nem de o app estar aberto. O app vira player e planejador.

```
Chrome (PWA)                                   Termux (Node + yt-dlp), 127.0.0.1:8787
├─ player: máquina de estados + 2 <audio>      ├─ resolvedor rápido: worker Python residente + cache de URLs
├─ plano diário (carry-over, 120 min) ──PUT──▶ ├─ plano salvo em ~/.stormusic/plan.json
├─ tela “Baixadas” (polling 1 s)      ◀──GET── ├─ biblioteca em disco ~/.stormusic/audio/*.m4a
├─ cópia de segurança no Cache Storage         ├─ fila de downloads persistente (retoma, ritmo, backoff)
└─ toca: Cache → disco do servidor → ao vivo   └─ agendador: 00:00 até 07:00, com catch-up
```

- **3.1 Player.** Uma máquina de estados pura (testável sem navegador) decide o que fazer; um adaptador fino liga ao `<audio>`. O estado da tela vem do áudio real. Toda resolução assíncrona carrega um número de pedido, e resposta velha é ignorada.
- **3.2 Resolução rápida.** Um processo Python residente mantém o `YoutubeDL` aquecido (sem reiniciar o Python nem refazer o desafio JS a cada faixa) e um cache de URLs por cerca de 5 h. `POST /api/v1/prefetch` aquece as próximas faixas. O client do yt-dlp mais rápido é escolhido por benchmark (R1).
- **3.3 Biblioteca e downloads (servidor).** Arquivos em disco, estado em JSON gravado de forma atômica, fila persistente que retoma com Range, uma faixa por vez com ritmo de 15 a 45 s, backoff e disjuntor para erros de bloqueio, progresso por faixa.
- **3.4 Plano diário.** O app calcula o plano (quais 25 ou mais faixas devem existir) e o envia ao servidor. O servidor só executa: baixa o que falta, às 00:00, dentro da janela até 07:00.
- **3.5 Offline em duas camadas.** O disco do servidor é a fonte principal e funciona sem internet, porque o servidor é local. A cópia no Cache Storage do navegador protege contra o Android encerrar o Termux no meio do trajeto.
- **3.6 Interface.** Tela “Baixadas” com progresso por faixa; confirmação e desfazer em tudo que apaga; menos botões; marca Stormusic.

## 4. Regras de negócio (testáveis)

| Id | Regra | Teste |
| --- | --- | --- |
| RN1 | O conjunto offline do dia tem 25 faixas. | `buildPlan` devolve 25 (ou mais, ver RN3) e nunca repete id. |
| RN2 | Faixa não ouvida permanece no dia seguinte; faixa ouvida ou pulada sai e é reposta. | Plano de ontem com 10 ouvidas, 3 puladas e 12 não ouvidas: o novo plano mantém as 12 e repõe 13. |
| RN3 | A soma das durações deve cobrir 120 min; se 25 faixas não bastam, completa até 40. | Faixas de 3 min: o plano tem 40; faixas de 5 min: o plano tem 25. |
| RN4 | O servidor inicia o lote às 00:00 do fuso do aparelho, com atraso aleatório de 0 a 10 min, e tem até 07:00. | Agendador com relógio falso: 23:59 espera, 00:03 inicia, 07:00 marca parcial se faltar. |
| RN5 | Um download por vez, com 15 a 45 s entre faixas. | Duas faixas consecutivas respeitam o intervalo mínimo. |
| RN6 | Três erros de bloqueio seguidos pausam 30 min (no máximo 3 pausas); depois o lote fica parcial e tenta de novo na próxima janela ou ao abrir o app. | Downloader falso que sempre bloqueia. |
| RN7 | Se o celular estava desligado à meia-noite, o lote roda assim que o servidor subir (catch-up), com o mesmo ritmo. | Relógio falso: servidor sobe às 08:10 com lote do dia incompleto. |
| RN8 | Pular entre 1 e 30 s derruba a faixa (−1) e o artista (metade disso) nas próximas recomendações; ouvir 30 s ou terminar soma +1; like +4; dislike −6 e some o artista da fila; desfazer like −4. | Testes sobre `record`, `recordPlayback` e o modelo. |
| RN9 | Arquivos fora do plano só são apagados depois que o lote novo termina e após 24 h. | Teste da faxina com relógio falso. |

Definições: **ouvida** = tocou 30 s ou mais, ou terminou. **Pulada** = tocou de 1 s a menos de 30 s. **Não ouvida** = nunca iniciada.

## 5. Etapas de execução

| Etapa | Entrega | Principais arquivos | Verificação |
| --- | --- | --- | --- |
| R1 | Diagnóstico e métricas | `server/relay.ts`, `phone/bench.sh`, `docs/DIAGNOSTICO.md` | Documento com números medidos no celular |
| R2 | Proteção de dados: confirmar e desfazer | `src/App.tsx`, `src/components/Confirm.tsx` (novo) | Nenhum `localStorage.clear` fora do reset confirmado |
| R3 | Limpeza da interface e dos rótulos | `src/App.tsx`, `docs/UI-INVENTARIO.md` | Inventário preenchido; `pnpm build` |
| R4 | Marca Stormusic | `public/*`, `vite.config.ts`, `src/App.tsx` | Nome e logo novos no app instalado |
| R5 | Motor do player e correção do play/pause | `src/lib/playerMachine.ts` (novo), `src/lib/playerMachine.test.ts`, `src/App.tsx` | `pnpm test:unit`; 20 toques no aparelho |
| R6 | Resolvedor rápido | `server/ytdlp_worker.py`, `server/resolver.ts` | Tempo de resolver medido; testes com worker falso |
| R7 | Biblioteca em disco e downloads robustos | `server/library.ts`, `server/downloads.ts` | 25 faixas, com o servidor interrompido no meio |
| R8 | Plano diário e agendador | `server/planner.ts`, `server/scheduler.ts` | Testes RN4 a RN7 com relógio falso |
| R9 | Pré-carga e troca sem intervalo | `src/lib/player.ts`, `src/App.tsx` | Intervalo medido de até 200 ms |
| R10 | Tela “Baixadas” e feedback | `src/App.tsx`, `src/components/Downloads.tsx` | Progresso por faixa visível |
| R11 | Plano diário no app | `src/lib/dailyPlan.ts` (novo) e teste | Testes RN1 a RN3 |
| R12 | Gosto validado por testes | `src/lib/taste.ts`, `src/lib/taste.test.ts` | Testes RN8 |
| R13 | Offline em duas camadas e modo sem internet | `src/lib/offline.ts`, `src/lib/stream.ts` | Modo avião com o Termux parado |
| R14 | Validação final no aparelho | `docs/VALIDACAO.md` | Checklist da seção 6 |

## 6. Especificação por etapa

Ordem recomendada: R1 a R5 primeiro (medir, proteger os dados, limpar, marca e corrigir o play/pause: ganhos rápidos e de baixo risco), depois R6 a R14.

**R1 Diagnóstico e métricas.** Sem mudar comportamento. (a) Registrar no servidor, em `~/.stormusic/metrics.jsonl`, por pedido: id, tipo (play, prefetch, download), `resolve_ms`, `first_byte_ms`, `download_ms`, bytes, erro. (b) Criar `phone/bench.sh`, que mede com `yt-dlp` 10 faixas em cada client (padrão, `visionos`, `tv`, `web_safari`, `android_vr`, `ios`) e imprime a mediana de cada um. (c) Reproduzir o limite de \~5 downloads com os logs e anotar a causa real entre as hipóteses da seção 2. (d) Escrever `docs/DIAGNOSTICO.md` com números e a causa raiz de cada sintoma. O usuário roda o `bench.sh` e cola a saída.

**R2 Proteção de dados.** Criar `Confirm` (modal acessível: foco em Cancelar, Esc cancela, botão perigoso em vermelho) e um toast com “Desfazer” de 8 s. O botão “EU” passa a abrir uma folha “Perfil”, sem nenhuma ação destrutiva no toque. Nessa folha, uma “Zona de risco” com **Reiniciar gosto e curtidas** e **Limpar downloads**; cada um abre o `Confirm` dizendo o que será perdido (quantidade de curtidas, de faixas e MB) e um checkbox “Entendi” que libera o botão vermelho. Antes de qualquer reset, gravar `ytm.backup` (cópia de `ytm.profile`, `ytm.fb` e do armazenamento de gosto, válida por 7 dias) e oferecer “Restaurar backup” no Perfil. Like e unlike ganham toast com “Desfazer”; dislike também, se o código permitir restaurar o sinal e a faixa. Regra de código: `localStorage.clear()` e `removeItem('ytm.*')` só existem dentro de uma função `safeReset()`, chamada apenas pelos botões confirmados. Não renomear nenhuma chave `ytm.*`.

**R3 Limpeza da interface.** Primeiro gerar `docs/UI-INVENTARIO.md`: uma linha por botão, ícone, aba e rótulo, com arquivo, handler e decisão (manter ou remover). Remover os que não fazem nada: `Cast`, `Shuffle`, `Repeat`, o `Heart` do player e “Relacionado”. Remover o texto “80% favoritos / 20% descobertas” e os selos fav/descoberta das linhas (e o código que só existia para eles, se não houver outro uso). Abas inteiras (“Amostras”) e o painel “Letra” só saem depois que o usuário confirmar no `PROGRESS.md`. Não remover nada com ação real sem listar no inventário.

**R4 Marca Stormusic.** Descompactar `stormusic-brand.zip` em `brand/` e copiar `favicon.svg`, `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png` e `apple-touch-icon.png` para `public/`, sobrescrevendo. Trocar a função `Logo()` do `App.tsx` pelo conteúdo de `brand/Logo.snippet.tsx`. Trocar “Music” por “Stormusic” no `name` e no `short_name` do manifest (`vite.config.ts`), no título da página (`.figma/make/site.json` ou `index.html`) e na descrição (“Stormusic: sua música, sem espera.”). Procurar com `grep -rn "Music"` outros textos visíveis do nome antigo e trocar; não mexer em nomes de variáveis nem renomear chaves `ytm.*` (isso apagaria as curtidas). Paleta inalterada (#ff0033, #ff4e6b, #030303). A logo mantém o vermelho do arquivo original (#E50C16): não recolorir. O kit traz também uma alternativa com listras vazadas (pasta alternativa-espaco-negativo); usar só a versão principal, salvo pedido do usuário. O ícone instalado só muda depois de reinstalar o PWA no Chrome.

**R5 Motor do player.** Criar `src/lib/playerMachine.ts` com uma função pura `reduce(state, event)`. Estado: `status` (`idle`, `loading`, `playing`, `paused`, `buffering`, `error`), `wantPlay` (intenção do usuário), `requestId`, `trackId`. Eventos: `USER_PLAY`, `USER_PAUSE`, `TRACK_CHANGE`, `RESOLVED`, `RESOLVE_FAILED`, `AUDIO_PLAYING`, `AUDIO_PAUSED`, `AUDIO_WAITING`, `AUDIO_ENDED`, `AUDIO_ERROR`. Regras: (1) `RESOLVED` com `requestId` velho é ignorado; (2) ao resolver, só chamar `play()` se `wantPlay` for verdadeiro naquele instante (ler de uma ref, nunca da closure); (3) `USER_PAUSE` durante `loading` cancela o início; (4) `AUDIO_PAUSED` que não veio do app (fone, ligação, foco) vira `wantPlay = false`; (5) se `play()` for rejeitado, ficar em `paused` com aviso; (6) o botão alterna a intenção na hora e o áudio converge. No `App.tsx`, o `<audio>` ganha `onPlay`, `onPause`, `onWaiting` e `onPlaying`, e os botões e o MediaSession usam a mesma função. Testes com `node --test` cobrindo: pausar durante a resolução, trocar de faixa duas vezes seguidas, pausa externa e rejeição do `play()`. Adicionar o script `test:unit` ao `package.json`.

**R6 Resolvedor rápido (servidor).** `server/ytdlp_worker.py`: processo residente que lê um pedido JSON por linha (com `id` para casar a resposta) e responde uma linha JSON, usando um único objeto `YoutubeDL` com `skip_download`, formato `bestaudio[ext=m4a]/bestaudio` e o client escolhido no R1; sem shell. O runtime JS (Node) deve ser configurado pela opção equivalente a `--js-runtimes node` na API Python; conferir o nome certo na versão instalada. `server/resolver.ts`: gerencia um worker (reinicia se cair, timeout de 20 s), fila com prioridade `play` > `prefetch` > `download`, cache LRU de 300 URLs com validade de 5 h (usar o parâmetro `expire` da URL) e deduplicação de pedidos iguais em andamento. `POST /api/v1/prefetch` aceita até 5 ids e responde 202. Variável `RELAY_RESOLVER=worker|spawn` (padrão `worker`; `spawn` mantém o comportamento atual como reserva). As métricas do R1 continuam.

**R7 Biblioteca e downloads (servidor).** `server/library.ts`: pasta `~/.stormusic/audio/<id>.m4a`, estado em `library.json` com escrita atômica (arquivo temporário e `rename`) e versão de esquema. `server/downloads.ts`: fila persistente; estados `queued`, `resolving`, `downloading`, `done`, `failed`; baixar para `<id>.m4a.part` com Range e retomar se houver parcial e a URL ainda valer; conferir o tamanho final contra `Content-Length`; progresso por faixa (bytes e %); até 3 tentativas com espera crescente e aleatória; concorrência 1 (configurável até 2); pausa entre faixas e disjuntor conforme RN5 e RN6. `GET /api/audio?id=` serve do disco com `Range`, `Accept-Ranges`, `Content-Length` e o cabeçalho `X-Stormusic-Source: disk` quando houver arquivo. Endpoints da seção 7. Testes com resolvedor e rede falsos, incluindo reiniciar no meio e retomar.

**R8 Plano e agendador (servidor).** `server/planner.ts`: `PUT /api/v1/plan` valida (1 a 60 faixas, ids de 11 caracteres), grava `plan.json`, enfileira o que falta e agenda a faxina (RN9). `server/scheduler.ts`: relógio injetável; calcula a próxima 00:00 local mais atraso aleatório de 0 a 10 min; ao subir, faz catch-up (RN7); prazo às 07:00 (RN4); estado `lastRun`, `nextRunAt` e `windowEndAt` em `library.json`. Se `immediate` for verdadeiro (primeiro plano ou pedido do usuário), inicia agora com o mesmo ritmo. Fuso horário: no `phone/start.sh`, exportar `TZ=$(getprop persist.sys.timezone)` (se vazio, `America/Sao_Paulo`), porque o Node no Termux pode assumir UTC; `/health` passa a mostrar `timezone` e a hora local do servidor (verificar no aparelho).

**R9 Pré-carga e troca sem intervalo (app).** `src/lib/player.ts`: dois `<audio>` (primário e reserva). Assim que a próxima faixa estiver no disco do servidor ou no cache, carregá-la no reserva (`preload="auto"`, `load()`); caso contrário, depois de 40% da faixa atual (ou 30 s antes do fim), chamar `POST /api/v1/prefetch` e carregar. Trocar com `play()` do reserva quando faltar 250 ms ou no `ended`; o reserva vira primário. Se o reserva não estiver pronto na hora, cair no carregamento normal com estado `buffering`. A fila deve ter sempre 3 faixas à frente resolvidas. Se uma faixa ficar 8 s em `waiting`, pular com aviso. Medir e registrar o intervalo entre faixas. Manter o MediaSession (play, pause, anterior, próxima, posição) em dia na troca.

**R10 Tela “Baixadas” e feedback (app).** Seção “Baixadas” no topo da Biblioteca, com atalho no card do Mix. Cabeçalho: “Offline: 28 faixas · 126 min · 134 MB” e “Próxima atualização: hoje 00:07”. Durante o download, o card do Mix mostra “Baixando 7 de 25 · \<título> 43%”, com barra geral e tempo restante estimado. Lista com capa, título, artista e estado: ✓ baixada, ↓ com porcentagem, na fila, ⚠ falhou com botão “Tentar de novo”. Botões: “Baixar agora” (se incompleto) e, no menu da faixa, “Remover do aparelho” (com `Confirm`). Dados por `GET /api/v1/library` a cada 1 s enquanto a tela está visível e há lote rodando, e a cada 10 s no resto; nada quando a página está oculta.

**R11 Plano diário no app.** `src/lib/dailyPlan.ts` com a função pura `buildPlan({ previous, events, candidates, now, size: 25, minMinutes: 120, maxTracks: 40 })` implementando RN1 a RN3, com testes. Substituir o `refreshMix` de 12 h por: gerar o plano ao abrir (se ainda não houver), depois recalcular quando uma faixa vira ouvida ou pulada (esperando 30 s entre cálculos), ao ir para segundo plano e a cada 30 min; enviar com `PUT /api/v1/plan`. Primeiro plano: enviar com `immediate: true`. Sem internet, manter o plano atual e tentar de novo ao reconectar.

**R12 Gosto.** Criar `src/lib/taste.test.ts` cobrindo RN8. Corrigir: `dislike` não deve gerar também `skip` ou `listen` ao fechar a escuta; manter o limite de 1 s para o pulo como constante `SKIP_MIN_SEC`; verificar o decaimento com um relógio injetável. Não mudar os pesos sem pedir.

**R13 Offline em duas camadas e modo sem internet.** Ordem das fontes: Cache Storage, depois disco do servidor (`/api/audio`), depois resolução ao vivo. Com o app ocioso, copiar para o Cache Storage as faixas do plano que ainda não estão lá (uma por vez, lendo do disco do servidor), salvando o estado faixa a faixa e não só no final. Garantir que o service worker não intercepte `/api/audio` nem `/api/v1/library`. Sem internet: filas e extensão só com faixas disponíveis, busca e rádio desativados com aviso, e banner “Servidor local parado” se `/health` falhar, mantendo a reprodução pelo Cache Storage.

**R14 Validação final no aparelho.** Roteiro em `docs/VALIDACAO.md`, executado e marcado pelo usuário: uma noite completa (lote entre 00:00 e 07:00), trajeto simulado em modo avião com 120 min de música, 20 toques de play/pause, 10 pulos seguidos sem espera, queda do Termux no meio de uma faixa, resets com confirmação e desfazer, e fechar e abrir o app com download em andamento.

## 7. Contratos da API local (novos)

Todos os `POST`, `PUT` e `DELETE` exigem `Sec-Fetch-Site: same-origin` e o cabeçalho `X-Stormusic: 1`. Erros no formato `{"error":{"code":"...","message":"...","retryable":true}}`.

| Rota | Corpo | Resposta |
| --- | --- | --- |
| `PUT /api/v1/plan` | `{ tracks:[{id,title,artist,album?,duration?}], immediate? }` | `{ accepted, missing }` |
| `GET /api/v1/library` |  | `{ tracks:[{id,title,artist,album,duration,status,bytes,total,percent,attempts,error,updatedAt}], summary:{done,total,failed,bytes,minutes,etaSec,running,currentId,nextRunAt,windowEndAt,lastRunAt,lastRunStatus} }` |
| `POST /api/v1/library/run` |  | `202` |
| `POST /api/v1/library/retry` | `{ id }` | `202` |
| `DELETE /api/v1/library/:id` |  | `204` |
| `POST /api/v1/prefetch` | `{ ids:[até 5] }` | `202` |
| `GET /api/audio?id=` |  | áudio com `Range`; `X-Stormusic-Source: disk` ou `live` |

## 8. Premissas e riscos

Premissas assumidas (confirmar): (1) “ouvida” é 30 s ou mais, ou terminou; (2) 25 faixas cobrem só uns 90 min, então o plano completa até 40 faixas para chegar a 120 min (RN3); se preferir 25 fixas, é uma constante; (3) o lote noturno roda em qualquer rede, com cerca de 100 a 160 MB por noite; (4) abas inteiras só saem depois da sua confirmação.

| Risco | Mitigação |
| --- | --- |
| Android encerra o Termux à noite | Termux:Boot, wake-lock, bateria sem restrição; catch-up ao subir; testar uma noite (R14) |
| YouTube bloqueia durante o lote | Ritmo lento, 1 por vez, disjuntor, janela de 7 h, retomada |
| Worker Python quebra ou vaza memória | Reinício automático, timeout, `RELAY_RESOLVER=spawn` como reserva |
| Disco do celular enche | Limite configurável da biblioteca, faxina após 24 h (RN9), aviso na tela |
| Cache Storage duplica o espaço | Copiar só as faixas do plano; apagar as que saírem do plano |
| Executor leve muda coisas fora do escopo | Uma etapa por vez, revisão ao fim de cada etapa, `PROGRESS.md` |

## 9. Prompts para o GPT Astra (light)

**Antes de começar:** exporte este documento em Markdown e salve como `docs/PLAN-REFINAMENTO.md`; descompacte `stormusic-brand.zip` em `brand/` na raiz do repositório; mantenha o `PROGRESS.md`. Depois do prompt mestre e da confirmação do executor, envie o prompt de etapa com R1.

**Prompt mestre (cole uma vez no início de cada sessão):**

```text
PAPEL
Você é o engenheiro que vai refinar o app Stormusic, que já funciona no celular do usuário (Samsung Galaxy Z Flip 4, Chrome, servidor Node no Termux). Trabalhe em etapas pequenas e use só o que está no repositório e no plano. Não invente nomes de funções, arquivos ou endpoints.

OBJETIVO
Deixar o app fluido e confiável como Spotify, YouTube Music e Deezer: primeiro som em até 5 s, troca de faixa sem intervalo, play/pause correto, downloads robustos com feedback por faixa, lote diário às 00:00 concluído antes das 07:00, offline que cubra 120 min, dados protegidos por confirmação e a marca Stormusic.

ARQUIVOS DE REFERÊNCIA (leia antes de alterar qualquer coisa)
1. docs/PLAN-REFINAMENTO.md: plano completo (diagnóstico, arquitetura, regras RN1 a RN9, etapas R1 a R14, contratos da API).
2. AGENTS.md: convenções do projeto (aspas duplas em strings com apóstrofo; componentes com export default).
3. PROGRESS.md: seu diário. Mantenha as etapas antigas (E0 a E10) como estão e acrescente uma seção "Refinamento" com R1 a R14 desmarcadas.
4. brand/: kit da marca (logo, ícones, Logo.snippet.tsx).
5. O código atual. O diagnóstico do plano foi feito sobre o zip original; confirme cada causa no código atual antes de corrigir.

REGRAS
1. Faça somente a etapa pedida. Não adiante etapas e não refatore o que não foi pedido.
2. Não quebre o que já funciona: antes de mexer, rode pnpm build e anote o resultado no PROGRESS.md; ao terminar, rode de novo.
3. Não renomeie nem apague chaves de armazenamento ytm.*: isso apagaria as curtidas e o gosto do usuário.
4. Nada que apague dados do usuário sem confirmação (Confirm) e backup. localStorage.clear() só dentro de safeReset().
5. Servidor Node: nenhuma dependência npm nova; só módulos nativos. Sintaxe TypeScript removível (sem enum, namespace ou parameter properties). Python do servidor: só biblioteca padrão e yt-dlp.
6. Nunca chame programas por shell. Use execFile (Node) ou lista de argumentos (Python). Nunca coloque texto do cliente em comando.
7. Valide toda entrada (id de vídeo ^[A-Za-z0-9_-]{11}$; limites de tamanho e de quantidade). Rotas que alteram estado exigem Sec-Fetch-Site: same-origin e o cabeçalho X-Stormusic: 1.
8. Nunca escreva credenciais em arquivos, logs ou respostas.
9. Textos de interface em português do Brasil. Paleta da interface inalterada (#ff0033, #ff4e6b, #030303); a logo mantém o vermelho do arquivo original (#E50C16) e não deve ser recolorida.
10. Medir antes de afirmar: não diga que algo ficou mais rápido sem número. Se a medição exigir o celular, escreva o comando para o usuário rodar e espere o resultado.
11. Lógica nova (máquina do player, plano diário, agendador, gosto) deve ser pura e ter testes com node --test, usando relógio injetável quando houver horário.
12. Se o plano for ambíguo ou contradisser o código, pare e pergunte. Remover abas inteiras exige confirmação do usuário.

COMO TRABALHAR
1. Leia PROGRESS.md e confirme a próxima etapa (tabela de etapas, seção 5 do plano).
2. Releia a especificação da etapa (seção 6) e os arquivos que serão alterados.
3. Escreva um plano de no máximo 8 linhas e comece.
4. Altere o mínimo de arquivos. Entregue cada arquivo alterado por completo ou como diff claro. Se a etapa pedir mais de 300 linhas novas de uma vez, divida em entregas menores e avise.
5. Verifique: rode os comandos da coluna "Verificação" da etapa. Se você não tiver terminal, escreva os comandos para o usuário rodar e espere a resposta.
6. Atualize PROGRESS.md: etapa concluída, arquivos alterados, resultado da verificação e pendências.
7. Termine com três blocos: "O que foi feito", "Como validar" e "O que o usuário precisa fazer no celular". Depois pare. Não comece a próxima etapa.

CONTEXTO TÉCNICO ESSENCIAL
- O servidor local (Termux) serve o PWA e a API em http://localhost:8787 e extrai áudio com yt-dlp. Só o celular consegue falar com o YouTube (o IP da Oracle é bloqueado).
- O app toca m4a; nome, artista, álbum e duração vêm da API; as capas vêm de https://i.ytimg.com/vi/<id>/hqdefault.jpg.
- Sinais de gosto existentes: like +4, ouviu 30 s ou mais +1, pulou antes de 30 s -1, dislike -6, unlike -4, com decaimento.
- Formato de erro da API: {"error":{"code":"...","message":"...","retryable":true}}
- Rotas novas: ver seção 7 do plano.

PRONTO SIGNIFICA
A verificação da etapa passou, PROGRESS.md foi atualizado, o pnpm build continua passando, nenhum arquivo fora do escopo mudou e nenhuma credencial apareceu em arquivo ou resposta.

CONFIRMAÇÃO
Se entendeu, responda apenas com: (a) quais arquivos de referência você encontrou, (b) qual é a próxima etapa segundo PROGRESS.md, (c) suas dúvidas. Não escreva código ainda.
```

**Prompt de cada etapa** (troque R\_\_ pelo número da etapa):

```text
Execute a etapa R__ do docs/PLAN-REFINAMENTO.md (seção 5, tabela de etapas, e seção 6, especificação). Siga as regras e o modo de trabalho do prompt mestre. Altere somente os arquivos da etapa. Ao final, rode a verificação, atualize PROGRESS.md e pare.
```

**Prompt de retomada** (use ao abrir uma sessão nova):

```text
Retomada de sessão. Releia docs/PLAN-REFINAMENTO.md, AGENTS.md e PROGRESS.md. Responda só com: a última etapa concluída, a próxima etapa e qualquer pendência registrada. Não altere nenhum arquivo até eu confirmar.
```

**Prompt de revisão** (use ao fim de cada etapa, antes de seguir):

```text
Revise a etapa R__ sem alterar arquivos. Compare o que foi feito com a especificação do plano e com as regras do prompt mestre. Liste: (1) itens do plano não atendidos, (2) arquivos alterados fora do escopo, (3) riscos de segurança (shell, entrada do cliente, credenciais, dados do usuário), (4) comandos de verificação que ainda não foram rodados, (5) se o pnpm build ainda passa. Seja objetivo e não corrija nada até eu pedir.
```
