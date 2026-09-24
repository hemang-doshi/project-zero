# Current working snapshot

Updated: **2026-09-24 10:53 IST**. Read [handoff.md](handoff.md) for architecture and recovery context.

## Current worktree

- Repository: `/Users/hemangdoshi/.codex/worktrees/zero-redesign/project-zero`
- Branch `codex/zero-redesign`, latest code fix `ac89137` (`fix(runtime): skip offline display targets`), followed by a documentation refresh. The source branch is published to `hemang-doshi/project-zero`.
- The original checkout at `/Users/hemangdoshi/Developer/project-zero` remains untouched.
- Three untracked Playwright review images remain under `apps/desktop/output/playwright/`; they are not part of the publication.
- The user confirmed the tracked SwiftUI app should remain. The tree contains one `ZeroMenu` executable using `ZeroCockpit` for cockpit windows and a menu-bar extra, plus Spotify helper executables. There is no separately tracked legacy Swift app, and no Swift source was removed.
- GitHub `main` is now at `ebb4c866444fe61e9b69d1d7c92ada76dae32e40` (tree `c9afdb2a281afe796e0d93c24c7685a84a2160c8`), published by merged PR #11. The protected branch was updated through a passing, linear-history PR; source wins overlapping paths and all 28 main-only files remain. `codex/zero-redesign` remains published with its implementation history. The SwiftUI app and Spotify helpers are present in the main tree.
- Desktop package is 1.0.0, Electron 39.8.10. Core release manifest remains product/build 0.2.0 / 0.2.0-7, wire protocol 0.1, schema versions 0.1/0.2, database version 2. OpenCode 1.18.30 is installed.

## Implemented

- Zero Bot combines consecutive reasoning into compact disclosures, uses a selectable command/output panel, keeps the inspector closed by default, shortens list metadata, groups conversations by project/folder and defers provider session creation until the first accepted send. Verified token usage is shown from provider data; cost is never estimated.
- Desk centers the view on the observed Spotify session and track history; the virtual display card is removed. Playlist creation is visibly disabled until Spotify account authorization is configured.
- Skills Lab has an opt-in, persisted deterministic learning proposal/review/install flow. Verified local brand art is mapped only for exact identities; unknown brands use an explicit neutral mark.
- Runtime has timestamped recent history, five measured chart families including GPU when the host reports it, a machine/daemon status split and a top-process drawer limited to CPU/memory attribution. Session display work is now skipped for nodes past the existing 90-second offline lease.
- Theme switching and managed wallpaper-copy logic are implemented. Network and Flight Recorder behavior were left intact. Flight Recorder remains a bounded recent event/audit view, not durable evidence.

## Verification

- Exact published main tree: Electron **933/933 tests across 76 files**, typecheck, `GOPROXY=off GOSUMDB=off go test ./...`, release/schema generators, Swift build, Electron lint/build, and Go race tests passed. GitHub Actions passed all three required jobs before merge. The Go suite includes main-only runtime tests and the offline display queue regression.
- Playwright exercised the Electron UI for dark/light theme selection, Zero Bot send/Airlock hold, Runtime history and chart panels, OpenCode saved transcript/usage, and Desk. The last preview process has exited; the unpacked bundle remains at `apps/desktop/.runtime/desktop-build/mac-arm64/Zero Desktop.app` and was not installed.
- PR #11's three required GitHub Actions jobs passed before merge: Go/Python, Native macOS and Electron.
- Safe review images: `apps/desktop/output/playwright/zero-bot-draft-dark.png`, `zero-runtime-dark.png`, and `zero-desk-dark.png`.

## Environment limits and next step

- No isolated Zero socket/daemon is running. Registered Projects, live Spotify state and hardware-backed Desk data remain unavailable.
- OpenCode saved history is readable, but no live ACP model/session was advertised for a send test. Do not claim live OpenCode dispatch.
- Spotify playback and playlist writes were not authorized or available: there is no registered client/account flow. A client registration and explicit account connection are required to enable the playlist action.
- The ESP32 was not connected or physically tested. The virtual/physical display path is not accepted by a software preview.
- Learning stayed disabled in the isolated preview. No proposal was approved/installed or existing learning data changed. The interactive synthetic-proposal demo remains unverified.
- Wallpaper import is covered by tests; native picker, source deletion and restart were not exercised in the UI. No live provider send was performed in this worktree after the verification walkthrough.
- Context7 lookup failed with an invalid/expired OAuth token. Retry after `npx ctx7@latest login` or configuring `CONTEXT7_API_KEY` before making library-specific claims. SwiftPM tests remain blocked by the previously documented local Command Line Tools manifest-linker error; the GitHub native build job is part of PR checks.
- No signed install, production profile change, production daemon, Spotify OAuth or playlist mutation was performed.

