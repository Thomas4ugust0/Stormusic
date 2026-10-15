# Progresso

### Reinstalação com preservação — 15/10/2026

- Pedido: ZIP completo e reinstalação limpa preservando os dados, com dois possíveis backups anteriores. Build antes da preparação passou (`pnpm build:phone`, 20 entradas, 412,04 KiB).
- Código anterior em `stormusic-r1-*-backup` não contém o localStorage/CacheStorage do Chrome. Dados de servidor ficam em `~/.stormusic`. Preparando cópia externa e exportação de perfil/gosto antes de remover o PWA; Termux deve permanecer instalado.
- Entregue `artifacts/Stormusic-reinstalacao-completa.zip`: bundle completo com checkout limpo, instalador, preparação de backup, página de exportação/importação e guia `docs/REINSTALACAO.md`. Os backups anteriores são listados e preservados, sem escolha por nome truncado e sem mesclar código antigo.
- `phone/prepare_reinstall.py` verifica e pausa o supervisor, copia `~/.stormusic` (incluindo áudio) para TAR externo, confere sua leitura e religa o servidor. Não restaura código antigo por cima do novo. `public/offline/stormusic-backup.html` usa a mesma origem do Chrome; exporta somente perfil/curtidas/gosto/mix/plano/backup de gosto, excluindo credenciais. Importação exige arquivo e checkbox, valida conteúdo, cria backup antes de substituir e reverte falhas parciais. CacheStorage não é exportado; áudios exclusivamente do navegador podem exigir novo download.
- Empacotador exclui testes/cache Python e normaliza scripts Bash para LF. Verificados: 3 testes da página (exportação sem credenciais, confirmação, validação, quota e rollback), 8 testes Python do phone, TypeScript e builds padrão/phone. Build final com 21 entradas, 417,86 KiB. ZIP conferido por CRC, bundle idêntico, clone limpo, entrada Node válida, página de recuperação e hashes dos ícones iguais aos originais; sem publicação no GitHub. Integração física Android não executada.

Implementação local seguindo `docs/PLAN-PHONE.md`. O pedido abrangeu todas as mudanças, sem executar separadamente os prompts de pausa da seção 9.

### Proteção do perfil — 14/10/2026

- Build antes da correção passou (`pnpm build`, 20 entradas de precache, 411,74 KiB).
- Relato do usuário: abrir/refazer perfil aparentou apagar os dados sem confirmação. Em investigação; nenhuma ação foi executada nos dados do aparelho.

- [ ] E0 — Pendente no Z Flip 4: extração real, busca, rádio, Range e taxa de sucesso ≥90% em Wi-Fi/dados.
- [x] E1 — PWA servido pelo Node em loopback, build de celular, MIME, SPA e cache.
- [x] E2 — Limites de processos/taxa, LRU, fallback público opt-in, erros estruturados e renovação real de URL.
- [x] E3 — Busca/rádio portados com filtros, fallback e caches.
- [x] E4 — Integração resolve/Range/renovação/validação/arquivos; testes adicionais de frontend e limites.
- [x] E5 — Updaters protegidos, estado persistente, trava, rollback yt-dlp, atualização app e reinício; testes com programas falsos.
- [x] E6 — Modo local explícito; player, busca, rádio e blobs offline usam somente a API local.
- [x] E7 — Motor local, botões, status e modo legado recolhido; interface conferida no navegador do PC.
- [x] E8 — Durações persistidas, capas offline, preservação do mix anterior e exclusão de `/health` do fallback PWA.
- [x] E9 (implementação) — Scripts Termux, supervisor, boot/widget, pacote compilado e workflow `phone-dist`.
- [ ] E9 (operação) — Instalação/boot/bateria/reprodução real no celular e publicação do workflow/branch no GitHub.
- [x] E10 (documentação) — README, arquitetura, guia do celular, marcação do legado, ignore de cookies/config.
- [ ] E10 (contas externas) — Revogar credenciais antigas/trocar senha/desligar Oracle e conferir código exclusivo da VM; sem acesso a essas contas nesta execução.

## Verificação no PC

