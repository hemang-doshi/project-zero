# Project Zero — full project handoff

Updated: **2026-09-23 18:13 IST**. Start with [AGENTS.md](AGENTS.md) and [snapshot.md](snapshot.md). Both app branches now share one source version; this handoff records the integration and how to run it without touching the production profile.

## Current app reconciliation and recovery

Both `build/v0.2` and `codex/zero-redesign` share the same current tip, which includes this reconciliation record. The unified history includes the Electron app improvements plus the native macOS UI changes previously dirty in the original checkout. Source/UI integration `524cacb` includes the floating/centered Zero Bot workspace, persisted light/dark theme, animated reduced-motion-aware Inspector, isolated HMR profile, Airlock provider dispatch and scanning, bounded Codex/OpenCode transcript reads, Skills Lab discovery/staging, Desk/Network layout updates, and native macOS window, typography, and route refinements. App-facing core support in `75b9de1` supplies the cached artwork endpoint and audio snapshot fields. Separate stale-node queue and SQLite/WAL maintenance changes, plus other docs, asset and editor work, remain preserved but uncommitted in the original checkout.

**Verification:** Electron desktop tests passed **896/896 across 72 files**; typecheck, changed-file ESLint and `git diff --check` passed. `build:unpack` also passed in the same source worktree. Go app-facing support tests passed: `go test ./core/api ./core/runtime`. The native SwiftPM test command failed before project compilation: `/Library/Developer/CommandLineTools` has Swift 6.3.3, but its PackageDescription manifest linker reports an undefined `PackageDescription.Package.__allocating_init` symbol. Native source and the changed layout test passed `swiftc -frontend -parse`; do not report the native suite as passing. No provider prompt was sent. No daemon or signed install was started; the machine has no valid signing identity and no `zero.sock`.

**Current preview:** `npm run dev:watch` is running from `/Users/hemangdoshi/.codex/worktrees/zero-redesign/project-zero` (watcher PID 24157, Electron PID 24163). Electron uses `/Users/hemangdoshi/Library/Application Support/ProjectZero/dev-electron` for dev user data, session data and the Zero socket. This isolates HMR from the packaged app profile and production daemon. To stop the watcher, send Ctrl-C to the existing dev session; to run it again, use `npm run dev:watch` from `apps/desktop` in either now-aligned checkout.

**Incident and user data:** An earlier attempt from the original checkout used `--outDir .runtime/dev-watch-out`; Electron then loaded stale `apps/desktop/out/main` while Vite served the current renderer, causing `Unknown op` IPC failures and the broken Desk view. That process has been stopped. Because it did not yet use the dev profile, it rewrote `/Users/hemangdoshi/Library/Application Support/ProjectZero/desktop-electron/prefs.json` at 17:22 IST; the file stores window/icon/wallpaper preferences. The current saved layout metadata was readable, and no provider history, grants or database writes were observed. There was no pre-run backup, so byte-for-byte restoration cannot be claimed. The corrected scripts use Electron Vite's default output and select the isolated profile before readiness.

The screenshot's runtime message that registered projects are unavailable remains accurate: there is no installed Zero runtime/socket on this Mac. Provider cwd grouping and saved Codex/OpenCode history remain browseable independently. Follow `docs/runbooks/v02-installation.md` before any deployment; never bypass signing or substitute a dev profile for production.

## Historical: September 22 follow-up repair handoff

Read the newest snapshot first. Three focused follow-up commits were transferred mechanically from `/private/tmp/project-zero-fixes-2` into the isolated `codex/zero-redesign` worktree. The final Electron preview was rebuilt/launched and visually verified; source/test/build status is in the snapshot. OpenCode's official sanitized export reads saved messages and tool parts in memory only; it is not ACP session ownership or provider sending, and does not guarantee hidden provider data. Codex history still requires a working CLI app-server—the two current system shims are broken. `zero.sock` does not exist here, so runtime projects, Spotify projection and display leases cannot appear; do not mask that by inventing state. Self-learnt skill roots are absent. Phone-wide Spotify playback requires OAuth/PKCE and the owner's developer client ID/consent; no account tokens were extracted. Keep software preview, daemon installation/registration, OAuth and physical ESP32 acceptance distinct.

## Historical: September 22 redesign implementation handoff