## September 22 follow-up fixes

Three focused fix commits followed the redesign preview: `df01a38` (Skills Lab compact layout/glyphs; Network scale, click-to-focus and absent-device cables; OpenCode read-only transcript export; virtual display preview; Codex executable preflight), `f919c13` (monitor-neck geometry), and `97a96e2` (compact skill-selection reveal). The isolated worktree's preview bundle at `apps/desktop/.runtime/desktop-build/mac-arm64/Zero Desktop.app` was rebuilt and launched after the last fix; the app path formerly pinned to the Dock is unchanged. The original dirty checkout was untouched. Current source manifest remains product 0.2.0/build 0.2.0-7, wire 0.1, migration 2. No production app or database was replaced.

Verification: full desktop suite **868/868** across 71 files, typecheck and final `build:unpack` passed. In the running Electron preview, the virtual display rendered without an ESP32; monitor and ESP32 models focused on click with UNREGISTERED details; selecting a compact Skills Lab row scrolled its details into view. No physical desk test or live provider turn ran. This Mac has no Zero daemon/socket or registered production projects, so runtime projects and Spotify projection remain unavailable. `/usr/local/bin/codex --version` fails because the platform binary is absent, while `/opt/homebrew/bin/codex` links to a missing private toolchain; neither provides a live app-server. OpenCode CLI is installed and advertises `export --sanitize`; saved-session export was tested with fixtures, not a user's transcript. Cross-device Spotify requires a user-authorized OAuth/PKCE integration, developer client ID and `user-read-playback-state`; it is not implemented. The bundle is an ad-hoc-signed preview because the configured identity is untrusted. Do not claim complete provider compatibility, real hardware delivery or phone playback.

## Historical redesign checkpoint (superseded by the canonical app reconciliation above)

The user stopped repetitive audits and requested immediate code execution across the four redesign aspects. Work is in isolated `/Users/hemangdoshi/.codex/worktrees/zero-redesign/project-zero`, branch `codex/zero-redesign`, starting from `76905a0`; current source tip `c53bb7e` follows checkpoints `26a5899` and `215c8b7`. Source work is committed; check `git status` before staging. Original checkout dirty Go/Swift/firmware work remains untouched. The September 9 sections below are historical installation/incident context, not current measured state. This host has no production Zero app/CLI/database at the documented installed paths and no production daemon; the user-requested Electron preview below is running. Installed production versions and physical acceptance are unavailable. Source manifest is 0.2.0/build 0.2.0-7, wire 0.1, migration 2.

- Network scene now has a non-shrinking 420–680px container, responsive camera fit, and a larger initial window. A real Chromium static preview exposed a previously crashing R3F `data-count` prop on instanced meshes; those props were removed, and mesh-count tests now inspect constructor args. The desk rendered in Chromium at 1024×768 with monitor, ESP32, laptop, keyboard, mouse pad and gated phone visible. Unregistered monitor/ESP32 models are explicitly labelled as such rather than claiming daemon enrollment. This is a static renderer check, not physical desk acceptance.
- Zero Bot has read-only `projects.list`, project-first versus OpenCode sidebar modes, explicit `Unprojected`, larger initial workspace window, and one inline composer with model select, voice icon and send icon. An open Codex thread can now submit via `prompt.submit` only when the bridge is live; the renderer shows a sensitive-data hold with Cancel/Send once and clears text only after accepted dispatch. OpenCode send and voice remain disabled. The inspector exposes actual item/tool counts and registered project name, while usage/cost remain unavailable.
- Airlock has bounded local scanning and a main-only one-shot hold gateway wired to strict typed IPC and a Codex `thread/read` → registered-project/cwd verification → `turn/start` adapter. Exact thread/text/model/provider binding and replay/expiry checks are tested with fake bridges; no real provider turn was started. `codex.send` and `ocp.send` still throw. OpenCode prompt IPC is rejected until an active ACP session is proven. The Airlock page distinguishes composer holds from runtime approvals. Raw bridge params are excluded from the bounded disk mirror, and provider stderr is withheld from diagnostics.
- Skills Lab uses a virtualized searchable local line wall, preserving existing skill files and discovery roots. Read-only skills.sh search is wired through exact `skills@1.7.0` CLI dependency with bounded output/timeout. A new `inspectStagedSkill` validator rejects links/hardlinks/invalid metadata/oversize and hashes a completed private stage, but CLI staging, reviewed install and rollback remain unavailable. No skill was installed.

