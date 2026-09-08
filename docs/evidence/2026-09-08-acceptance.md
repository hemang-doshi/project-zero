# Acceptance evidence — 2026-09-08

Status: physical manual loop operational; v0.1 release acceptance incomplete.

## Verified

- Go race suite and Python provisioning test pass with module networking disabled
  (`make test`). `go vet ./...` and `git diff --check` pass. macOS race linking
  emits LC_DYSYMTAB warnings; tests complete successfully.
- Host C protocol/debounce checks and pinned ESP-IDF firmware build pass
  (`make firmware-test`). Binary 984,240 bytes; application partition 36% free.
- Owner Unix API, mTLS simulator path, transactional session deduplication,
  denial/approval handling, restart/rebuild, failed transaction rollback and
  latest-display coalescing have automated coverage. This is not exhaustive
  coverage of every crash point in the release matrix.
- Live daemon doctor reports RUNNING and VALID audit chain. Measured 200 local
  status calls: p95 0.143 ms, daemon RSS 22.89 MiB. Forced process termination
  recovered through the development LaunchAgent in 0.216 seconds with session
  revision preserved. See runtime-measurements.json for raw measurements.
- Actual ESP32-D0WD-V3, 4 MB flash, flashed and paired as desk-display-01.
  On-device identity retained across repeated resets/flashes. Signed display
  results reach SUCCEEDED and reconnect restores desired session state.
- User confirmed Project Zero, RUNNING, elapsed timer and CONNECTED on the real
  screen, and BOOT pause behavior. Authenticated physical button events also
  appear in runtime audit with durable session revisions.
- Latest firmware reports 54,036 bytes free heap after TLS connection, after
  reducing fixed parsing/queue/UART allocations. This is a spot reading, not
  proof of long-term memory stability.
- Complete original 4 MB firmware backup retained privately with SHA256
  1efae493a24f6d5b9ab3f8819574ab180ee4137f88b538b016e42866722b33cd.

## Soak in progress

Started 2026-09-08 15:26:48 UTC, required duration 24 hours.
The first shell-launched attempt ended early and is excluded. The current
collector runs as one-shot LaunchAgent dev.projectzero.soak.
Collector: tools/soak-device.py, private output .runtime/soak/.
Opening serial caused one initial board reset; count that as setup, not a
spontaneous soak reset. Subsequent resets must be investigated. An hourly task
follow-up reviews health and will report failure or completion. Keep this Mac
awake and the display powered/connected. Collector completion only requests
review; it does not automatically certify the release.

## Outstanding acceptance and implementation gaps

- Full 24-hour memory/connection evidence, actual power interruption and Wi-Fi
  loss matrix, and measured reconnect-to-restoration latency below 10 seconds.
  Serial resets are not evidence of power-loss behavior.
- Dispatch p95 below 250 ms has not yet been measured.
- Exhaustive malformed/fragmented/slow-consumer network cases and termination
  at every commit/dispatch/effect/result boundary remain unverified.
- Registration/capability negotiation uses the narrow enrolled desk profile;
  full advertisement reconciliation remains incomplete.
- CLI streaming tail/watch and some per-node inspection commands are not yet
  implemented; envelope trace propagation needs completion.
- Device NVS keys persist but physical extraction protection is not enabled;
  no irreversible security eFuses were changed.

These gaps keep gates 2–6 open even though the first physical loop works.