- `pnpm test:relay`: 10 verificações passaram (incluindo subtestes).
- `pnpm exec tsc --noEmit`: passou.
- `pnpm build:phone`: passou; PWA/manifest/service worker gerados.
- Scripts `phone/*.sh`: validação de sintaxe com Git Bash.
- Bundle clonado em pasta temporária: checkout `phone-dist` limpo, servidor iniciado sem `node_modules`, HTML e manifest conferidos.
- Navegador em `http://localhost:8787`: onboarding, Biblioteca, painel Motor local e modo local verificados. Sem yt-dlp instalado no PC, a interface informa corretamente que o extrator está ausente. Não se afirmou reprodução real nesse ambiente.
- Testes do cliente: download de bytes de áudio, capa HQ/MQ, duração, reprodução offline sem rede, falha parcial preservando mix anterior e retomada.
- Nenhum `cookies.txt`, `yt-dlp.conf` ou arquivo `.env` encontrado entre arquivos rastreados. Segredos de serviços externos não foram revogados. Histórico compartilhado não foi reescrito.
- Alterações preexistentes em quatro ícones PNG foram preservadas.

## Entrega

`artifacts/Stormusic-celular.zip`: instalação por bundle local, sem depender de publicação remota. O botão Atualizar app passa a obter versões novas quando `phone-dist` estiver publicado no GitHub. `docs/PHONE.md` contém os comandos para instalar o pacote no celular e os critérios de teste real.

## Diferenças deliberadas

- Padrão local também no desenvolvimento; legado somente mediante seleção explícita.
- Atualizador do app recusa checkout fora de `phone-dist` ou com alterações locais.
- Download parcial não marca o mix como completo nem apaga o anterior; mantém snapshot das faixas offline para reprodução após gerar outro mix.
- Sem novas dependências npm no servidor; o teste do cliente usa o TypeScript já presente no projeto.
- AudioFlow foi marcado como legado, preservando sua pasta e histórico.

## Refinamento

Etapas do plano v2, salvo em `docs/PLAN-REFINAMENTO.md`. A aplicação da marca (R4) foi solicitada diretamente pelo usuário após o envio do kit. R1 retomada usando o código atual como referência, conforme autorização do usuário; consultar somente em divergências graves.

- [x] R1 — Diagnóstico com benchmark e transferências reais; coletas encerradas pelo usuário, limitações registradas.
- [x] R2 — Proteção de dados: Perfil, confirmação, backup/restauração e desfazer like/unlike.
- [x] R3 — Limpeza da interface e dos rótulos.
- [x] R4 — Marca Stormusic aplicada; conferência do ícone instalado pendente no celular.
- [x] R5 — Motor do player e correção do play/pause.
- [x] R6 — Resolvedor rápido.
- [x] R7 — Biblioteca em disco e downloads robustos.
- [x] R8 — Plano diário e agendador.
- [x] R9 — Pré-carga e troca sem intervalo.
- [x] R10 — Tela Baixadas e feedback.
- [x] R11 — Plano diário no app.
- [x] R12 — Pesos, limiar de pulo, decaimento e desfazer validados por testes; aparelho não medido.
- [x] R13 — Offline em duas camadas e modo sem internet.
- [ ] R14 — Validação final no aparelho.

### R4 — Aplicação do kit recebido

- Build inicial: `pnpm build` passou antes das alterações, incluindo geração do service worker. A primeira tentativa foi bloqueada pelo sandbox ao acessar `node_modules`; a execução autorizada fora dele concluiu com código 0.
- Kit `stormusic-brand (1).zip` extraído em `brand/`; aplicada somente a versão principal, com listras/play brancos e vermelho original `#E50C16`.
- Arquivos alterados: `src/App.tsx` (Logo compartilhada entre cabeçalho e onboarding), `public/favicon.svg`, `public/pwa-192.png`, `public/pwa-512.png`, `public/pwa-maskable-512.png`, `public/apple-touch-icon.png`, `public/logo-mark.svg`, `.figma/make/site.json`, `vite.config.ts`, `index.html` e este diário. Kit de referência preservado em `brand/`.
- Nome, título, descrição, metadados de compartilhamento e identificação do app usam Stormusic. Referências a YouTube Music continuam identificando a fonte das músicas; nomes de funções e chaves `ytm.*` não foram alterados.
- Build final: `pnpm build` passou (código 0), incluindo manifest e service worker com 16 entradas de precache. HTML e manifest gerados conferidos; ícone de 192 px inspecionado visualmente; os seis assets públicos tiveram SHA-256 comparado com o kit e são idênticos.
- Pacote compilado regenerado com `node phone/package.mjs` e `artifacts/Stormusic-celular.zip` atualizado. Nenhuma publicação no GitHub foi feita nesta etapa.
- No celular: conferir a versão atualizada e, para renovar o ícone instalado, reinstalar somente o PWA sem apagar os dados do site/Chrome. Validação visual no Z Flip 4 ainda pendente.