Verification: desktop **858/858 tests** across 69 files, typecheck, lint with **0 errors**, and production build passed after the staging-validator addition. Static Chromium preview passed visual checks for Network, Zero Bot and Skills Lab; no live provider, production daemon, hardware, speech helper or skill installation was exercised. The earlier preview browser/server were stopped and its generated screenshots removed; only the user-requested Electron preview described below now runs. Next: finish safe catalog CLI staging/install, ACP session binding, local speech and bounded inspector usage evidence. Do not claim full redesign or hardware acceptance.

On 2026-09-22 the user explicitly requested the latest Electron app bundle opened and pinned. `npm run build:unpack` packaged source tip `c53bb7e` into `apps/desktop/.runtime/desktop-build/mac-arm64/Zero Desktop.app` in the isolated worktree. Electron-builder skipped trusted signing because the configured `Project Zero Local Release` identity is present but not trusted (`CSSMERR_TP_NOT_TRUSTED`); the bundle is an ad-hoc-signed preview, not a release install. The older September 12 Electron process was quit; the worktree bundle is running (verified process path and renderer file URL), with the redesigned Zero Bot Projects/OpenCode switch and inline composer visible. The macOS Dock persistent-app entry points to this exact worktree bundle and was verified after Dock restart. No production `Zero.app` or data was replaced. This Mac still has no `zero.sock`, so registered projects/thread interaction and live provider dispatch were not accepted in the running preview. The generated bundle is ignored build output, not committed source; the Dock pin depends on that worktree path remaining present.

## User’s latest direction

The native macOS application is the primary Project Zero cockpit. The current menu-bar window must not carry the main project-selection, intent-entry or coding workflow; keep the menu surface compact for status, permissions/approvals and genuinely useful quick controls. The native app must render accumulated focus time with hours rather than hundreds of minutes. A menu pause/resume taking roughly 20 seconds to appear on the desk display is unacceptable and must be treated as a transport/recovery failure, not normal latency.

For the future conversational layer, use the existing Codex ChatGPT login through the supported Codex app-server when practical. Route general typed input and transcribed voice plus model-assisted intent understanding to GPT-5.6 Luna at medium reasoning; route actual repository coding work to GPT-5.6 Sol at medium reasoning. There is no advertised GPT-6 Luna model. Preserve deterministic handling for known commands. These are product/architecture directions, not authorization in this documentation-only turn to build, deploy, flash or start autonomous model calls. Leave the display band alone.

## Checkout and installed state

- Repository: `/Users/hemangdoshi/Developer/project-zero`; branch `build/v0.2`.
- Last implementation commit: `56bf88d` (artwork and initial Spotify bass telemetry). Newer link/layout changes are **uncommitted** and must be preserved. The documentation commit may be newer than this implementation base.
- Source manifest and installed runtime/CLI/app/desk: **0.2.0, build 0.2.0-7**. Wire protocol `0.1`, render schemas `0.1`/`0.2`, migration level `2`. Desk advertises `artwork=rgb565-32`, `audio=levels-v2`.
- Production app: `~/Applications/Zero.app`; data/socket: `~/Library/Application Support/ProjectZero/{zero.db,zero.sock}`. `zero` resolves through `/opt/homebrew/bin/zero` to the bundled CLI.
- Services: `dev.projectzero.zerod` and `dev.projectzero.menu`. Latest read-only check found one runtime and one menu process. No upgrade preflight remained pending; build 7 installed successfully.
- `zero doctor` at 12:33 IST: runtime RUNNING, audit chain VALID, desk OFFLINE with last seen `2026-09-09T06:29:42.141Z`, old simulator OFFLINE. This is a point-in-time result; the desk has moved between online and offline during the unresolved incident.
- Focus session `1788913498387-dfc67f5f489247d2685e37b0`: project `project-zero`, state RUNNING, revision 13. Elapsed was 23,710,248 ms when read; it continues advancing. No session command was issued in this review.
- Codex CLI remains `0.153.4` and reports `Logged in using ChatGPT`. Its supported `app-server --stdio` initialized successfully and a live `model/list` returned GPT-6 Astra, GPT-5.6 Sol, Terra and Luna, and GPT-5.5 with their supported reasoning efforts. The bounded probe exited; no Codex coding turn or model response was started.

