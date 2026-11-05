> Atualização de 26/10/2026: o fluxo de exclusão foi substituído por exclusão física, sem backups de áudio, e a biblioteca passou a ter limite de 40 faixas. Veja [DOWNLOADS.md](DOWNLOADS.md). O restante deste documento descreve a implementação anterior.

# Downloads e intervalo de repetição — 25/10/2026

## Mudanças

- Remover uma faixa passa a excluir seu ID de planos e filas automáticas. Um plano reenviado, inclusive com download imediato, não desfaz a remoção. O servidor aplica a exclusão também ao ler planos antigos e após reiniciar.
- A exclusão é sincronizada com o navegador; respostas antigas da biblioteca não voltam a copiar o áudio. Backups das músicas removidas continuam preservados.
- Biblioteca → **Não repetir músicas por**: controle de 1 a 10 dias, padrão de 1 dia (24 horas corridas). A preferência persiste no navegador e é incluída na exportação de backup.
- Histórico aplicado a planos carregados, novas recomendações, alternativas do catálogo, fila existente e reprodução offline. Faixas ouvidas começam a ser registradas após um segundo real de reprodução; o horário é atualizado a partir da última reprodução, não do tempo passado em pausa.
- Histórico recente preservado separadamente do limite de 3.000 sinais de gosto. Variações reconhecíveis de uma música do mesmo artista também são filtradas.
- A faixa atual continua ao ajustar o slider. Se não houver próximas músicas elegíveis, a fila para e mostra uma mensagem; não relaxa a regra para completar a lista.
- Planos vazios são aceitos quando não há músicas elegíveis. A falta de recomendações online não restaura faixas bloqueadas.

## Verificação

- 9 testes unitários e 39 testes de integração/interface passaram na pasta instalada (48 no total).
- Cenários: remoção + download imediato + reinício real do processo; cópia offline com resposta antiga; intervalo de 1 a 10 dias e limites exatos; persistência após recarregar; histórico com mais de 3.000 sinais; slider interativo em DOM simulado; término da fila offline sem repetição.
- TypeScript sem erros. Build da interface e do service worker concluídos. Precache conferido, incluindo imagens PNG reais.
- Motor reiniciado pelo supervisor existente. `/health` OK; 30 músicas concluídas e zero falhas após a atualização. Leitura parcial de áudio local conferida.
- Os testes da interface usam áudio e APIs simulados; não substituem uma sessão de escuta no Chrome e com tela bloqueada.

## Desenvolvimento e recuperação

O código-fonte ausente na distribuição foi recuperado do repositório original, commit `9a11f22a00c9cfdecef1d3d5ddea9a14488f1b71`, e agora está em `src/`. Os ícones originais da instalação foram preservados: os arquivos do clone eram referências Git LFS. `package-lock.json` fixa as dependências usadas. O service worker passou a ser compilado pelo Vite com `injectManifest`, evitando a etapa de geração que travava neste Android.

```sh
npm run test:unit
npm run test:relay
npx tsc --noEmit
npm run build:phone
```

Nesta sessão do agente, os comandos foram executados com `env -u LD_LIBRARY_PATH` para evitar o conflito com as bibliotecas do agente. Nenhuma configuração global foi alterada. Testes de processos usam prazos compatíveis com o celular e execução sequencial.

Backup da versão instalada antes da alteração: `.backups/before-download-repeat-fix.tar`. Ele contém distribuição, servidor, scripts phone e package.json anteriores; a biblioteca pessoal não foi substituída. Fontes e alterações não foram publicados no GitHub. O atualizador existente recusa sobrescrever checkouts modificados, preservando este trabalho local.

Recarregue a página do Stormusic para carregar a nova interface. Não é necessário limpar os dados do navegador.