### R1 — Diagnóstico e métricas

- Build inicial: `pnpm build` passou antes das alterações de R1 (código 0, manifest e service worker gerados).
- Escopo: instrumentar os caminhos existentes, fornecer benchmark e registrar achados; não corrigir player/downloads nem selecionar um client do yt-dlp antes das medições reais.
- Divergência já esclarecida: o downloader atual tem três tentativas, reaproveitamento dos arquivos salvos e preservação do mix anterior. A causa da parada em aproximadamente cinco faixas ainda não foi reproduzida no aparelho.
- Entrega local de R1: métricas de resolução/áudio em JSONL, finalidade play/prefetch/download, fila/extração, primeiro bloco, bytes, renovação e códigos de erro. Nenhuma URL assinada ou saída do extrator é registrada. Falha do log não interrompe resposta.
- Arquivos desta etapa: `server/metrics.ts`, `server/metrics.test.ts`, `server/relay.ts`, `server/relay.test.ts`, `server/runtime.ts`, `src/lib/stream.ts`, `phone/bench.sh`, `phone/bench.py`, `phone/bench_test.py`, `docs/DIAGNOSTICO.md`, `docs/PLAN-REFINAMENTO.md` e `PROGRESS.md`. Alterações anteriores da marca R4 preservadas.
- Entrega dividida em coleta, benchmark/testes e documentação. Benchmark compara dez IDs nos seis clients com processos novos, sem baixar arquivos completos; mediana só de sucessos e falhas separadas. Testes Python usam processo e relógio injetados.
- Verificação: `pnpm test:relay` passou (11 testes); `python phone/bench_test.py` passou (2 testes); `pnpm exec tsc --noEmit` passou; `bash -n phone/bench.sh` passou; `git diff --check` passou. Aviso de falha de escrita das métricas é intencional no teste desse cenário.
- Build final: `pnpm build` passou, código 0, service worker com 16 entradas (337,13 KiB). Esses resultados não medem desempenho do celular.
- Distribuição local regenerada com `node phone/package.mjs`; pacote `artifacts/Stormusic-diagnostico.zip` permite executar o benchmark independentemente da instalação atual. Nenhuma publicação no GitHub ou alteração em chaves `ytm.*` feita nesta etapa.
- Pendências obrigatórias: usuário executar benchmark no Z Flip 4, enviar resumo/JSONL; instalar versão instrumentada para reproduzir interrupção do lote e enviar métricas/horários. O setup existente não atualiza uma pasta já instalada. R1 permanece aberta; não iniciar R2 até concluir diagnóstico com evidências reais.
- Atualização de 13/10/2026: benchmark recebido (`bench-20261013-225731-26421.jsonl`), 60 registros em Wi-Fi validados. Default: 10/10, mediana 2.743,84 ms; visionos: 10/10, 2.809,08 ms; demais quatro clients: 0/10, todos `extract_failed`. Resultados registrados em `docs/DIAGNOSTICO.md`; sem alteração no código ou escolha forçada de client.
- Build antes da atualização documental: `pnpm build` passou. Benchmark não mede download completo nem primeiro som; pendência agora é confirmar versão instrumentada no celular e coletar métricas da interrupção. R1 continua aberta.
- Build após atualização documental: `pnpm build` passou (código 0, 16 entradas de precache). Apenas diagnóstico e diário alterados nesta análise.
- Usuário confirmou ausência de `server/metrics.ts` e do log no celular. Preparada coleta temporária em `phone/diagnose.py`, sem substituir instalação: verifica supervisor via `/proc`, prepara bundle em pasta separada, pausa supervisor, executa servidor instrumentado e solicita restauração ao sair. Nenhum reset de armazenamento ou publicação remota.
- Build inicial desta entrega passou. Arquivos desta entrega: `phone/diagnose.py`, `docs/DIAGNOSTICO.md`, `PROGRESS.md`; pacote `artifacts/Stormusic-coleta-R1.zip`. A execução no Termux e o diagnóstico do download continuam pendentes.
- Verificação final: `pnpm build` passou; sintaxe Python e cinco casos de identificação do supervisor passaram (aceita supervisor esperado, rejeita executável, argumento, caminho e diretório divergentes). `node phone/package.mjs` gerou e verificou o bundle. Integração com `/proc` e sinais do Termux depende do aparelho; não foi simulada como teste Android.
- Diretriz atual: usuário encerrou as coletas manuais e priorizou implementação com os dados recebidos. Não solicitar novos benchmarks. R1 será encerrada com limites explícitos; priorizada correção pequena do transporte de downloads, sem implementar ainda toda a biblioteca R7 ou avançar outras etapas.
- Build inicial antes da correção de download: `pnpm build` passou (código 0). Fonte analisada: `C:/Users/Thomas/Downloads/metrics.jsonl`, 128 registros, 65 inícios e 63 términos.
- Resultado: 15 términos de download sem Range, 7 sem erro; 2 timeouts de servidor e 3 fechamentos de cliente em aproximadamente 180 s; 3 erros de stream. Taxa mediana 31,51 KiB/s. As 8 respostas com Range terminaram sem erro, mediana 840,07 ms. Resoluções sem cache: mediana 7.980,81 ms, fila máxima 10.768,08 ms. Não há limite fixo de cinco downloads nem causa externa comprovada para a diferença por Range.
- R1 encerrada com as limitações documentadas em `docs/DIAGNOSTICO.md`, conforme orientação de não exigir mais benchmarks. Sintomas de player e metas finais continuam nas etapas próprias; sem alegação de ganho pós-correção no celular.

