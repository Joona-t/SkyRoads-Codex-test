#!/usr/bin/env bash
# NEONDRIFT × SkyRoads — build the web game's level data, then serve it.
# Extracts levels/palettes from the original SkyRoads data files in this repo (which YOU own)
# into web/assets/ (git-ignored), then starts a local static server for the ES-module game.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="byo"
if [ "${1:-}" = "--tracked-only" ]; then
  MODE="tracked-only"
  OUT="web/assets"
  PORT="${2:-8091}"
else
  OUT="${1:-web/assets}"
  PORT="${2:-8091}"
fi

# The runtime loads ./assets/... from web/. Keep the command's export target canonical so
# a stale or misplaced ignored export cannot make startup look healthier than it is.
case "$OUT" in
  web/assets|web/assets/) OUT="web/assets" ;;
  *) echo "error: OUT must be web/assets (got '$OUT')" >&2; exit 2 ;;
esac
case "$PORT" in
  ''|*[!0-9]*) echo "error: PORT must be numeric (got '$PORT')" >&2; exit 2 ;;
esac
if [ -L "$OUT" ]; then
  echo "error: OUT must not be a symlink (got '$OUT')" >&2
  exit 2
fi

if [ -e "$OUT" ]; then
  echo "▸ clearing stale generated assets -> $OUT"
  rm -rf "$OUT"
fi
if [ "$MODE" = "tracked-only" ]; then
  echo "▸ tracked-only NEONDRIFT serve; source assets are not exported"
else
  : "${CARGO_TARGET_DIR:=/tmp/skyroads-alpha-target}"
  export CARGO_TARGET_DIR
  echo "▸ exporting SkyRoads levels + palettes -> $OUT"
  cargo run -q -p skyroads-cli --release -- export-json . "$OUT"
fi

echo "▸ serving web/ at http://127.0.0.1:$PORT  (Ctrl-C to stop)"
echo "  (ES modules require http:// — file:// will not load the game)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 -d web
