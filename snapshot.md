# Current working snapshot

Updated: **2026-09-09 10:37 IST**. Read [handoff.md](handoff.md) for project context and recovery details. Every agent must refresh both files after substantive work.

## User’s latest direction

Leave the display band alone. Prepare these handoff documents so work can continue in a new chat. **Do not resume flashing, panel tests, connection experiments or model/soak checks merely because unfinished work is listed here.**

## Checkout and installed state

- Repository: `/Users/hemangdoshi/Developer/project-zero`; branch `build/v0.2`.
- Last implementation commit: `56bf88d` (artwork and initial Spotify bass telemetry). Newer link/layout changes are **uncommitted** and must be preserved. The documentation commit may be newer than this implementation base.
- Source manifest and installed runtime/CLI/app/desk: **0.2.0, build 0.2.0-7**. Wire protocol `0.1`, render schemas `0.1`/`0.2`, migration level `2`. Desk advertises `artwork=rgb565-32`, `audio=levels-v2`.
- Production app: `~/Applications/Zero.app`; data/socket: `~/Library/Application Support/ProjectZero/{zero.db,zero.sock}`. `zero` resolves through `/opt/homebrew/bin/zero` to the bundled CLI.
- Services: `dev.projectzero.zerod` and `dev.projectzero.menu`. Latest read-only check found one runtime and one menu process. No upgrade preflight remained pending; build 7 installed successfully.
- `zero doctor` at handoff: runtime RUNNING, audit chain VALID, desk ONLINE, old simulator OFFLINE. **ONLINE is a point-in-time result, not proof of stable connectivity.**
- Focus session `1788913498387-dfc67f5f489247d2685e37b0`: project `project-zero`, state RUNNING, revision 10. Elapsed was 16,875,899 ms when read; it continues advancing. No session command was issued for this handoff.

## Uncommitted implementation inventory

- `core/api/nodes.go`, new `telemetry.go`/`telemetry_test.go`: 100 ms dispatch cadence, one audio frame in flight until matching receipt, 10-second write deadline, connection failure logging.
- `core/runtime/audio.go`, `audio_test.go`, `display_profile.go`: negotiated `levels-v2` receipt-based telemetry; older audio profile retained as a recognized advertisement but not streamed by the new runtime.
- Manifest/generated Go protocol and Swift/C version metadata, plus `proto/schemas/envelope.json`: build 7 and `display.telemetry.ack` message type. A separate canonical receipt-body schema is not yet present.
- ESP32 `main.c`, `display.c`, `display.h`, sdkconfig/defaults: centered artwork and left text, reference BLACKTAB initialization, separate TX lock, 10-second network timeout, audio receipts, queue/link diagnostics and temporary USB white/gray tests.
- New `tests/test_desk_layout.py`; changed release checklist; new display/link debugging evidence.
- Earlier untracked `docs/evidence/2026-09-08-soak-hour-1.md` is pre-existing evidence; preserve it separately. Run `git status --short` before staging anything; do not sweep all dirty files into a docs commit.

## Latest results and open failures

- Software: full Go race suite, seven native tests (including live UDS), ESP-IDF build/host protocol tests and two actual-renderer pixel tests passed during build 7 work. Logs: `.runtime/flow-go-tests.log`, `flow-swift-tests.log`, `flow-build.log`. These are historical runs, not tests rerun by the handoff task.
- **Connection issue NOT fixed.** Last build-7 physical capture, `.runtime/flow-acceptance.log`, reached 340 audio frames / 313 accepted, then `ZERO COMMAND QUEUE OVERFLOW`; firmware set socket/welcomed false and remained offline for the rest of that capture. Later doctor sees it online again. Do not claim the receipt window established stability.
- **Display band unresolved, user says leave it.** The supplied photo shows a dark horizontal band through the header and into the background. White was clean; stationary gray retained the band with drawing paused. Full reference initialization did not remove it. Panel/cover/controller behavior is implicated; exact physical cause is not established.
- Full desktop Codex outcomes remain blocked by the missing supported attachment contract. Optional model parsing remains disabled because complete tool/context isolation was not proven.
- Keychain access eventually succeeded across upgrades, but prompts recurred. Unattended permission retention across replacements is **not proven**.
- User confirmed BOOT operation earlier, moving waveform on an earlier build, and the manual “Zero setup check” notification. This does not prove latest-build stability or an actual 45-minute reminder firing.

## Processes, evidence and next action

The last bounded serial capture is no longer an active tool session; no new collector was started for this handoff. Do not restart the paused hourly AI automation or obsolete soak collector. Production services were left running and user state unchanged.

If the user asks to resume engineering: first inspect the preserved diff and current health. For connectivity, start with the observed command-queue overflow and how its failure path changes `connected` without closing/resetting the real WebSocket; review ACK traffic, dispatch bursts and flow-control invariants. Reproduce before another patch/flash. Keep the display band parked unless the user reopens it. See the full handoff for all remaining v0.2 gates.