### Correção prioritária de download — 14/10/2026

- Por orientação atual do usuário, aplicada correção pequena antes de prosseguir na sequência: `Range: bytes=0-` no download local, validação de Content-Range/Content-Length/corpo, preservação do áudio quando capa falha e reaproveitamento sem regravar arquivo já salvo. Não é a implementação completa de R7.
- Arquivos de execução alterados: `src/lib/stream.ts`, `src/lib/offline.ts`, `phone/diagnose.py` (modo `--install` com backup permanente). Testes: `server/client.test.ts`, `server/relay.test.ts`, `phone/diagnose_test.py`. Documentação: `docs/DIAGNOSTICO.md`, `docs/ATUALIZACAO-LOCAL.md` e este diário. Marca anterior preservada; nenhuma chave `ytm.*` renomeada ou apagada por esta mudança.
- Verificação: `pnpm test:relay` passou (16 testes); `python -B phone/diagnose_test.py` passou (4 testes, incluindo rollback da ativação); `pnpm exec tsc --noEmit` passou; build final `pnpm build` passou (16 entradas, 337,82 KiB). Ativação com sinais e `/proc` do Termux não executada neste PC.
- Pacote permanente `artifacts/Stormusic-atualizacao.zip` preparado para aplicar a correção sem outra sessão de diagnóstico. Instalação anterior preservada integralmente em backup. Sem publicação no GitHub. R2 e arquitetura completa de R5–R13 permanecem pendentes; não exigir nova coleta manual para prosseguir.

### R2 — Proteção de dados

