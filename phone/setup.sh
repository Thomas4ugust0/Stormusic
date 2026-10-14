#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
pkg install -y python nodejs git util-linux
pip install -U yt-dlp yt-dlp-ejs
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/stormusic"
REPO_URL="https://github.com/Thomas4ugust0/Stormusic.git"
if [ ! -d "$APP_DIR" ]; then
  if [ -f "$SOURCE_DIR/stormusic.bundle" ]; then
    git clone -b phone-dist "$SOURCE_DIR/stormusic.bundle" "$APP_DIR"
    git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  else
    git clone --depth 1 -b phone-dist "$REPO_URL" "$APP_DIR"
  fi
fi
test -f "$APP_DIR/dist/index.html" || { echo 'Instalação incompleta: dist/index.html ausente.'; exit 1; }
mkdir -p "$HOME/.termux/boot" "$HOME/.shortcuts/tasks" "$HOME/.stormusic"
for TARGET in "$HOME/.termux/boot/stormusic.sh" "$HOME/.shortcuts/tasks/Stormusic.sh"; do
  printf '#!/data/data/com.termux/files/usr/bin/bash\nbash "$HOME/stormusic/phone/start.sh"\n' > "$TARGET"
  chmod +x "$TARGET"
done
chmod +x "$APP_DIR"/phone/*.sh
bash "$APP_DIR/phone/start.sh"
echo 'Pronto. Abra http://localhost:8787 no Chrome e escolha Instalar app.'