## Uncommitted implementation inventory

- `core/api/nodes.go`, new `telemetry.go`/`telemetry_test.go`: 100 ms dispatch cadence, one audio frame in flight until matching receipt, 10-second write deadline, connection failure logging.
- `core/runtime/audio.go`, `audio_test.go`, `display_profile.go`: negotiated `levels-v2` receipt-based telemetry; older audio profile retained as a recognized advertisement but not streamed by the new runtime.
- Manifest/generated Go protocol and Swift/C version metadata, plus `proto/schemas/envelope.json`: build 7 and `display.telemetry.ack` message type. A separate canonical receipt-body schema is not yet present.
- ESP32 `main.c`, `display.c`, `display.h`, sdkconfig/defaults: centered artwork and left text, reference BLACKTAB initialization, separate TX lock, 10-second network timeout, audio receipts, queue/link diagnostics and temporary USB white/gray tests.
- New `tests/test_desk_layout.py`; changed release checklist; new display/link debugging evidence.
- Earlier untracked `docs/evidence/2026-09-08-soak-hour-1.md` is pre-existing evidence; preserve it separately. Run `git status --short` before staging anything; do not sweep all dirty files into a docs commit.

## Latest results and open failures

- Software: full Go race suite, seven native tests (including live UDS), ESP-IDF build/host protocol tests and two actual-renderer pixel tests passed during build 7 work. Logs: `.runtime/flow-go-tests.log`, `flow-swift-tests.log`, `flow-build.log`. These are historical runs, not tests rerun by the handoff task.
- **Connection issue NOT fixed.** Last build-7 physical capture, `.runtime/flow-acceptance.log`, reached 340 audio frames / 313 accepted, then `ZERO COMMAND QUEUE OVERFLOW`; firmware set socket/welcomed false and remained offline for the rest of that capture. At 12:33 IST, `zero doctor` reported the desk OFFLINE with last seen `2026-09-09T06:29:42.141Z`; the daemon log contains repeated `capability.invoke` write timeouts and closed-connection failures. The command commits locally and the connected-node loop polls pending display work every 100 ms, so the user-observed roughly 20-second pause/resume delay is evidence of broken link/retry/reconnect behavior, not the intended dispatch cadence. Do not claim the receipt window established stability.
- **Display band unresolved, user says leave it.** The supplied photo shows a dark horizontal band through the header and into the background. White was clean; stationary gray retained the band with drawing paused. Full reference initialization did not remove it. Panel/cover/controller behavior is implicated; exact physical cause is not established.
- The earlier desktop-attachment blocker has materially changed: this installed Codex now exposes a supported app-server transport that can reuse the existing ChatGPT login and list/start model-backed work for a custom frontend. End-to-end Project Zero thread handling, approvals, cancellation, tool isolation and voice transcription are not implemented or proven. Optional model parsing remains disabled in the current runtime.
- Keychain access eventually succeeded across upgrades, but prompts recurred. Unattended permission retention across replacements is **not proven**.
- User confirmed BOOT operation earlier, moving waveform on an earlier build, and the manual “Zero setup check” notification. This does not prove latest-build stability or an actual 45-minute reminder firing.

## Processes, evidence and next action

The last bounded serial capture is no longer an active tool session; no new collector was started for this handoff. The read-only Codex app-server/model-list probe exited normally. Production services were left running and user state unchanged. `git diff --check -- snapshot.md handoff.md` passed after documenting this review. Do not restart the paused hourly AI automation or obsolete soak collector.

If the user asks to resume engineering: first inspect the preserved diff and current health. Separate the work into (1) restoring and instrumenting reliable sub-second focus-state delivery, (2) specifying and building the native cockpit plus compact menu companion, and (3) a bounded Codex app-server adapter with the agreed model routes. For connectivity, start with the observed command-queue overflow and how its failure path changes `connected` without closing/resetting the real WebSocket; review ACK traffic, dispatch bursts and flow-control invariants. Reproduce before another patch/flash. Keep the display band parked unless the user reopens it. See the full handoff for all remaining v0.2 gates.
