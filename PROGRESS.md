# Progresso

Implementação local seguindo `docs/PLAN-PHONE.md`. O pedido abrangeu todas as mudanças, sem executar separadamente os prompts de pausa da seção 9.

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
