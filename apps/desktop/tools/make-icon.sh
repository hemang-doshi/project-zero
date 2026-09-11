#!/bin/sh
# Renders the packaging icon assets for Zero Desktop:
#   - resources/ProjectZero.icns from the supplied Stitch app icon, through
#     sips + iconutil (same flow as tools/build-macos.py)
#   - src/main/assets/tray/*.png real retina tray assets, with the fallback
#     color tied to ZERO_TOKENS.brandOrange at build time
# Usage: make-icon.sh [--out DIR]   (default out dir: resources)
set -eu
cd "$(dirname "$0")/.."

OUT="resources"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out)
      OUT="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

SRC="../../assets/stitch/project-zero-cockpit-interface/app-icon/project-zero-app-icon.png"
ICONSET="$(mktemp -d)/ProjectZero.iconset"
mkdir -p "$ICONSET" "$OUT"

for points in 16 32 128 256 512; do
  for scale in 1 2; do
    size=$((points * scale))
    suffix=''
    [ "$scale" -eq 2 ] && suffix='@2x'
    sips -z "$size" "$size" "$SRC" --out "$ICONSET/icon_${points}x${points}${suffix}.png" >/dev/null
  done
done
iconutil -c icns "$ICONSET" -o "$OUT/ProjectZero.icns"

node tools/make-tray-icons.mts
