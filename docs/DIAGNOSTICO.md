# Stormusic — R1: diagnóstico com as coletas disponíveis

Atualizado em 14/10/2026. Benchmark e log de transferências recebidos do Galaxy Z Flip 4.
O usuário encerrou as coletas manuais. Não solicitar novos benchmarks: implementar
com as evidências disponíveis, usando testes locais e registrando limitações.
O roteiro de coleta abaixo fica como histórico, não como tarefa pendente do usuário.

## Evidências do código atual

| Achado | Evidência | Limite da conclusão |
| --- | --- | --- |
| Pausa durante resolução pode ser revertida | `src/App.tsx`: callback da resolução lê `playing` capturado pelo efeito | Correção reservada à R5; reproduzir no aparelho |
| Estado visual não acompanha todos os eventos do áudio | `src/App.tsx`: elemento sem sincronização por play/pause/waiting/playing | R5 |
| Reset sem confirmação | `src/App.tsx`: botão de perfil chama `localStorage.clear()` | R2; não usar esse botão durante o diagnóstico |
| Prefetch resolve URLs, sem preparar segundo áudio | `src/lib/stream.ts` e `src/App.tsx` | Não comprova troca sem intervalo; R9 |
| Download já tem duas tarefas e três tentativas por faixa | `src/lib/offline.ts` | Contradiz a descrição antiga de ausência de retentativa |
| Arquivos parciais são reaproveitados | `src/lib/offline.ts`: consulta CacheStorage antes de baixar; mix completo registrado só no final | Arquivos salvos não equivalem a mix marcado como concluído |
| Capas antecedem gravação do áudio no cache | `src/lib/offline.ts`: `cacheCovers` antes de `cache.put` | Falha de capa pode repetir áudio; hipótese para investigar |
| Extrações compartilham limites | `server/runtime.ts`: padrão 2 processos, 120 extrações/hora, timeout de processo 45 s | Busca e rádio também gastam orçamento; não comprova bloqueio no caso real |
| Gosto pode receber sinais sobrepostos | `src/App.tsx`: dislike e encerramento da faixa podem registrar eventos distintos | Validar regras em R12 |
| Atualização de mix não é agendador à meia-noite | `src/lib/taste.ts`: intervalo de 12 h | R8/R11 |

## Registros

`~/.stormusic/metrics.jsonl` (ou `RELAY_STATE_DIR`) recebe início e término,
ligados por `request_id`, das requisições válidas de resolução e áudio.
Não registra credenciais, URLs assinadas, cabeçalhos ou saída do yt-dlp.
Falha de escrita gera aviso fixo e não impede a reprodução. O arquivo cresce
durante a coleta; esta etapa não adiciona limpeza automática de dados.

- `id`, `type`: vídeo e finalidade play/prefetch/download. Requisição compartilhada
  conserva a finalidade de quem iniciou; cache do navegador não gera requisição.
- `resolve_ms`: tempo de resolução no servidor, incluindo espera na fila.
- `queue_ms`, `extract_ms`, `extract_count`: espera, execução e quantidade de processos.
  Quem compartilha uma resolução não ganha outra contagem de extração.
- `first_byte_ms`: até o primeiro bloco do corpo recebido do upstream, desde a
  requisição de áudio. Não mede toque até som audível nem chegada ao alto-falante.
- `download_ms`: até encerramento da resposta de áudio, incluindo resolução.
  `bytes` conta corpo lido do upstream, não confirma persistência no CacheStorage.
  Range conta somente o trecho; cancelamentos podem incluir bytes ainda não entregues.
- `error`, `extract_error`: códigos; `status`, `cache`, `renewed`, `range` dão contexto.
  Início sem término pode indicar processo encerrado/coleta incompleta, sem provar causa.

## Benchmark no celular

O pacote `Stormusic-diagnostico.zip` permite medir antes de atualizar o servidor.
Baixe-o em Downloads. No Termux, com acesso ao armazenamento já concedido:

```bash
python -m zipfile -e ~/storage/downloads/Stormusic-diagnostico.zip ~/stormusic-diagnostico-r1
bash ~/stormusic-diagnostico-r1/phone/bench.sh --network wifi
```

São dez IDs iguais para seis clients: default, visionos, tv, web_safari, android_vr,
ios, com ordem rotativa. Há 15 s entre processos, além do tempo das extrações.
Não rode simultaneamente com download/reprodução. Mantenha Termux em primeiro plano.
Falhas ficam fora da mediana e aparecem na contagem; client com falhas não deve ser
escolhido somente por sua mediana. Algumas faixas podem não estar disponíveis na região.
O script salva `~/.stormusic/bench-*.jsonl` e resumo `.txt`. Envie o resumo e o JSONL
da execução. Repita com `--network mobile` se for comparar redes, anotando qual usou.
Mede resolução por processo novo, sem cache do servidor; não baixa o áudio inteiro.