- Próxima etapa confirmada pela tabela: R2. Build inicial `pnpm build` passou antes das alterações. Entrega em três blocos: backup/restauração, modal/Perfil e integração/testes.
- Reiniciar gosto e curtidas preservará as preferências do perfil e os áudios; backup inclui `ytm.profile`, `ytm.fb`, `ytm.taste`, com validade de sete dias. Limpar downloads exige cópia recuperável antes de remover os originais; se faltar espaço, a operação não prossegue.
- Implementado: `Confirm` com diálogo nativo modal, foco em Cancelar, Esc cancela, retorno do foco, checkbox Entendi e confirmação vermelha. EU e Limpar offline abrem Perfil, sem apagar no toque. Reset/restauração bloqueados enquanto há download/geração em andamento.
- `safeReset` centraliza as exclusões de chaves; não existe mais `localStorage.clear` em `src`. Configuração vazia de relay usa string vazia sem remover chave. Nenhuma chave anterior foi renomeada.
- Backup de gosto em `ytm.backup` por sete dias; backup dos áudios/metadata em caches separados e `ytm.downloadBackup`, também restaurável por sete dias. Quota insuficiente impede limpeza. Cópias permanecem ocupando espaço; não há exclusão física automática dos backups expirados nesta etapa. Áudios de mixes anteriores deixam de ser descartados automaticamente ao concluir outro mix.
- Toast Desfazer de oito segundos para reset/limpeza e like/unlike. Desfazer remove somente o evento de voto, mantendo escutas posteriores. Dislike continua sem desfazer: a troca de faixa e os sinais associados exigem motor R5/regras R12; exceção permitida pela própria especificação de R2.
- Arquivos desta etapa: `src/components/Confirm.tsx`, `src/components/ProfilePanel.tsx`, `src/lib/safety.ts`, `src/App.tsx`, `src/lib/taste.ts`, `src/lib/offline.ts`, `src/lib/stream.ts`, `server/client.test.ts` e `PROGRESS.md`.
- Validação: 20 testes Node passaram, incluindo backup/restauração, sete dias com horário injetado, quota, voto desfeito e preservação do mix. TypeScript passou. No navegador local: EU abre Perfil, Cancelar recebe foco, Entendi libera Confirmar, Esc cancela e devolve foco, reset confirmado oferece Desfazer, Desfazer conclui e backup fica acessível no Perfil. Captura: `artifacts/perfil-r2.png`.
- Pedido adicional do usuário atendido: manifest agora aponta para `stormusic-icon-192.png`, `stormusic-icon-512.png` e `stormusic-icon-maskable-512.png`; Apple touch usa `stormusic-apple-touch-icon.png`. Arquivos copiados do kit, sem recoloração. URLs novas identificam a troca de ícone; hashes conferidos e ícone de 192 px inspecionado. Arquivos adicionais: quatro PNGs em `public`, `vite.config.ts`, `index.html`.
- R3 não iniciada. Nenhum novo benchmark solicitado ao usuário; nenhuma publicação no GitHub.
- Build final passou (código 0, 20 entradas de precache, 401,06 KiB); `git diff --check` passou. Manifest gerado e dimensões/hash dos quatro novos ícones conferidos contra o kit. Pacote permanente regenerado em `artifacts/Stormusic-atualizacao.zip`; diff consolidado disponível em `artifacts/Stormusic-R2-consolidado.patch`.


### Entrega integrada R3 e R5–R13 — 14/10/2026

