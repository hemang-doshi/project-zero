#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime
cc -std=c11 -Wall -Wextra \
  -I nodes/esp32-desk/main -I .runtime/toolchains/esp-idf/components/json/cJSON \
  tests/protocol/desk_test.c nodes/esp32-desk/main/desk_protocol.c \
  .runtime/toolchains/esp-idf/components/json/cJSON/cJSON.c -o .runtime/desk-test
.runtime/desk-test
source .runtime/toolchains/esp-idf/export.sh
idf.py -C nodes/esp32-desk build
