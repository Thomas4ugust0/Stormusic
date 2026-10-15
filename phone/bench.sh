#!/data/data/com.termux/files/usr/bin/bash
set -eu
exec python "$(dirname "$0")/bench.py" "$@"
