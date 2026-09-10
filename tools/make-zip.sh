#!/usr/bin/env bash
# Упаковать исходники Spotidrome в zip (без node_modules, dist, release и кэшей).
#
#   ./tools/make-zip.sh              → /home/user/spotidrome.zip
#   ./tools/make-zip.sh путь.zip     → свой путь
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$(dirname "$ROOT")/spotidrome.zip}"

cd "$ROOT"
rm -f "$OUT"
zip -qr "$OUT" . \
  -x 'node_modules/*' \
     'dist/*' \
     'release/*' \
     '.cache/*' \
     '.shots/*' \
     '.git/*' \
     'result' \
     '*.zip' \
     '.DS_Store'

echo "$OUT"
unzip -l "$OUT" | tail -1
