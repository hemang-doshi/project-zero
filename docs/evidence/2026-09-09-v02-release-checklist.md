# v0.2 release evidence — 2026-09-09

Product release: 0.2.0. Desk firmware build 0.2.0-4; Mac currently 0.2.0-3 with build 4 upgrade waiting for Keychain preflight. Implementation and installation are distinct from full acceptance. No scheduled AI checks were added.

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Shared release, production paths, daemon instance lock | Passed | Manifest-generated metadata; installed CLI and doctor; one production daemon; paired device advertises build 0.2.0-4. Temporary compatible build skew is explicit pending Mac upgrade. |
| Repeat signed upgrade and preserved database/identity | Passed | Repeat upgrades health checked; audit chain VALID; existing device reconnects without pairing. Backups in production recovery directory. |
| Keychain approval | Passed | User allowed signed runtime; subsequent upgrade completed, but build 4 again waits at Keychain preflight. Stable permission retention is therefore not yet established across every replacement. |
| Spotify artwork and text | Passed | Real local Spotify metadata and validated 32×32 artwork observed; user reviewed physical screen. Artwork is a user-approved scope amendment. |
| Native setup notification | Passed | User explicitly confirmed “Zero setup check” notification. This is a manual setup test, not evidence of a 45-minute firing. |
| New artist spacing and bass trace | Passed physical review | User reported flat trace in build 3. Native levels independently verified varying (56 samples, amplitude and bass both span 0–255). Firmware queue contention found and isolated into a coalescing audio queue; device accepted 335/335 audio frames at 23 ms age, heap 41,740 bytes (minimum 37,208), playback playing. User explicitly confirmed the trace now moves. Mac build 4 upgrade awaiting Keychain preflight. |
| Go race, native transport, firmware | Passed | go test -race ./...; seven Swift tests including live production UDS; host protocol fixtures and ESP-IDF build; go vet ./... . |
| Installer rollback failure handling | Passed automated / pending physical | Three Python tests include consistent WAL backup and failed-health restoration. A full installed rollback has not been exercised. |
| Protocol additions | Passed tested subset | Duplicate keys/depth validation, strict owner bodies, shared Go/C display fixtures, bounded audio parser. This does not establish exhaustive conformance for every CLI/API body. |
| Desktop Codex outcomes | Blocked | See 2026-09-09-v02-codex-boundary.md; supported attachment to desktop task-owning service unavailable. No weaker completion inference substituted. |
| Optional model parsing | Blocked, disabled | Complete no-tools/no-context restriction unproven with pinned interface. No model requests made. |
| BOOT pause/resume | Passed earlier physical check | User confirmed build 2; build 4 preserves button path. Latest build physical recheck pending. |
| Restart recovery and performance | Passed measured subset | v02-installed-runtime-measurements.json: status p95 0.177 ms, RSS 28.625 MiB, daemon SIGKILL recovery 0.212 s. Measurements precede audio addition. Dispatch and exact physical restore timing remain unverified. |
| Sleep/wake, Wi-Fi and power interruption matrix | Pending | Do not equate firmware flash reconnect with complete interruption acceptance. |
| 24-hour soak and 14-day evaluation | Intentionally waived | User removed gates. Incomplete soak evidence retained; collector stopped. |
| Bounded diagnostic log rotation, exhaustive doctor repair output | Pending | Current diagnostics expose paths, versions, node health and audit integrity; full requested operational coverage is not yet verified. |

## Bass trace amendment

User requested reuse of Times Gate's compact waveform. The native helper uses a Spotify-only Core Audio process tap (macOS 14.2+). PCM remains in process memory; it emits only amplitude and measured low-frequency energy. No microphone, recording, or raw audio transmission. A 40–200 Hz filter adds real bass response; the original Times Gate meter measured broadband amplitude only.

The runtime retains transient levels in RAM, verifies enabled Spotify and display permission, and sends them only to nodes advertising `audio: levels-v1`. Frames carry a session identity, increasing sequence and 500 ms TTL. Firmware rejects stale/session-mismatched/reordered input. A 28×9 pixel region beside the artist uses the Times Gate spring damping; paused/disconnected/stale input settles flat. Short titles place artist immediately below; longer titles use two title lines. New audio capture requires macOS permission. Missing permission does not affect focus, text or artwork.

Firmware audio debugging: shared single-slot receive queue could overflow when a display invocation and audio update arrived together. Audio now has a separate 1024-byte overwrite queue; command queue has two bounded 8193-byte slots. Serial health verifies active processing after the correction. USB diagnostic access resets the board; this is not a passive serial observation claim.
