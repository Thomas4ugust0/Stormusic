# Instalar Stormusic no Android

Esta versão roda no próprio celular. Não é um APK: é um PWA instalado pelo Chrome, com um pequeno servidor no Termux. A instalação inicial exige comandos; o uso diário tem atalho e botões.

## 1. Preparar o aparelho

Instale **Termux, Termux:Boot e Termux:Widget pelo F-Droid**, todos da mesma origem. Abra o Termux:Boot uma vez. Mantenha esses apps instalados.

Copie `Stormusic-celular.zip` do PC para a pasta **Download** do celular. O ZIP contém `setup.sh`, `stormusic.bundle` (aplicativo compilado) e este guia. Não precisa instalar pnpm ou compilar no celular.

No Termux, execute um comando de cada vez:

```sh
termux-setup-storage
pkg install -y unzip
mkdir -p ~/stormusic-instalar
unzip -o ~/storage/downloads/Stormusic-celular.zip -d ~/stormusic-instalar
bash ~/stormusic-instalar/setup.sh
```

Aceite o acesso aos arquivos quando o Android solicitar. O instalador instala Python, Node, Git, util-linux (flock), yt-dlp e yt-dlp-ejs; clona o bundle em `~/stormusic`; cria os atalhos e inicia o servidor. Pode rodar novamente sem apagar uma instalação existente. Se `~/stormusic` já existir com outro projeto/instalação incompleta, preserve a pasta antiga e escolha outra localização antes de repetir.

Abra **http://localhost:8787** no Chrome. Use **Instalar app / Adicionar à tela inicial** no menu do Chrome. Use sempre `localhost`, pois `127.0.0.1` possui outro armazenamento de navegador.

## 2. Tocar e baixar

1. Escolha gêneros, subgêneros e artistas no onboarding.
2. Em **Biblioteca → Motor local**, confira a versão do yt-dlp e use **Testar com uma faixa**. Esse botão confirma a resolução; toque uma faixa para verificar a reprodução real.
3. Use **Explorar** para buscar; toque uma música para iniciar seu rádio.
4. Em **Início**, atualize o Supermix e toque **Baixar agora**. Deixe o app aberto durante o download.
5. Espere **Disponível offline** com o total de faixas. Em falhas parciais, tente novamente: o download aproveita os arquivos já salvos e preserva o mix anterior.
6. Ative modo avião e toque o Supermix. Nome, artista, duração e capas ficam disponíveis. Verifique também a notificação.

Os áudios ficam no armazenamento privado do PWA (Cache Storage), e não na pasta Downloads. Não limpe os dados do Chrome se quiser preservá-los. O navegador pode negar armazenamento persistente; o painel mostra o estado.

## 3. Início automático e atalho

O instalador cria `~/.termux/boot/stormusic.sh` e `~/.shortcuts/tasks/Stormusic.sh`. Adicione o widget/atalho do **Termux:Widget** à tela inicial e selecione **Stormusic**. Esse atalho religa o servidor em segundo plano com um toque; o ícone do PWA abre a interface.

Depois de reiniciar o aparelho, aguarde o Termux:Boot iniciar o serviço. Se aparecer **Servidor parado**, toque no atalho Stormusic e depois em **Tentar de novo**.

No Samsung, procure as opções de bateria **Sem restrições** e **Apps que nunca dormem** para Termux, Boot, Widget e Chrome. Os nomes e a disponibilidade variam por versão da One UI; verifique no próprio aparelho. Confira reprodução por 30 minutos com a tela apagada e ao dobrar/desdobrar o Z Flip 4. O wake lock ajuda, mas não garante que o Android manterá o processo.

Se houver encerramentos persistentes por restrições de processos filhos, investigue as opções de desenvolvedor específicas da sua versão. Alterações avançadas por ADB não foram verificadas nesta entrega e não são necessárias para a instalação padrão.

## 4. Atualização sem terminal

- **Atualizar yt-dlp**: instala as versões atuais de yt-dlp/ejs e verifica a instalação. Se falhar, tenta reinstalar as versões anteriores. Também há tentativa automática ao iniciar, quando a última atualização tem mais de 7 dias.
- **Atualizar app**: pede confirmação, atualiza a distribuição `phone-dist`, reinicia o servidor e recarrega o PWA. Requer a branch remota publicada pelo workflow. Nesta entrega local, o ZIP já instala a versão nova; a publicação no GitHub ainda precisa ocorrer.
- Uso manual opcional: `bash ~/stormusic/phone/update.sh ytdlp` ou `bash ~/stormusic/phone/update.sh app`, com servidor ligado.

O atualizador recusa checkouts com alterações locais, para não apagá-las. Estado: `~/.stormusic/state.json`; log: `~/.stormusic/server.log` (máximo 1 MiB).

## 5. Verificação real no celular (pendente)

O PC validou contratos com executáveis falsos; isso não mede bloqueios do YouTube na sua rede. Execute antes de depender do app:

```sh
curl -s http://localhost:8787/health
curl -s 'http://localhost:8787/api/v1/audio/search?q=arctic%20monkeys&limit=5'
curl -s 'http://localhost:8787/api/v1/audio/related?id=bpOSxM0rNPM&limit=5'
curl -s http://localhost:8787/api/resolve/9bZkp7q19f0
curl -s -r 0-99999 -o /dev/null -w '%{http_code} %{size_download}\n' 'http://localhost:8787/api/audio?id=9bZkp7q19f0'
```

O último deve retornar `206 100000`. Toque 10 músicas diferentes por Wi-Fi e por dados móveis (meta: pelo menos 9 funcionando). Confira busca, rádio, download das 25 faixas, modo avião, capas, notificação, reinício, atalho e 30 minutos com tela apagada/dobrada. Erro de IP recusado: tente outra rede. Erro de extrator: atualize yt-dlp.

## Infraestrutura anterior

O app local não usa credenciais de proxy nem a VM Oracle. A revogação de credenciais Bright Data/Zyte, troca de senha do Postgres e desligamento da VM exigem acesso às respectivas contas e **não foram executados**. Confira primeiro se há código exclusivo na VM. Não reescreva o histórico compartilhado sem coordenar com quem usa o repositório.
