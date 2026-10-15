# Atualização local — player, biblioteca persistente e plano diário

Salve `Stormusic-atualizacao.zip` em Downloads. No Termux:

```bash
python -m zipfile -e ~/storage/downloads/Stormusic-atualizacao.zip ~/stormusic-atualizacao
python ~/stormusic-atualizacao/atualizar.py --install
```

O pacote inclui o player com dois áudios, biblioteca em disco, fila persistente,
agendador diário, tela Baixadas, cópia offline do navegador, confirmação/backup
e os ícones originais da marca. Não precisa de npm, pnpm, novo benchmark ou
publicação no GitHub. Usa Python, Node e Git já presentes na instalação.

O instalador confere o supervisor, prepara a distribuição antes de parar o app,
verifica a sintaxe do ponto de entrada Node e preserva a pasta anterior inteira
em `~/stormusic-r1-<identificador>-backup`. O caminho exato aparece no Termux.
Depois ativa a versão nova em `~/stormusic` e solicita a inicialização pelo
supervisor existente. Os atalhos continuam apontando para a mesma pasta.
Se a ativação da pasta falhar, restaura a original. Nenhum arquivo de backup é
apagado automaticamente; não há reset dos dados do site, curtidas ou caches.

A reprodução é pausada durante a instalação. Ao terminar, abra
`http://localhost:8787` no Chrome e recarregue para receber o frontend atualizado.
O service worker usa atualização automática; se a página antiga continuar aberta,
feche-a e abra novamente, sem limpar os dados do site.

No Perfil, Reiniciar gosto e curtidas mantém as preferências escolhidas e os áudios.
Limpar cópia do navegador mantém uma cópia recuperável por sete dias; essa cópia continua
ocupando espaço. Se faltar espaço para criar o backup, os originais não são apagados.
O toast Desfazer fica disponível por oito segundos; a restauração também está no
Perfil. Like e unlike permitem desfazer. Dislike mantém o peso original e não soma
um segundo sinal de pulo/escuta ao trocar a faixa.

O manifest usa novos nomes de arquivo para os ícones da marca. A atualização do
ícone já instalado depende do Chrome/Android; o pacote não controla esse momento.
Não limpe os dados do site para trocar o ícone. O vermelho original é `#E50C16`.

Não execute `setup.sh` como atualização: ele pula instalações já existentes.
O botão Atualizar app ainda depende de uma distribuição publicada em `phone-dist`;
esta entrega não publicou no GitHub. O pacote local já contém a correção.

Se aparecer aviso de supervisor desconhecido, porta ocupada ou configuração
personalizada, o instalador não substitui a instalação. Não tente apagar dados
para resolver esse aviso. A cópia anterior permanece disponível caso seja
necessária recuperação. Não é solicitada nenhuma nova coleta de desempenho.


## Uso da versão nova

Depois de abrir o app, o plano é enviado ao servidor. Em Biblioteca → Baixadas,
“Baixar agora” inicia o lote. Fechar o Chrome não interrompe a fila do Termux.
O painel mostra as faixas prontas, progresso, falhas e minutos efetivamente baixados.
A meta de 120 minutos só está atendida quando o contador alcançar esse valor.

Mantenha o Termux com bateria sem restrições e seu atalho/supervisor ativo.
O agendador usa o fuso do Android, inicia entre 00:00 e 00:10 e encerra o lote
noturno às 07:00. Se o servidor estava desligado, retoma ao iniciar.
A noite real e as metas de latência não foram medidas nesta versão.

A cópia para o navegador acontece gradualmente com a página visível e o player
fora de carregamento. Ela protege contra o Termux parado. Baixar no disco não
significa que todas as cópias do navegador já terminaram: o Perfil mostra sua
contagem. Limpar essa cópia pausa o espelhamento até “Baixar agora”.

Remover uma faixa em Baixadas pede confirmação e preserva backup em
`~/.stormusic/backups/`. Esses backups continuam ocupando espaço. A limpeza
sugerida só inclui faixas fora do plano há 24 horas após concluir um lote novo.

Não é preciso executar testes ou coletar logs. O ZIP já contém o build pronto.

Atualização após testes: 40 testes Node e 7 Python passaram no PC, com correções
no bloqueio das atualizações e na pausa entre downloads lentos. O pacote inclui
essas correções. Não exige execução de testes no celular.
