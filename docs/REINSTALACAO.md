# Reinstalar Stormusic com o código novo

Este ZIP é completo: contém o PWA compilado, servidor Node/Python, ícones da marca, instalador e ferramentas de preservação. Não precisa de GitHub nem de compilar no celular.

## Antes de desinstalar

Desinstale somente o PWA Stormusic, depois das cópias abaixo. Mantenha Termux, Chrome, Termux:Boot e Termux:Widget. Não limpe os dados do Chrome.

As pastas `~/stormusic-r1-*-backup` são cópias do código anterior; o instalador não colocou nelas o armazenamento do Chrome nem a pasta separada `~/.stormusic`. Dois backups de código são normais após duas atualizações. Não é preciso escolher ou apagar nenhum deles: a versão limpa vem deste ZIP; a biblioteca do servidor é compartilhada em `~/.stormusic` e será mantida.

1. Copie `Stormusic-reinstalacao-completa.zip` para Download no celular.
2. No Termux, execute:

```bash
termux-setup-storage
pkg install -y python
python -m zipfile -e ~/storage/downloads/Stormusic-reinstalacao-completa.zip ~/stormusic-reinstalar-vnova
python ~/stormusic-reinstalar-vnova/preparar.py
```

O último comando lista os caminhos exatos dos backups (evita digitar o nome que ficou quebrado na mensagem), pausa o servidor verificável, salva `Stormusic-dados-termux-<data>.tar.gz` em Download e religa o servidor. Ele copia os dados e áudios de `~/.stormusic`; arquivos originais e backups anteriores permanecem. Se ocorrer erro, não prossiga com a desinstalação.

3. No **mesmo Chrome usado pelo app**, abra:

```text
http://localhost:8787/offline/stormusic-backup.html
```

Toque em **Salvar backup no celular**. Confira que `Stormusic-perfil-<data>.json` foi salvo em Download. Ele contém perfil, curtidas, gosto, mix, plano e eventual backup interno de gosto. Não contém credenciais. Se a página disser **Perfil ausente**, confira se está no Chrome correto e em `localhost`, não em `127.0.0.1` ou no navegador da prévia do PC. O exportador só salva dados ainda presentes; não recupera dados já apagados sem uma cópia anterior.

Áudios que existiam apenas no CacheStorage do Chrome não são exportados no JSON; podem precisar ser baixados novamente. Os áudios no disco do Termux estão na cópia TAR e permanecem no servidor.

## Instalar o código limpo

4. Com os dois arquivos de backup salvos, remova o PWA Stormusic pelo Android. Não desinstale Termux nem Chrome, nem apague pastas.
5. No Termux, execute:

```bash
if [ -d "$HOME/stormusic" ]; then
  python ~/stormusic-reinstalar-vnova/diagnose.py --install
else
  bash ~/stormusic-reinstalar-vnova/setup.sh
fi
```

Com a pasta existente, o instalador prepara um checkout limpo do bundle, verifica-o e troca o código, preservando mais uma cópia inteira da pasta anterior. `~/.stormusic` e os dois backups antigos permanecem. Se houver configuração personalizada, supervisor desconhecido ou porta ocupada, ele interrompe; não apague arquivos para contornar esse aviso.

6. Feche as outras páginas do Stormusic. Abra `http://localhost:8787/offline/stormusic-backup.html` no Chrome. Se os dados do navegador tiverem desaparecido, selecione o JSON salvo, marque **Entendi** e toque em **Confirmar restauração**. Uma cópia dos valores atuais é salva antes da substituição. Se o perfil já estiver correto, não precisa importar.
7. Abra `http://localhost:8787/`. Confira a marca e as curtidas, depois use **Instalar app / Adicionar à tela inicial** no Chrome. As músicas do Termux aparecem em Biblioteca → Baixadas. Mantenha o Termux sem restrição de bateria.

O PWA e o atalho do Termux são diferentes: o ícone do PWA usa a marca do manifest; o atalho do Termux:Widget inicia o servidor. Reinstalar o PWA não muda o ícone do widget do Termux.

## Uso diário

Se o servidor estiver parado, toque no atalho Stormusic do Termux:Widget. Abra o PWA; em Biblioteca → Baixadas, **Baixar agora** inicia o lote no Termux. Os arquivos prontos podem tocar após o lote. A cópia para o navegador ocorre gradualmente com o app visível; ela é necessária para tocar com o Termux parado.

Guarde os dois arquivos de backup em Download. O TAR é uma cópia de emergência dos dados do servidor; nesta reinstalação eles já permanecem em `~/.stormusic`, então não extraia o TAR por cima da biblioteca em uso. Os backups antigos de código não substituem o JSON do Chrome.