## Coleta da interrupção do lote

### Execução temporária sem atualizar a instalação

Após confirmação de que o celular ainda está sem instrumentação, foi preparado
`artifacts/Stormusic-coleta-R1.zip`, com bundle compilado e `phone/diagnose.py`.
Salve em Downloads e execute no Termux:

```bash
python -m zipfile -e ~/storage/downloads/Stormusic-coleta-R1.zip ~/stormusic-coleta-r1
python ~/stormusic-coleta-r1/diagnose.py
```

O programa verifica o PID, argumentos e diretório do supervisor antes de pará-lo.
Cria uma pasta separada `~/stormusic-r1-*`, preserva `~/stormusic`, inicia o servidor
instrumentado na porta 8787 e desativa atualização automática durante a coleta.
Se houver processo desconhecido ou configuração personalizada, interrompe com aviso.
Não execute `setup.sh`, não use Atualizar app nem o botão de reset durante a coleta.

Com o servidor aberto, recarregue `http://localhost:8787` no Chrome e baixe um mix
com dez ou mais faixas ainda ausentes, mantendo Chrome visível. Anote o horário,
quantas faixas concluíram e a mensagem exibida. Volte ao Termux, pressione Ctrl+C
(o programa solicita reinício do supervisor original) e copie o log:

```bash
cp ~/.stormusic/metrics.jsonl ~/storage/downloads/stormusic-metrics-primeiro-plano.jsonl
```

Envie esse arquivo e o resultado observado. Não há necessidade de repetir o benchmark.
Se o Android encerrar a sessão antes de restaurar o servidor, execute
`bash ~/stormusic/phone/start.sh`. A cópia temporária é mantida; não se apaga nenhum
arquivo de dados. A troca do servidor pausa a reprodução durante a coleta.

Exige servidor e frontend desta R1 instalados. O setup antigo pula uma pasta
`~/stormusic` já existente: executá-lo de novo não atualiza a instalação.
O botão Atualizar depende da publicação de `phone-dist`; esta entrega não publicou
no GitHub. Benchmark recebido; a instalação da versão instrumentada e a
coleta abaixo permanecem pendentes até confirmar a versão em execução.

1. Anote horário, rede, tamanho do mix e faixas que já estavam salvas. Não limpe dados.
2. Com a versão instrumentada, mantenha Chrome visível, sem tocar música, e baixe
   um mix com pelo menos dez faixas ainda ausentes. Anote progresso e mensagem final.
3. Copie o log para preservar a execução:
   `cp ~/.stormusic/metrics.jsonl ~/storage/downloads/stormusic-metrics-primeiro-plano.jsonl`
4. Em outro mix, repita com tela apagada e anote duração; depois com reprodução
   simultânea. Não repita compulsivamente em caso de bloqueio/limite.
5. Envie logs e horários. Se áudio conclui mas a faixa falha na UI, investigar
   capas/cache no navegador; o log do servidor sozinho não identifica essa causa.

## Números e conclusão

| Medida no Z Flip 4 | Resultado |
| --- | --- |
| Mediana e sucesso dos seis clients | Medidos em Wi-Fi; tabela abaixo |
| Primeiro bloco de áudio / resolução / fila | Medidos no log de transferências abaixo |
| Interrupção após aproximadamente cinco faixas | Timeouts e interrupções identificados; não há limite fixo de cinco |
| Toque até primeiro som e intervalo entre faixas | Não medidos nesta instrumentação |

### Benchmark recebido em 13/10/2026

Fonte: `C:/Users/Thomas/Downloads/bench-20261013-225731-26421.jsonl`.
Validados 60 registros, dez vídeos distintos para cada um dos seis clients, sem
pares vídeo/client duplicados; todos identificados como Wi-Fi. Horários dos
registros: 22:57:34 a 23:15:04, UTC−03:00.

| Client | Sucessos | Mediana de sucesso | Mínimo–máximo de sucesso |
| --- | --- | --- | --- |
| default | 10/10 | 2.743,84 ms | 2.467,05–3.157,15 ms |
| visionos | 10/10 | 2.809,08 ms | 2.556,08–3.733,24 ms |
| tv | 0/10 | Não aplicável | Não aplicável |
| web_safari | 0/10 | Não aplicável | Não aplicável |
| android_vr | 0/10 | Não aplicável | Não aplicável |
| ios | 0/10 | Não aplicável | Não aplicável |

