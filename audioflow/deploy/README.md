> **Legado / superado:** o modo principal agora roda no celular. Consulte [PHONE.md](../../docs/PHONE.md). Este documento descreve somente a arquitetura anterior.

# Deploy na Oracle Cloud (ARM, Always Free)

1. **VM**: `VM.Standard.E2.1.Micro` (AMD, 1 GB) ou `VM.Standard.A1.Flex` (ARM), Ubuntu 22.04.
   Na *Security List* da VCN, libere entrada TCP 80 e 443 (e UDP 443).
   Na VM: `sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`
2. **Swap (obrigatório na E2.1.Micro)**:
   ```sh
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   echo 'vm.swappiness=20' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system
   ```
   **Docker**: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (relogar).
3. **Domínio**: crie um subdomínio grátis em duckdns.org apontando para o IP público da VM.
4. **Código + config**:
   ```sh
   git clone <repo> && cd <repo>/audioflow
   cp deploy/env.production.example .env   # edite DOMAIN e a senha (nos dois lugares)
   ```
5. **Frontend** (na sua máquina ou na VM, na raiz do projeto): `pnpm build` e copie `dist/` para `audioflow/deploy/web/`
   (`rsync -a --delete dist/ ubuntu@VM:~/<repo>/audioflow/deploy/web/`).
6. **Subir**: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
   O primeiro build demora (~10 min na Micro). O Caddy emite o certificado TLS sozinho. Teste `https://DOMAIN/health`.
7. **API key** (AUTH_ENABLED=true): `make key NAME=celular` (ou o comando equivalente do Makefile via `docker compose exec api`).
   No app: Biblioteca → AudioFlow API → URL `https://DOMAIN` + a key.
8. **yt-dlp semanal**: `crontab -e` → `0 4 * * 1 $HOME/<repo>/audioflow/deploy/update-ytdlp.sh`
   IPs de datacenter podem ser bloqueados pelo YouTube; se acontecer, use cookies do yt-dlp via volume.
9. **No Android**: abra `https://DOMAIN` no Chrome → Biblioteca → *Instalar app* (ou menu ⋮ → Instalar app).
