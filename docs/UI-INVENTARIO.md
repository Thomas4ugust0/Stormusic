# Inventário da interface — R3

Arquivo principal: `src/App.tsx`. A autorização de 14/10/2026 abrange as etapas restantes; a exigência de confirmação para retirar abas foi preservada.

| Elemento | Handler / função | Decisão |
| --- | --- | --- |
| Logo, nome, favicon e ícones instaláveis | Identidade, sem ação | Marca original Stormusic |
| Gêneros do onboarding | `tog` | Manter |
| Subgêneros do onboarding | `tog` | Manter |
| Artistas do onboarding | `tog` | Manter |
| Voltar / Continuar / Gerar meu Supermix | `setStep`, `onDone` | Manter |
| Busca no cabeçalho | `setTab` | Manter |
| EU | `setProfileOpen` | Manter; nunca apaga dados no toque |
| Cast do cabeçalho | Nenhum | Remover |
| Cast do player | Nenhum | Remover |
| Humores | `changeMood` | Manter; não gera fila online sem conexão |
| Card Supermix / Tocar | `startMix` | Manter |
| Atualizar mix | `refreshMix` | Manter; recalcula plano diário |
| Baixar agora | `startDownload`, `sendPlan` | Fila persistente do Termux |
| Atalho Baixadas | `setTab` | Adicionar |
| Progresso e estado do lote | GET library | Manter com título, percentual e estimativa |
| Faixas, capas e cards de gêneros | `startMix` | Manter |
| Favorito / Descoberta / novo nas linhas | Apenas apresentação | Remover |
| 80% favoritos / 20% descobertas | Apenas apresentação | Remover |
| Início | `setTab` | Manter |
| Amostras e seus cards | `setTab`, `startMix` | Manter; têm ação real |
| Explorar | `setTab` | Manter |
| Campo de busca | `setQ` | Manter; consulta remota somente com conexão |
| Resultados da busca | `playRadio` | Manter; rádio indisponível offline |
| Biblioteca | `setTab` | Manter |
| Playlists / Músicas / Artistas no topo | Nenhum; spans com aparência de filtro | Remover rótulos inertes |
| Músicas curtidas | `startMix` | Manter |
| Supermix na Biblioteca | `startMix` | Manter |
| Interesses e contagem de sinais | Apresentação de dados reais | Manter |
| Refazer onboarding | `setProfile` | Manter; não apaga armazenamento |
| Limpar cópia do navegador | `setProfileOpen`, `safeReset` | Confirmar e copiar backup antes de limpar |
| Instalar app | `installEvt.prompt` | Manter |
| Motor local | `LocalEngine` | Manter ações existentes de atualização |
| Configuração legada | `setRelay`, `setAudioFlow`, `testAudioFlow` | Manter apenas no modo legado |
| Miniplayer / abrir player | `setFull` | Manter |
| Gostei / Não gostei | `react` | Manter; dislike não duplica sinal de fechamento |
| Play / Pause, mini e tela cheia | `Player.intent` | Unificar intenção e eventos reais do áudio |
| Anterior / Próxima | `prev`, `next` | Manter |
| Fechar player | `setFull`, `setPanel` | Manter |
| Música / Vídeo | Nenhum seletor de vídeo | Manter identificação Música; retirar rótulo Vídeo |
| Heart do player | Nenhum | Remover |
| Shuffle | Nenhum | Remover |
| Repeat | Nenhum | Remover |
| Posição do áudio | `currentTime` | Manter |
| A seguir e faixas da fila | `setPanel`, `setIdx` | Manter |
| Letra | `setPanel` | Manter painel, mostrar indisponibilidade; retirar versos fictícios |
| Relacionado | Nenhum | Remover |
| Desfazer | Ação guardada em `undo` | Manter |

Componentes adicionais:

| Arquivo / elemento | Handler | Decisão |
| --- | --- | --- |
| `Confirm.tsx`: Cancelar, Entendi, Confirmar | `onCancel`, `setUnderstood`, `onConfirm` | Manter foco inicial em Cancelar e confirmação explícita |
| `ProfilePanel.tsx`: Fechar | `onClose` | Manter |
| Perfil: restaurar gosto e downloads | `restoreTaste`, `restoreDownloads` | Manter |
| Perfil: reiniciar gosto / limpar navegador | `safeReset` | Manter backup e confirmação |
| `Downloads.tsx`: capa de faixa pronta | `play` | Tocar áudio local |
| Baixar agora / Tentar de novo | `/run`, `/retry` | Adicionar |
| Remover / limpar antigas | `Confirm`, DELETE library | Adicionar; backups antes da retirada |
| Estados, próxima atualização, minutos e MB | GET library | Dados reais; não apresentar cobertura de 120 min como concluída antes de baixar |
