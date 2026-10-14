# Stormusic

PWA de música pessoal para Android/Chrome. O próprio celular serve a interface e extrai o áudio com Node + yt-dlp no Termux, em **http://localhost:8787**. Sem Docker, Oracle, conversão ou proxy no modo local.

## Instalar no celular

Siga [docs/PHONE.md](docs/PHONE.md). O pacote `artifacts/Stormusic-celular.zip` inclui o PWA compilado e um Git bundle para instalar sem esperar a publicação da branch `phone-dist`.

Depois da instalação inicial: abra o PWA, busque músicas, toque e use **Baixar agora** no Supermix. Os arquivos ficam no armazenamento offline do app; não são exportados para a pasta Downloads. Aguarde **Disponível offline** antes de ativar o modo avião. O painel **Biblioteca → Motor local** testa o servidor e atualiza yt-dlp/app.

## Desenvolvimento no PC

Node >=22.18 (recomendado 24) e pnpm 10 ou superior:

```sh
pnpm install --frozen-lockfile
pnpm test:relay
pnpm exec tsc --noEmit
pnpm build:phone
pnpm relay
```

Para extrair áudio de verdade, instale também Python, yt-dlp e yt-dlp-ejs. Os testes usam executáveis falsos e não dependem do YouTube. O servidor Vite já inclui a API local no desenvolvimento. `build:phone` fixa base `/`, mesmo com `FIGMA_PUBLIC_URL` definido.

O workflow [phone-dist.yml](.github/workflows/phone-dist.yml) publica uma distribuição compilada em `phone-dist` quando estas alterações forem enviadas a `main`/`master`, ou por execução manual. A instalação pelo ZIP funciona antes dessa publicação; o botão **Atualizar app** precisa da branch remota publicada.

[Arquitetura](ARCHITECTURE.md) · [Plano](docs/PLAN-PHONE.md) · [Verificações e pendências](PROGRESS.md)

`audioflow/` e sua implantação Oracle são legado opcional, fora do funcionamento local.