- Diretriz mais recente do usuário substitui paradas por etapa e testes intermediários: implementar em conjunto, não criar/executar testes e conferir ao final. Não houve build inicial nesta entrega, nem nova solicitação de benchmark. Os testes existentes modificados em R1/R2 foram preservados, não executados hoje.
- R3: inventário em `docs/UI-INVENTARIO.md`; retirados Cast, Heart inerte, Shuffle, Repeat, Relacionado, rótulos 80/20 e selos, seletor de vídeo fictício e filtros inertes. Amostras e painel Letra mantidos; versos fictícios retirados.
- R5/R9: `src/lib/playerMachine.ts` e `player.ts`; intenção separada do áudio real, pedidos obsoletos ignorados, pausa durante resolução, tratamento de pausas externas/rejeição de autoplay, dois áudios, reserva, pré-resolução de três faixas e avanço após espera de oito segundos. Métricas locais limitadas a 200 amostras em `ytm.playerMetrics`; nenhum ganho de tempo declarado.
- R6: `server/ytdlp_worker.py` e `resolver.ts`; worker residente, Node configurado na API Python, prioridade play/prefetch/download, deduplicação, LRU 300 com vencimento máximo de cinco horas, timeout e reinício. Client automático/default preservado pelos resultados de R1; `RELAY_RESOLVER=spawn` disponível. `/api/v1/prefetch` protegido e limitado.
- R7: `server/library.ts`, `downloads.ts`, `libraryApi.ts`; biblioteca versionada e escrita atômica, fila persistente, arquivos .part, validação de tamanho, retomada por identidade de mídia e validade, tentativas/backoff, progresso, limite de armazenamento e disjuntor. URLs/cabeçalhos de extração não são persistidos. Padrão de um download, opção até dois; ritmo compartilhado de 15–45 segundos. Disco servido com Range e identificação da fonte.
- R8: `server/planner.ts` e `scheduler.ts`, integração no standalone, `TZ` em `phone/start.sh`, horário/fuso em health. Plano validado com até 60 faixas, janela local 00:00–07:00, atraso até dez minutos, catch-up e execução imediata. Estado e próxima execução persistidos.
- R10: `Downloads.tsx`, `libraryClient.ts` e App: Baixadas, estado por faixa, erro, retry, contador de minutos/MB, estimativa baseada na transferência, polling visível 1/10 s e atalho no Mix. Remoção exige Confirm e backup; arquivos de backup não são apagados automaticamente.
- R11: `dailyPlan.ts` puro; 25–40 faixas, carry-over, deduplicação, reposição de ouvidas/puladas e alvo de 120 minutos. App recalcula com debounce, ao abrir/ocultar e em intervalos de 30 minutos; plano pendente é reenviado ao reconectar. Falta de candidatos não é apresentada como cobertura completa.
- R12: pesos mantidos, `SKIP_MIN_SEC`, cálculo de gosto puro e horário injetável; dislike não acrescenta sinal de fechamento. A etapa intitulada “validado por testes” permanece sem esse requisito, conforme dispensa explícita atual; não foi criado script de testes sem testes novos.
- R13: cache → disco → fonte; cópia gradual dos arquivos prontos com reserva de 150 MiB, metadata salva por faixa, fila offline somente com arquivos disponíveis, busca/radio remotos desativados quando indisponíveis. API/audio não entram no cache runtime do service worker. Limpeza da cópia do navegador pausa espelhamento até Baixar agora.
- Regra de dados prevalece sobre faxina sem interação: arquivos fora do plano por 24 h após lote concluído são oferecidos para limpeza confirmada, com backup. Backups do servidor em `~/.stormusic/backups/`; recuperação manual. Não foram removidas/renomeadas chaves ytm existentes.
- Marca e quatro ícones de URLs novas preservados, com vermelho original. Nenhuma publicação no GitHub.
- Arquivos principais: os novos módulos acima; integrações em `server/relay.ts`, `standalone.ts`, `src/App.tsx`, `src/lib/offline.ts`, `stream.ts`, `taste.ts`, `safety.ts`, `ProfilePanel.tsx`, supervisor e documentos. Detalhes e limites em `docs/VALIDACAO.md`.
- Conferência final em andamento: build inicial da conferência passou; tipos apontaram ajustes de streaming/nulidade e depois de narrowing no downloader, corrigidos. Não confundir estas conferências estáticas com testes de funcionamento ou medições no Z Flip 4. R14 permanece sem observação real no aparelho; não exigir novos benchmarks.

- Conferência final concluída: `pnpm exec tsc --noEmit`, `pnpm build` (20 entradas, 411,74 KiB), `node --check` nos módulos de produção, parsing Python e `git diff --check` passaram. Nenhuma suíte de testes executada. Supervisor conferido com LF. Integração do worker com atualização do yt-dlp adicionada em `server/admin.ts`; instalador verifica presença do módulo Python antes de trocar pastas.
- `node phone/package.mjs` gerou e verificou o bundle; ZIP permanente `artifacts/Stormusic-atualizacao.zip` e pacote `Stormusic-celular.zip` regenerados. Conteúdo do ZIP e ícones do manifest/build conferidos. Diff consolidado em `artifacts/Stormusic-implementacao-consolidada.patch`. R12 (testes dispensados) e R14 (metas no aparelho não medidas) permanecem explicitamente sem validação empírica.


### Testes autorizados e executados — 14/10/2026

