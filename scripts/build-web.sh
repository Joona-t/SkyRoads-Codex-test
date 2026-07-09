#!/usr/bin/env bash
# NEONDRIFT × SkyRoads — build the web game's level data, then serve it.
# Extracts levels/palettes from the original SkyRoads data files in this repo (which YOU own)
# into web/assets/ (git-ignored), then starts a local static server for the ES-module game.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-web/assets}"
PORT="${2:-8080}"

# The server below serves web/ — an OUT outside web/ would export where the game never looks.
case "$OUT" in
  web/*) ;;
  *) echo "error: OUT must live under web/ (got '$OUT') — the server serves web/" >&2; exit 2 ;;
esac

echo "▸ exporting SkyRoads levels + palettes -> $OUT"
cargo run -q -p skyroads-cli --release -- export-json . "$OUT"

echo "▸ serving web/ at http://127.0.0.1:$PORT  (Ctrl-C to stop)"
echo "  (ES modules require http:// — file:// will not load the game)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 -d web
