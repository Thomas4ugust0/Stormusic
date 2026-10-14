#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Reuse the protected updater, including lock, validation and rollback.
node phone/update.ts "${1:-ytdlp}"