The user explicitly stopped repetitive audit/re-review and directed immediate execution of the four targeted redesign aspects. All current implementation is in the isolated `codex/zero-redesign` worktree at `/Users/hemangdoshi/.codex/worktrees/zero-redesign/project-zero`, starting from commit `76905a0`; source tip `c53bb7e` follows checkpoints `26a5899` and `215c8b7`. Check `git log -1` and `git status` for later state. Original checkout work is untouched. Read the updated snapshot for exact code scope and verification. The three approved implementation plans remain under `docs/superpowers/plans/2026-09-22-zero-{desk-bot-shell,airlock-inspector-voice,skills-lab}.md`. Do not resume the audit plan as a new loop.

The largest visual defect was not only container height: real Chromium showed the R3F scene crashed on test-only `data-count` props attached to instanced meshes. Removing them restored a visible desk; a wider default Network window, camera fit and honest unregistered physical monitor/ESP32 placeholders made the full layout visible. Static preview is not a live Electron/daemon/hardware acceptance test.

Airlock scanning and one-shot hold semantics are now wired through `prompt.submit`/`prompt.decide` to a main-only Codex adapter. The adapter reads the existing thread, verifies its explicit project ID and real cwd against the registered daemon project, then sends one `turn/start` with the pinned 0.153.4 schema. The exact schema was recovered from an isolated temporary copy of the pinned binary and corroborated with official docs; the temp copy was removed. Tests use fake bridges and no live prompt was sent. The direct `codex.send`/`ocp.send` paths remain blocked. OpenCode prompt IPC is blocked: local session discovery is not proof of an active ACP session. The Codex composer hold is ephemeral and bound to exact text/model/provider/thread; errors and provider stderr must not echo prompt content. The disk mirror is bounded metadata-only; preserve historical files, which may still contain raw content. Skills Lab search uses pinned `skills@1.7.0`; a pure stage validator now checks files and hashes, but no CLI stage/install/remove workflow or provider reference transaction exists. Never present catalog hits as installed or mutate user-managed paths. Inspector item counts and registered project are visible; usage/cost remain unavailable without verified evidence.

Desktop tests (858 across 69 files), typecheck, zero-error lint and production build passed after the stage-validator addition. The isolated static browser/server were stopped; the user-requested Electron preview now runs as described below, with no Codex/OpenCode provider turn started. Next implementation sequence: finish Skills Lab CLI stage/review and transactional install in isolated test directories; prove ACP active-session binding before enabling OpenCode; add local speech only after packaging/offline proof; normalize honest usage evidence; then visual/physical acceptance. Do not start live provider turns, install skills, or deploy as a side effect of tests.

The user subsequently requested an actual preview of the latest Electron changes, not the stale September 12 bundle. The isolated worktree's `build:unpack` produced and launched `apps/desktop/.runtime/desktop-build/mac-arm64/Zero Desktop.app`; the renderer file URL and visible redesigned Zero Bot confirm the selected bundle. The old process was quit. A verified Dock persistent-app entry pins this exact path. Signing was skipped because the configured release identity is untrusted on this Mac, so do not describe the preview as a trusted production release or silently replace the identity. The daemon socket is absent; live project/thread and hardware acceptance remain unavailable. See snapshot for exact process and pin state. The prior sentence about no Zero process applied before this user-requested preview and is superseded by this paragraph.

## September 22 audit supersession

The installation/process statements and September 9 implementation inventory below are historical. Current measured baseline and architecture findings are in [the redesign audit](docs/evidence/2026-09-22-zero-redesign-audit.md). The isolated `codex/zero-redesign` worktree baseline is `0bf0438`; known installed app/CLI/database are absent and no Zero processes were found, so do not use the older installed-health claims as recovery evidence. No service was changed. Restore/recover production only under separately authorized scope.

Current code supersedes two older architecture claims: `nodes/esp32-desk/main/main.c:463` now stop/destroys the real WebSocket and flushes queues on requested local reset; the historical overflow-only-flips-connected diagnosis is not the current implementation. This does not prove physical recovery. `apps/macos/Sources/ZeroCockpit/CockpitApp.swift:16` now contains real cockpit windows plus a menu companion; Electron also owns a desktop/tray, requiring release ownership clarification. Preserve older physical failure evidence and keep the display band parked.