- Usuário autorizou executar os testes da implementação. Dispensa anterior de testes deixa de valer para esta entrega. Nenhuma nova coleta no celular solicitada.
- Primeira execução: seis testes Python passaram; Node apontou fixture antiga sem `RELAY_RESOLVER=spawn` e uma corrida real no status das atualizações. O status agora permanece `running` enquanto a persistência final e o bloqueio ainda estão ativos. Testes de atualização/rollback passaram após correção.
- Outra regressão reproduzida: downloads lentos podiam iniciar a próxima faixa sem pausa, pois o ritmo era contado entre inícios. Corrigido para garantir 15–45 segundos após terminar a faixa; caso de transferência lenta passa.
- Adicionados testes de redutor e adaptador do player: pausa durante resolução, resposta obsoleta, rejeição de autoplay, pausa externa, troca pelo áudio reserva, espera de oito segundos, cancelamento e avanço único. Script `pnpm test:unit` adicionado.
- Plano: 25 faixas de cinco minutos, expansão a 40 de três minutos, sem duplicação, carry-over de 12 não ouvidas, reposição de 13 consumidas e cobertura insuficiente honesta. Agendamento com relógio controlado: meia-noite, jitter, limite às 07:00 e catch-up às 08:10.
- Biblioteca/downloads: 25 arquivos, Range/suffix/416, validação e proteção das mutações, três pausas de trinta minutos por bloqueio, prazo, ritmo após transferência lenta, duas transferências sem compartilhar arquivo e backups. Retomada de .part validada após encerrar a execução e iniciar outro processo Node, usando estado em disco e rede simulada.
- Worker: processo falso residente testa prioridade, deduplicação, cache, expiração, queda e timeout/reinício. Python executa o worker real com módulo yt_dlp falso, conferindo instância única, configuração Node e ausência de diagnósticos privados no protocolo. Não conecta ao YouTube.
- Gosto e offline: pesos +4/+1/−1/−6/−4, limiar de um segundo, meia-vida de 21 dias, desfazer preservando escutas posteriores; espelhamento publica áudio completo e metadata, recusa truncamento e conserva backup na remoção.
- Injeção de dependências limitada a resolvedor, relógio, rede e esperas para executar cenários determinísticos sem alterar os padrões de produção. Decisão do agendador extraída em função pura usada pelo agendador real.
- Resultado final: `pnpm test:unit` 7/7, `pnpm test:relay` 33/33, testes Python do phone 6/6 e worker 1/1. Total: 40 Node + 7 Python, sem falhas. O aviso de escrita de métricas é intencional no cenário de falha do log.
- `pnpm exec tsc --noEmit` e `pnpm build` passaram; 20 entradas de precache, 411,74 KiB. `git diff --check` conferido. R14 permanece pendente de observação real; testes simulados não comprovam latência, noite de downloads ou 120 minutos de reprodução no Android.
- Arquivos desta entrega: testes novos `src/lib/{playerMachine,player,dailyPlan}.test.ts`, `server/{library,resolver,scheduler}.test.ts`, `server/ytdlp_worker_test.py`, fixture `server/fixtures/worker.mjs`; ampliados `server/client.test.ts` e ajustado `relay.test.ts`; código em `admin.ts`, `downloads.ts`, `resolver.ts`, `scheduler.ts`, import de `player.ts`, package.json e documentos.

- Distribuição pós-testes regenerada e bundle verificado; `Stormusic-atualizacao.zip` conferido (CRC e bundle idêntico). Pacote de instalação e diff consolidado atualizados, sem publicação remota.

### Proteção ao refazer perfil — 14/10/2026

- Usuário relatou que tocar no perfil pareceu apagar os dados sem confirmação. Inspeção localizou o botão “Refazer onboarding”: ele apenas fazia `setProfile(null)`, sem confirmação, causando a tela inicial embora curtidas e downloads continuassem no armazenamento.
- Agora “Refazer onboarding” abre `Confirm`, descreve os dados mantidos e chama `backupTaste()` antes de mudar de tela. Se o backup falhar, a confirmação mostra o erro e não abre o onboarding.
- Nenhum dado do aparelho foi acessado ou alterado. Build inicial passou antes da edição. Após a edição: `pnpm build`, `pnpm exec tsc --noEmit`, `pnpm test:unit` (7/7) e `pnpm test:relay` (33/33) passaram.
- Pacotes locais `Stormusic-atualizacao.zip` e `Stormusic-celular.zip` regenerados; CRC verificado e bundle do ZIP de atualização comparado byte a byte com o pacote produzido. Não publicado no GitHub.
