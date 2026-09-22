# Firmware Development

The desk node uses ESP-IDF 5.5.2 with `esp_websocket_client` 1.6.1 and mDNS 1.9.1 as pinned in `nodes/esp32-desk/dependencies.lock`.

On a development machine with Git, CMake and Ninja:

```sh
bash tools/setup-firmware.sh
source .runtime/toolchains/esp-idf/export.sh
idf.py -C nodes/esp32-desk build
```

The setup script installs ESP-IDF under the ignored `.runtime/` directory. Component dependencies are resolved from the manifest and lock file. Generated `build/`, `sdkconfig`, provisioning files, enrollment certificates and device backups are local-only and must not be committed.

Host protocol fixtures can be built with:

```sh
bash tools/test-firmware.sh
```

That command does not flash a board. Provisioning and flashing can erase or interrupt hardware state; they require a deliberate owner-run procedure, verified backups, the correct target and board-specific instructions. Follow Espressif documentation for the exact board; this repository does not provide a turnkey production flashing workflow. CI never provisions, flashes, erases or connects to hardware. A successful build is not physical acceptance.
