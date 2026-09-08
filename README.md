# Project Zero

A personal, local-first environment runtime. This repository implements the
v0.1 foundation and dedicated ESP32 desk-node path from PROJECT_ZERO_SPEC.md.
The authoritative state is in zerod, not the CLI or display.

## Build and test

Requires macOS, Go 1.25, Xcode command-line tools (for the Keychain bridge).

```sh
go mod download
make build
make test
```

`make test` disables module-network access and runs Go tests with the race
detector. A fresh machine must download dependencies first. The cgo bridge
uses Security.framework; there is no plaintext fallback for runtime keys.

## Run

```sh
bin/zerod --data .runtime/live
bin/zero --socket .runtime/live/zero.sock status
bin/zero --socket .runtime/live/zero.sock session start 'Project Zero'
bin/zero --socket .runtime/live/zero.sock session pause
bin/zero --socket .runtime/live/zero.sock session show
```

Node networking defaults to loopback. Use `--listen :7443` for an explicitly
enabled LAN listener. TLS always requires enrolled client certificates.
`--local-only` runs the Unix API without network identity. Default data location
when `--data` is omitted is `~/Library/Application Support/ProjectZero`.

## Pair the simulator

```sh
bin/zero-simulator --init
# Compare the displayed fingerprint, then substitute it below.
bin/zero --socket .runtime/live/zero.sock nodes pair desk-simulator \
  .runtime/simulator/node.csr VERIFIED_FINGERPRINT > .runtime/simulator/enrollment.json
bin/zero-simulator --enrollment .runtime/simulator/enrollment.json
bin/zero --socket .runtime/live/zero.sock grants set \
  '{"principal":"owner","capability":"display.render","target":"desk-simulator","state":"ALWAYS_ALLOWED"}'
bin/zero --socket .runtime/live/zero.sock grants set \
  '{"principal":"node:desk-simulator","capability":"session.toggle","target":"runtime","state":"ALWAYS_ALLOWED"}'
bin/zero-simulator
```

Press Enter in the connected simulator to send a button event. Offline input is
discarded. Starting/pausing/resuming the session queues a display update.
The simulator stores its private test identity under its ignored owner-only directory.

## Approvals and explanations

```sh
bin/zero --socket .runtime/live/zero.sock capabilities invoke desk-simulator display.render '{"project":"Hello"}'
bin/zero --socket .runtime/live/zero.sock approvals list
bin/zero --socket .runtime/live/zero.sock approvals approve INVOCATION_ID
bin/zero --socket .runtime/live/zero.sock privacy audit
bin/zero --socket .runtime/live/zero.sock events query
```

Inspect exact target/input/hash before approving. DENIED wins over a prior
approval; SESSION_ALLOWED needs an RFC3339 `expires` value. A request ID is an
idempotency key: reuse with changed input is rejected. All ordinary mutating
commands accept `--dry-run`; pairing has its own explicit verification flow.

`events replay` rebuilds the session projection without performing effects.
The audit hash chain provides local tamper evidence, not protection against
an attacker controlling the owner account.

## Development LaunchAgent

`python3 tools/launch-agent.py` generates a plist without loading it.
Use `--install` to opt in. Unload with
`launchctl bootout gui/$(id -u)/dev.projectzero.zerod`.
Keep the binary path stable while it is loaded.

## Physical firmware

Pinned ESP-IDF 5.5.2, esp_websocket_client 1.6.1, mDNS 1.9.1.
Read `docs/runbooks/hardware-recovery.md` before any flash.

```sh
source .runtime/toolchains/esp-idf/export.sh
idf.py -C nodes/esp32-desk build
idf.py -C nodes/esp32-desk -p "$ZERO_PORT" -b 115200 flash
```

The firmware initially displays its key fingerprint and accepts `CSR` over
115200-baud serial. The private key never leaves the device. Provisioning
supplies a signed enrollment certificate, CA, runtime endpoint, timestamp, and
Wi-Fi credentials over the owner-controlled USB connection.

Real hardware acceptance, interruption tests, and the 24-hour soak are tracked
separately from software tests. See the implementation plan and evidence files;
building firmware alone does not establish a completed physical milestone.

## Current acceptance status

The physical manual session loop is working and user-confirmed. The 24-hour
hardware soak is in progress; this is not yet an accepted v0.1 release.
See [acceptance evidence](docs/evidence/2026-09-08-acceptance.md) for verified
results and remaining work.