Default teve mediana 65,24 ms menor que visionos nesta amostra. A diferença pequena,
com uma execução por par, não comprova superioridade estável. Não há evidência aqui
para forçar visionos ou outro client no app. Default representa a seleção automática
do yt-dlp; o log não identifica quais clients internos ele utilizou.

As 40 falhas são `extract_failed`, sem motivo detalhado: não permitem distinguir
bloqueio, exigência de token, formato indisponível ou outra causa. Não houve timeout
registrado. Os dez sucessos de default e visionos são resoluções de URL, não downloads
completos; não explicam a interrupção do lote nem demonstram primeiro som em até 5 s.
Log de transferências posteriormente recebido e analisado abaixo.

### Transferências recebidas em 14/10/2026

Fonte: `C:/Users/Thomas/Downloads/metrics.jsonl`. São 128 registros: 65 inícios,
63 términos e duas transferências de download sem término no arquivo. Não há erro
de extração registrado; os términos das 38 requisições de resolução são HTTP 200.

| Medida | Resultado observado |
| --- | --- |
| Download de áudio sem Range, com término registrado | 15 tentativas, 10 IDs |
| Downloads concluídos sem erro de transporte | 7 |
| Erros de download | 2 audio_timeout, 3 client_closed, 3 upstream_stream_failed |
| Taxa efetiva dos downloads, incluindo tentativas interrompidas | Mediana 31,51 KiB/s; faixa 29,20–31,62 KiB/s |
| Primeiro bloco dos downloads | Mediana 374,18 ms |
| Duração das tentativas de download | Mediana 159,53 s |
| Respostas de reprodução com Range (206) | 8, sem erro; 3,85–6,21 MB por resposta |
| Duração das respostas com Range | Mediana 840,07 ms; mínimo 684,45 ms; máximo 1.884,38 ms |
| Resoluções sem cache, durante uso do app | 17; mediana 7.980,81 ms; máximo 17.157,64 ms |
| Espera máxima na fila de extração | 10.768,08 ms |

Os dois `audio_timeout` ocorreram em aproximadamente 180 s: esse é o limite
fixo do servidor. Os três `client_closed` de download ocorreram em 180,00 s,
compatíveis com o timeout de 180 s também existente no cliente; o log não permite
provar o motivo interno do fechamento do navegador. Três interrupções vieram do
fluxo upstream; sua causa externa específica não está registrada.

A faixa `tEXYfT_G0W0` falhou nas três tentativas de download (dois timeouts e uma
interrupção). O mesmo ID teve duas respostas de reprodução com Range, ambas de
5.881.117 bytes, em 888,50 ms e 1.884,38 ms. Não há evidência de um teto de cinco
downloads: sete tentativas terminaram sem erro. Não confundir resposta concluída
no servidor com persistência confirmada no CacheStorage.

Conclusão sustentada: a transferência sem Range avança lentamente, atinge o limite
de tempo e o cliente recomeça o arquivo inteiro. Esse mecanismo explica falhas
concretas do lote. A diferença por Range é uma associação forte nesta coleta,
inclusive para o mesmo ID, mas não prova a causa da limitação do servidor remoto.

### Correção priorizada com os dados disponíveis

- Downloads agora pedem `Range: bytes=0-`, como o transporte usado pelo player.
- Respostas 206 precisam cobrir de zero até o último byte do arquivo; tamanho
  declarado e corpo são conferidos. Um trecho incompleto não vira faixa offline.
  Respostas 200 completas continuam aceitas.
- O áudio é salvo antes de buscar capas. Falha da capa não repete nem invalida o
  download; arquivos já salvos não são regravados desnecessariamente.
- Mantidos client automático do yt-dlp, chaves `ytm.*`, mix anterior em caso de
  falha, limites de tempo e concorrência existentes. Não implementada ainda a
  retomada persistente em disco de R7, nem a fila prioritária de R6.

Validação local: 16 testes Node passaram, incluindo Range completo encaminhado ao
upstream, resposta truncada/intervalo incompleto, erro no corpo, compatibilidade
HTTP 200, capa indisponível e preservação do mix anterior. Os testes usam rede e
extrator simulados. Não há medição pós-correção no celular, nem comprovação de
primeiro som em 5 s, troca sem intervalo ou conclusão noturna. R1 encerrada com
essas limitações por orientação do usuário; não condicionar a implementação a
mais coletas. Instalação permanente descrita em `docs/ATUALIZACAO-LOCAL.md`.
