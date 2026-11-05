# Correção do fluxo de downloads — 26/10/2026

## Causas confirmadas

A exclusão ficava bloqueada durante todo o lote no servidor e durante a cópia no navegador. Além disso, excluir apenas movia o áudio para um backup, sem liberar espaço. O plano tinha um limite próprio, mas a biblioteca acumulava os planos anteriores. A instalação chegou a 93 entradas, sendo 88 arquivos concluídos, e a 118 backups de áudio.

## Comportamento novo

- **Excluir** cancela a transferência da faixa, aguarda o fechamento do arquivo e apaga áudio completo, parcial e cópias antigas. Funciona mesmo durante um lote. Repetir a operação é seguro.
- **Excluir todas as baixadas** remove também as faixas na fila. Uma confirmação simples substitui a confirmação com caixa “Entendi” para essas exclusões.
- A exclusão permanece registrada para impedir novo download da mesma faixa. Falhas de conexão ou armazenamento deixam uma exclusão pendente, informada na interface e retomada automaticamente. A cópia local é removida mesmo se o servidor estiver indisponível.
- Há no máximo **40 entradas ativas**, incluindo faixas baixadas, em transferência e aguardando download. O limite vale no servidor e no navegador.
- Atualizar as recomendações não substitui imediatamente uma biblioteca cheia. A renovação de vagas acontece ao iniciar o lote agendado, priorizando o plano vigente e removendo excedentes. O lote trabalha com um plano fixo, sem aumentar continuamente quando a interface busca recomendações.
- Backups antigos de áudio são removidos; apenas pequenos metadados dos backups podem permanecer. Não são criados novos backups de áudio ao excluir.
- O navegador reconcilia suas cópias com as faixas ativas do servidor, apaga cópias excedentes/duplicadas e não republica uma faixa excluída durante uma transferência.
- O botão **Baixar agora** foi reintroduzido a pedido do usuário: inicia somente a fila existente, inclui novas tentativas das falhas e não substitui a coleção pelo plano de recomendações. A rota `/api/v1/library/run` retorna 202 e usa o mesmo bloqueio contra execuções simultâneas. A rota antiga `/retry` continua desativada.
- A interface mostra contagem de músicas concluídas, barra geral e progresso por faixa, com atualização a cada segundo durante o lote. O botão fica desativado durante a execução ou quando não há músicas pendentes.
- Permanecem removidas a limpeza manual de faixas fora do plano e a restauração de backups de áudio.
- A opção **Manter cópia no navegador** explica o espaço extra ocupado. Desativá-la libera essa cópia, mantendo os downloads do motor. A limpeza do navegador no Perfil também libera espaço sem guardar outro áudio oculto.
- O intervalo de repetição de 1 a 10 dias continua disponível e foi coberto novamente pelos testes.

## Verificação e ativação

- **58 testes passaram:** 9 unitários e 49 de integração/interface, com servidor e estado temporários.
- Incluem exclusão durante resolução, durante gravação e durante cópia no navegador; confirmação na interface durante um lote; exclusão em massa; retry após falha; dois planos consecutivos de 40 músicas; migração de coleção acima do limite; limpeza de backups e duplicatas.
- TypeScript e build completo da PWA passaram. Os 21 arquivos do precache foram conferidos.
- Motor reiniciado pelo supervisor verificado. Após ativar: 40 entradas, 36 áudios concluídos, 4 na fila e **715,6 MiB liberados** no armazenamento do servidor. A limpeza das cópias do navegador ocorre ao carregar a interface nova.
- Áudios concluídos conferidos via HTTP Range e cabeçalho M4A; não houve teste de escuta integral nem teste manual no Chrome.

## Arquivos principais

- `server/library.ts`, `server/planner.ts`: exclusão física, migração e limite global.
- `server/downloadJobs.ts`, `server/downloads.ts`: cancelamento e sincronização com o gravador.
- `src/lib/offline.ts`, `src/lib/downloadActions.ts`: limpeza e recuperação de exclusões pendentes no navegador.
- `src/components/Downloads.tsx`, `src/components/Confirm.tsx`: fluxo de exclusão e interface simplificada.

A interface anterior está em `.backups/before-storage-fix-interface.tar`. Não foi criada cópia dos áudios excluídos para não voltar a ocupar o espaço liberado. As alterações permanecem locais, sem publicação no GitHub.

## Atualização: botão manual de fila

A pedido do usuário, “Baixar agora” voltou com execução restrita à fila existente. Validação desta atualização: 50 testes de servidor/interface e 9 testes unitários passaram, além de `tsc --noEmit` e compilação phone. A interface foi instalada em `dist` e o servidor reiniciado pelo supervisor. A checagem HTTP confirmou saúde e entrega do novo botão. Os testes de download usam fontes controladas; os downloads reais serão iniciados pelo usuário no botão.