Task 2 confirmed unredacted, unbounded bridge-event file persistence and an unsettled promise for malformed RPC errors using synthetic fake children; 48 bridge/IPC tests passed. Provider sends remain unconditionally blocked through renderer IPC. Fix persistence and bridge correctness before enabling dispatch, then perform the approved Airlock/Inspector/Skills/Network work with the audit's bounded owner plans. Source-only audit did not validate compact/default/large visual behavior, actual keyboard flows, installed signing/rollback, or physical latency. Snapshot/handoff edits remain unstaged for the controller; only canonical audit evidence is committed by this task.

## 1. Current user direction and project purpose

The user reaffirmed that Project Zero needs a dedicated native macOS application comparable in role to the Codex desktop app. That application is the primary cockpit and abstraction layer. The menu bar is a compact companion for status, permissions/approvals and useful quick controls; it must not be the main project-selection, intent-entry or coding interface. Remove the menu's “Work on Project Zero” workflow from the product direction. Show elapsed focus time with hours in the native app instead of unbounded minutes. The reported roughly 20-second menu pause/resume-to-ESP32 delay is a major reliability defect; connected propagation should feel immediate and offline/queued state must be explicit.

The user wants the future conversational layer to reuse the existing Codex ChatGPT login if supported: general typed input, transcribed voice and model-assisted intent understanding use GPT-5.6 Luna at medium reasoning, while actual coding work uses GPT-5.6 Sol at medium reasoning. Preserve local deterministic parsing for known Zero commands. There is no advertised GPT-6 Luna model. No implementation, deployment, hardware test or automatic model invocation was authorized or performed in the review that recorded this direction. Continue to leave the display band alone unless the user reopens it.

Project Zero is a personal, local-first environment runtime on the personal Mac, with a dedicated ESP32 desk display. The everyday loop is: explicitly select a project, start focus, see elapsed/state/connectivity plus Git, observed agent status and Spotify, pause/resume using BOOT, and recover durable state across restarts. The runtime owns state; interfaces reflect committed state and show uncertainty honestly.

The user values execution after planning, predictable installation, consistent versions and minimal configuration burden. Avoid repeated approval questions for already-authorized reversible work. Use one agent in the same task, meaningful test-first changes and evidence before completion claims. Do not hide an unsupported integration or a physical failure behind a passing simulator test.

