#!/data/data/com.termux/files/usr/bin/bash
export TZ="$(getprop persist.sys.timezone 2>/dev/null || true)"
export TZ="${TZ:-America/Sao_Paulo}"
set -euo pipefail
STATE_DIR="${RELAY_STATE_DIR:-$HOME/.stormusic}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$STATE_DIR"
if [ "${1:-}" != '--supervise' ]; then
  nohup bash "$0" --supervise </dev/null >/dev/null 2>&1 &
  exit 0
fi
exec 9>"$STATE_DIR/server.lock"
flock -n 9 || exit 0
echo "$$" > "$STATE_DIR/server.pid"
trap 'rm -f "$STATE_DIR/server.pid"; termux-wake-unlock >/dev/null 2>&1 || true' EXIT
trap 'kill "${CHILD_PID:-}" 2>/dev/null || true; exit 0' TERM INT
termux-wake-lock || true
cd "$APP_DIR"
while true; do
  # The logger rewrites the bounded tail on every line, including long sessions.
  RELAY_HOST=127.0.0.1 node server/standalone.ts > >(node phone/log.ts "$STATE_DIR/server.log") 2>&1 &
  CHILD_PID=$!
  wait "$CHILD_PID" || true
  sleep 2
done
