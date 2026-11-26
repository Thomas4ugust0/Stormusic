# Stormusic para Windows

A versão portátil roda no Windows 10 ou 11 em um PC x64. Ela inclui a janela completa do Stormusic e um miniplayer que fica sobre as outras janelas.

## Baixar e abrir

1. Baixe [Stormusic-Windows-x64.exe](https://github.com/Thomas4ugust0/Stormusic/releases/download/v1.0.0-windows/Stormusic-Windows-x64.exe) na [página da versão](https://github.com/Thomas4ugust0/Stormusic/releases/tag/v1.0.0-windows).
2. Abra o arquivo com dois cliques. O executável é portátil e inicia o motor local automaticamente. Mantenha a internet conectada na primeira abertura para baixar o extrator de áudio. O download é verificado pelo Stormusic.
3. Selecione seus gêneros e artistas. Use **Modo widget** no topo do app para abrir o miniplayer. O botão **Voltar ao app** expande a janela. A faixa e a posição são mantidas durante a troca.
4. Use **Biblioteca** para ver as faixas baixadas e ouvi-las offline.

O perfil e a biblioteca são salvos em `%APPDATA%\Stormusic`. Para atualizar, feche a versão que está aberta e execute o novo arquivo da página de versões. O executável desta versão usa o motor local na porta 38277.

O executável está sem assinatura digital. A página da versão também publica a soma SHA-256 para conferir o arquivo baixado.

## Gerar o executável a partir do código

No Windows x64 com Node.js 24 e Git, execute estes comandos no PowerShell.

```powershell
git clone --branch phone-dist --single-branch https://github.com/Thomas4ugust0/Stormusic.git
cd Stormusic
npm ci
npm ci --prefix desktop
npm run package:desktop
```

O arquivo gerado fica em `desktop/build/windows/Stormusic-Windows-x64.exe`. Para testar a janela e o áudio local do pacote, execute `npm --prefix desktop run test:windows`.
