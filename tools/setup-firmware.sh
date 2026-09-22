#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cmake >/dev/null
command -v ninja >/dev/null
if [ ! -d .runtime/toolchains/esp-idf/.git ]; then
  git clone --depth 1 --branch v5.5.2 --recursive --shallow-submodules \
    https://github.com/espressif/esp-idf.git .runtime/toolchains/esp-idf
fi
cd .runtime/toolchains/esp-idf
./install.sh esp32
