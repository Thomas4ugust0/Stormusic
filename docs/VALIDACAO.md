# Conferência final — 14/10/2026

Após a entrega inicial sem testes, o usuário autorizou sua execução. Rodada final: 40 testes Node e 7 Python passaram; TypeScript e build também passaram. Nenhum benchmark novo é solicitado. Casos de rede, áudio e relógio usam substitutos controlados; isso não equivale a medir o aparelho.

## Implementação

- Player com redutor puro, identificação de pedidos, intenção lida no momento de tocar, dois elementos de áudio, pré-carga e MediaSession.
- Worker Python residente, fila de resolução prioritária, cache de 300 entradas e limite de cinco horas. Client padrão mantido com base nas medições recebidas. A opção Python `js_runtimes` usa o dicionário de configuração documentado pelo projeto: [yt-dlp / discussão da API Python](https://github.com/yt-dlp/yt-dlp/issues/15466). Python/yt-dlp não estão instalados neste PC para validar integração real; `RELAY_RESOLVER=spawn` mantém a alternativa por processo.
- Biblioteca e plano em JSON atômico. Downloads no Termux, um por vez, intervalo de 15–45 s, três tentativas, disjuntor, arquivos parciais e tamanho final conferido. Um digest de identidade do conteúdo permite retomar parcial após reinício enquanto a fonte anterior ainda vale; identidade ausente, diferente ou expirada exige reinício seguro. URLs assinadas e cabeçalhos não são persistidos.
- Agendador local, atraso até dez minutos, limite noturno às 07:00 e catch-up ao iniciar. Fuso exportado pelo supervisor e exposto em `/health`.
- Plano puro mantém não ouvidas e repõe consumidas; 25 a 40 faixas visando 120 min. A falta de candidatos/durações suficientes não vira promessa de cobertura.
- Baixadas mostra progresso, falhas, nova tentativa, estimativa calculada e remoção confirmada com backup.
- Cópia gradual do disco para CacheStorage com reserva de 150 MiB; ordem de reprodução cache → disco → fonte online. API e áudio não entram no cache de runtime do service worker.
- Dislike suprime sinal de fechamento adicional. Pesos preservados; cálculo de gosto puro com horário recebido como argumento.
- Ícones originais da marca e URLs novas no manifest.

## Decisões de proteção e limites

- A regra de confirmação de exclusões prevalece sobre faxina automática: faixas fora do plano por 24 h ficam elegíveis para limpeza somente depois de um lote concluído; a tela solicita confirmação e preserva backup. Não há exclusão física automática de backups.
- Concorrência padrão de **um**, configurável até dois por `RELAY_DOWNLOAD_CONCURRENCY`; os inícios compartilham o ritmo de 15–45 s e o disjuntor. O padrão prioriza os dados medidos e RN5.
- “Limpar cópia do navegador” não apaga o disco do Termux e pausa novas cópias até “Baixar agora”. Remoção de arquivos do Termux fica em Baixadas.
- Backups do servidor ficam em `~/.stormusic/backups/<identificador>/`, com áudio e metadata. A recuperação desses backups é manual; a restauração do Perfil atende o backup do navegador.
- O servidor executa o último plano recebido. Novas recomendações exigem que o app abra para calcular/enviar o plano; à noite o Termux baixa as pendências mesmo com Chrome fechado.
- Android pode suspender ou encerrar o Termux. A execução local precisa de bateria sem restrição; o agendador retoma quando o servidor volta.

## Metas sem validação nesta versão

| Meta | Situação |
| --- | --- |
| Primeiro som até 5 s / local até 1 s | Instrumentação automática em `ytm.playerMetrics`; não medido após alterações |
| Intervalo até 200 ms | Dois áudios e pré-carga implementados; não medido no aparelho |
| Play/pause em vinte toques | Correção implementada; não executado por orientação atual |
| 25 faixas entre 00:00–07:00 | Agendador implementado; noite real não observada |
| 120 min com Termux parado | Cache e contagem implementados; percurso não executado |
| Reinício durante download | Retomada de arquivo parcial após novo processo Node passou com rede simulada; Android não avaliado |

Build, TypeScript, sintaxe e diff conferidos ao final; resultados registrados em `PROGRESS.md`. Compilar não comprova comportamento do YouTube, autoplay do Chrome ou execução em segundo plano no Android.


## Regressões corrigidas pelos testes

1. Atualização podia informar conclusão antes de terminar a persistência/liberar seu bloqueio. A resposta agora continua `running` até a operação concluir.
2. Download lento consumia o intervalo entre inícios e eliminava a pausa após terminar. A fila agora respeita 15–45 s depois de concluir o arquivo.

Comandos reproduzíveis no PC:

```text
pnpm test:unit
pnpm test:relay
python -B -m unittest discover -s phone -p "*_test.py"
python -B server/ytdlp_worker_test.py
pnpm exec tsc --noEmit
pnpm build
```

O protocolo Python foi exercitado com módulo yt_dlp falso. A integração com a versão real instalada no Termux, as políticas de autoplay do Chrome e a execução noturna dependem do aparelho e não são certificadas por estes testes.