Canonical product specification: [PROJECT_ZERO_SPEC.md](PROJECT_ZERO_SPEC.md), originally [the Google specification](https://docs.google.com/document/d/1LLFTPbh4YMIST0SH27XJmf3ITT1vlHki-crrpNFbu_I/edit?tab=t.0). Its header still says **Version 0.1** even though the current product/release branch is 0.2.0; do not describe the canonical file itself as spec v0.2 until it is deliberately revised. Latest approved release plan/design:

- [v0.2 complete implementation and reliable installation](docs/superpowers/plans/2026-09-09-v02-release.md)
- [release design](docs/superpowers/specs/2026-09-09-v02-release-design.md)
- Earlier plans in `docs/superpowers/plans/` explain v0.1 and the initial v0.2 preview.

**Read older documentation as historical.** In particular, README still contains legacy `.runtime/live` launch/flash examples and outdated “soak in progress / preview not installed” statements. Production is now installed; use the runbooks and snapshot instead of those old startup examples.

## 2. Decisions and boundaries that persist

- Personal Mac only. Never discover, enroll, inspect or collect context from the work Mac. Do not scan the Developer directory. Additional personal repositories require explicit registration; only Project Zero is initially registered.
- Codex observation is metadata-only and must not start/resume coding work. Turn completed/failed/interrupted is distinct from achieving a software objective. Do not infer completion from inactivity or a hook Stop event, and do not scrape UI/private databases/transcripts.
- Spotify observation uses the installed Mac application; no playback controls, account API or automatic app launch. **Later user amendments authorized artwork and a real bass-reactive waveform**, superseding the original no-artwork scope. No microphone, raw audio storage/transmission, or artwork rotation.
- BOOT pauses/resumes focus regardless of media. Reset/EN is never an input button. Offline presses are discarded.
- Three bounded routines: Git refresh during focus, verified relevant Codex completion once (blocked with observation), and a reminder at 45 accumulated active minutes. Reminders do not pause focus. Unreviewed firings do not count as correct.
- Known intent phrases resolve locally. Unfamiliar phrasing may use Codex only after a per-request export preview and approval, complete restricted context/tools isolation, schema validation and mandatory proposal review. Limits are one concurrent request, 30 seconds, 20/day, no retries. This optional path is currently disabled, not secretly substituted with a less restricted model session.
- User explicitly **waived the 24-hour soak and 14-day evaluation release gates**. No scheduled AI checks or automatic model calls. The hourly `project-zero-hardware-soak` automation was recorded PAUSED; the obsolete local collector was stopped. Preserve incomplete evidence; do not restart either.
- Keep “implemented,” “ready for evaluation,” and “accepted” distinct. Full v0.2 is not accepted; Codex outcomes, hardware reliability and other checks remain open.

## 3. Architecture and code map

| Area | Location and contract |
| --- | --- |
| Daemon / CLI | `core/cmd/zerod`, `cli/cmd/zero`. Go modular runtime, separate UI lifecycle. |
| Durable storage | `core/storage`, `core/runtime`. modernc SQLite, WAL/FULL, foreign keys and versioned migrations. Transactions cover durable events/projections/decisions/invocations/outbox; serialized mutation path. Preserve existing history/grants/identity. |
| Local interface | `core/api/unix.go`, `peer_darwin.go`. Owner-restricted Unix socket with peer identity checks; HTTP/JSON, stable machine output, dry-run/idempotency/audit boundaries. |
| Node transport | `core/api/nodes.go`, `core/protocol`, `sdk/go`. Mutually authenticated TLS WebSockets, bounded JSON, node enrollment, session fencing, authorization, invocation results and reconciliation. |
| Policy and effects | `core/runtime/actions.go`, `dispatch.go`. Permission states DENIED, ASK, SESSION_ALLOWED, ALWAYS_ALLOWED; deny precedence, exact-action approval, deadlines, desired display restoration and transactional outbox. Never blindly repeat an uncertain non-idempotent effect. |
| Projects / focus / context | `core/runtime` personal/session/context code. Stable project registration and aliases, explicit end/switch, accumulated elapsed time, provenance/freshness and explicit override precedence. RUNNING time includes runtime downtime; PAUSED time freezes. Projection rebuild must not dispatch physical effects. |
| Integrations | `integrations/git`, runtime integration/workers code, native helpers. Fixed Git arguments/timeouts on registered paths only, no fetch/scripts/file mutation. Integration work stays outside serialized transactions. Spotify nominally polls every 2 s while enabled/running; Git every 15 s during focus. |
| Native UI | `apps/macos`: the current `ZeroMenu` SwiftUI/AppKit window is only an early menu-bar interface, not the required native cockpit. `ZeroKit` provides Unix transport/artwork/filter code; `ZeroMacObserve` provides Spotify scripting; `ZeroAudio` provides the Core Audio tap. Pending request identity survives transport uncertainty. The next UI design must introduce a normal native app window, reduce the menu surface, and format elapsed time as hours/minutes/seconds. |
| ESP32 | `nodes/esp32-desk/main`: protocol parser, rendering, provisioning, keys, debounced BOOT, Wi-Fi/WebSocket lifecycle. |
| Schemas / generators | `proto/schemas`, `proto/fixtures`; `tools/schema-gen.py`, `tools/release-gen.py`. Display fixtures run in Go and C. Do not manually diverge generated metadata. |
| Install / recovery | `tools/build-macos.py`, `install-release.py`, `setup-signing.py`; `docs/runbooks/`. |

CLI scope includes status/doctor/version, nodes/pairing/revocation, grants/capabilities/approvals, events/state/audit, projects, session start/pause/resume/end/show, context show/assert/clear/explain, local intent parse/run/explain and `run`, integration controls, typed automation policies/history and costs. The preview contains substantial implementations; **do not assume every planned command/schema/error/physical gate has been exhaustively audited**. Follow the latest checklist and tests.

## 4. Installation, release identity and production state

Current exact build is in [snapshot.md](snapshot.md). `core/release/manifest.json` is the source of product version, build identity, supported protocols/render schemas and migration level. Generated Swift/C metadata must agree. Product `0.2.0` is separate from protocol `0.1`, render `0.2`, and database level `2`.

Production locations:

- `~/Applications/Zero.app`, bundled `zero`, `zerod`, `Zero Observer.app` and `Zero Audio.app`.
- `~/Library/Application Support/ProjectZero/zero.db`, `zero.sock`, `daemon.log`, installation receipt and `recovery/`.
- `/opt/homebrew/bin/zero` symlink to the installed CLI.
- LaunchAgents `dev.projectzero.zerod` (one production runtime) and `dev.projectzero.menu` (login UI). Closing the interface must not stop the daemon.
- `.runtime/live` is the preserved legacy source/recovery reference, **not** a second current production data directory. Development data must remain isolated and visibly selected.

Persistent local signing identity: **Project Zero Local Release** in login Keychain. Bundle identities include `dev.projectzero.menu`, `dev.projectzero.observer`, `dev.projectzero.audio`; runtime designated identity is `zerod`. Runtime authority is stored under Keychain service `project-zero.runtime-authority`. Never print/export it, regenerate it to work around a prompt, or copy it into SQLite/logs.

Installation preflights Keychain access before stopping the old service, stages the signed app, takes a consistent SQLite backup including WAL, saves app/config/database, switches the service, health checks and attempts restoration on failure. An early failed cutover exposed Keychain and launchd timing problems; foreground preflight and bootstrap retry were added. Later upgrades completed. **Keychain prompts still recurred across builds despite the same designated signing requirement; automatic permission retention is not proven.** The user approved prompts locally. Never request passwords or automate the security dialog.

Full installed rollback is not physically exercised. Automated failed-health restoration and consistent WAL backup tests pass. The oldest legacy backup predates a complete Zero.app and needs the legacy manual procedure; newer snapshots include app/database/config. A deliberate database rollback loses post-snapshot history from the restored view, so preserve a current backup first.

See [installation runbook](docs/runbooks/v02-installation.md) and [hardware recovery](docs/runbooks/hardware-recovery.md) before any upgrade/flash.

## 5. Hardware and media implementation

Verified hardware: classic ESP32-D0WD-V3 rev 3.1, 4 MB flash; ST7735-compatible 128×160 portrait display; SPI SCLK 18, MOSI 23, CS 5, DC 16, reset 17; BLACKTAB orientation, 8 MHz SPI; fixed backlight is an acknowledged hardware exception. BOOT GPIO0. USB was `/dev/cu.usbserial-1410`—re-enumerate if absent, do not guess another board.

Times Gate reference: `/Users/hemangdoshi/Developer/times-gate`. Reuse verified hardware/render/audio lessons, not TG2 transport/security. Keep it unchanged.

Current screen: one project header, focus state and timer, Spotify text on the left, 32×32 artwork centered at x48..79/y85..116, narrow waveform on the right, Git/Codex and connectivity footer. Text is bounded/truncated; no automatic screen rotation. Media layout is physically visible, but the user reported the persistent band described below.

Artwork: native helper reads Spotify artwork URL, permits bounded HTTPS images from the expected Spotify CDN, refuses redirects, limits download/time/image dimensions, converts to exactly 2,048 RGB565 bytes and caches one small image. Runtime stores deduplicated assets; sends artwork only to advertising nodes (`rgb565-32`). Older displays retain text/focus compatibility.

Audio: `ZeroAudio` adapts Times Gate’s Spotify-only process tap; `BassFilter` measures roughly 40–200 Hz energy. PCM stays in RAM; helper emits normalized level/bass bytes. Runtime keeps latest levels in RAM and checks Spotify enabled/freshness, paired profile and display permission. Firmware interpolates/damps the narrow trace and flattens stale/paused/disconnected input. Mac audio capture needs OS permission; text/focus must continue without it.

### Unresolved connectivity incident — important

Do not repeat the earlier completion claims. Initial streaming sent about 20 JSON samples/s on the control WebSocket. A single command/audio receive queue overflowed; separating/coalescing audio helped the waveform, but recurring outages remained. Subsequent evidence:

1. Send-lock timeout while receiving continuously → enabled Espressif’s separate TX lock. This removed an observed lock-contention failure, **not all outages**.
2. Audio age grew into seconds, TLS read failures and server write deadlines followed → increased connection I/O timeouts from 3 to 10 seconds, preserving 500 ms audio freshness. **Still failed**. Wi-Fi association/DNS lookup failures also appeared during reconnect; do not attribute every failure to the same cause.
3. Latest build 7 introduces `levels-v2`: at most one audio update in flight, receipt-bound sequence/session, max 10 Hz; newest sample replaces superseded samples only after receipt. Tests prove matching/duplicate receipt behavior. However, the final real-device capture still hit **command queue overflow**, after 340 received / 313 accepted audio frames, and reported socket/welcomed false thereafter.

Current command queue has two 8,193-byte slots; audio has a separate 1,024-byte overwrite slot. The overflow path sets the firmware `connected` flag false without necessarily closing/restarting the underlying WebSocket. This is an important observed failure path, not a verified complete root cause. A future authorized investigation should model control-message bursts/ACKs and lifecycle recovery; do not simply keep increasing queues/timeouts and declare victory.

The user subsequently measured roughly 20 seconds between a menu pause/resume and the change appearing on the ESP32. The local command path commits immediately and a healthy connected node checks pending work every 100 ms. At 12:33 IST, `zero doctor` reported the desk OFFLINE with last seen `2026-09-09T06:29:42.141Z`, and the production daemon log contained repeated `capability.invoke` write timeouts, broken pipes and closed-connection failures. Treat the delay as failed delivery followed by retry/reconnect, not as an acceptable polling interval. Future acceptance should separately measure command commit, transport send, firmware receipt/result and first rendered frame; target a sub-second visible update while connected and show explicit offline/queued state otherwise.

`core/api/telemetry.go`/test and the latest changes are uncommitted. Receipt message type is in the envelope list, but a separate receipt-body schema/conformance audit is still missing. Receipt handling currently also passes through general `Seen` metadata persistence; review that cost and lifecycle behavior if resuming flow-control work. Missing receipts suspend streaming until receipt/session recovery; that behavior needs physical coverage.

Evidence: `.runtime/flow-acceptance.log` is the latest failed capture; earlier `.runtime/link-build6-acceptance.log`, `link-final-acceptance.log`, `link-tx-lock-acceptance.log` explain rejected fixes. [Display/link evidence](docs/evidence/2026-09-09-display-link-debugging.md) may end before the latest interrupted capture; this handoff/snapshot explicitly supersede optimistic or in-progress lines there.

### Display band — leave alone unless user reopens it

User photo: `/Users/hemangdoshi/Downloads/IMG_7296.heic` (local personal reference, not committed). A dark horizontal band crosses the project header and extends into the background. The renderer’s pixel output has no blank header row. White appeared clean, but a stationary solid-gray screen retained the band with drawing paused. Restoring full Times Gate/Adafruit BLACKTAB frame-rate/power/VCOM/gamma initialization did not remove it.

This implicates panel/cover/controller-level response rather than the text/waveform painting. **Exact physical cause is not established; do not claim confirmed dead pixels or a repaired panel.** The user said to leave it. USB diagnostic commands `PANELTEST` (white, 15 s) and `PANELGRAY` (gray, 30 s) return automatically; do not run them unasked now.

## 6. Codex interface and acceptance status

[The earlier bounded Codex investigation](docs/evidence/2026-09-09-v02-codex-boundary.md) correctly found no supported way for Zero to attach to and observe a desktop-owned Codex turn at that time. The installation/interface has now materially changed. The pinned standalone CLI remains `~/Library/Application Support/ProjectZero/toolchains/codex-0.153.4/codex`, `/opt/homebrew/bin/codex` points there, and `codex login status` reports `Logged in using ChatGPT`. This binary exposes `codex app-server` over stdio, Unix socket or WebSocket. A bounded stdio probe initialized successfully and `model/list` returned the models available to this account. This supports building a Project Zero-owned Codex frontend without reading credentials or depending on a private desktop database/socket; it does not retroactively make desktop-observation claims true.

Live advertised routes on 2026-09-09 were:

- `gpt-5.6-luna`: low, medium, high, xhigh and max; default medium; text/image input.
- `gpt-5.6-sol`: low, medium, high, xhigh, max and ultra; default low; text/image input.
- `gpt-5.6-terra`: balanced coding route; low through ultra; default medium.
- `gpt-6-astra`: low through ultra; no model named GPT-6 Luna was advertised.

The intended first routing policy is deterministic local parsing for known Zero commands; GPT-5.6 Luna medium for general text, locally transcribed voice and ambiguous intent interpretation; and GPT-5.6 Sol medium for explicit coding work. The app-server's advertised models do not accept audio directly, so voice requires a separate transcription layer. Using an OpenAI Realtime/audio API would be a separate API-auth/billing path; a local Apple speech path can keep the Codex ChatGPT login as the only model authentication. Before enabling model parsing, prove bounded context, structured output, approval behavior, cancellation and that the non-coding route cannot acquire repository/shell tools. The current Zero runtime still has model parsing disabled.

Passed evidence includes durable runtime/simulator work, automated migration/policy/session tests, native transport tests, real Spotify metadata/artwork, previous BOOT confirmation and user-confirmed manual setup notification. The notification says “Zero setup check”; it is **not** proof that an actual 45-minute automation fired correctly.

Open requirements include stable real link/reconnect/deduplication, full physical interruption/sleep-wake matrix and <10 s restoration after authenticated reconnect, installed rollback/permission retention, dispatch performance, complete CLI/API/schema audit and operational diagnostics/log rotation. Full Codex outcomes block full v0.2 acceptance. Use [release checklist](docs/evidence/2026-09-09-v02-release-checklist.md) with the newer failure corrections in the snapshot.

Measured subsets: installed status p95 about 0.177 ms, idle RSS 28.625 MiB, daemon crash recovery about 0.212 s before audio; a later playing-audio measurement gave p95 0.233 ms/RSS 30.625 MiB. These do not prove physical screen restoration, dispatch latency or stable networking.

## 7. Verification and recovery commands

Run from the repo, using preinstalled dependencies where possible. Do not deploy as a side effect of verification.

```sh
zero version
zero doctor
zero integrations list
zero session show

go mod download                       # only if dependencies need installation
make test                             # offline Go race + Python tests
ZERO_TEST_SOCKET="$HOME/Library/Application Support/ProjectZero/zero.sock" swift test --package-path apps/macos
bash tools/test-firmware.sh            # host protocol fixtures + ESP-IDF build; does not flash
python3 tools/release-gen.py --check
python3 tools/schema-gen.py --check
python3 tests/test_desk_layout.py      # compiles actual firmware renderer
```

Go module targets 1.25.0; ESP-IDF 5.5.2, WebSocket component 1.6.1, mDNS 1.9.1 are pinned. SDK/runtime lives under `.runtime/toolchains/esp-idf`; ESP Python used at `/Users/hemangdoshi/.espressif/python_env/idf5.5_py3.14_env/bin/python`. The Spotify audio tap requires macOS 14.2+. Firmware/renderer tests require the local ESP-IDF cJSON checkout. Tests are offline only after these dependencies are installed.

For SDK/API specifics: `npx ctx7@latest library '<official name>' '<specific question>'`, then `npx ctx7@latest docs '<returned ID>' '<question>'`; resolve first, at most three requests per question, report quota errors and suggest login/API-key setup rather than guessing. Never send secrets. Context7 sometimes did not index component-specific options; installed pinned Kconfig/source supplied the exact separate-TX-lock contract.

Authorized release workflow: build/sign with `python3 tools/build-macos.py`; preview `python3 tools/install-release.py upgrade --source .runtime/v02-build/Zero.app --dry-run`; execute only within the requested deployment scope. Match compatible host protocol first, then firmware, and retain backups. Review Keychain prompts locally.

**Firmware recovery protections:** verified full-flash backups are private, including `.runtime/recovery/zero-before-v02.bin` and its production recovery copy; original AuxDeck backup remains `.runtime/recovery/auxdeck-original.bin`. These contain provisioning/keys: never commit, print or upload their contents. Reverify checksum artifacts before a future flash. The routine upgrade writes only application offset `0x10000`; do not erase all flash or use README’s old full-region example casually. UART/serial opening resets this board even with DTR/RTS disabled, so account for that intentional interruption in evidence.

## 8. How to take over safely

1. Read these three root documents and the current user request. Check `git status`, installed versions and health without changing session state.
2. Preserve the uncommitted implementation inventory from the snapshot. `git checkout` of the old implementation HEAD would not reproduce the installed build 7. Do not automatically commit unfinished physical fixes as accepted work.
3. If engineering is requested, define the next bounded verification target and isolate development from production. Treat failed physical captures as failures even though software tests pass.
4. Update snapshot with exact outcomes/current dirty work, and reconcile this handoff before ending. Keep logs and long incident details in evidence files; never turn AGENTS.md into a running diary.

The AGENTS.md base is the community `multica-ai/andrej-karpathy-skills` guidance at commit `2c606141936f1eeef17fa3043a72095b4765b9c2`, adapted to agent-neutral naming. Upstream README declares MIT and explicitly invites copying/customization; no claim is made that Karpathy authored that repository.
