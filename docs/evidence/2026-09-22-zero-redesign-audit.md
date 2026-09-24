# Zero redesign audit — reproducible baseline

**Status:** DONE_WITH_CONCERNS
**Observed:** 2026-09-22 17:16–17:20 IST
**Worktree:** `/Users/hemangdoshi/.codex/worktrees/zero-redesign/project-zero`
**Scope:** Read-only diagnostics and isolated test execution only. No provider turn, daemon/socket/database command, production install, skill action, firmware flash, or source edit was performed.

## Baseline identity

- Branch and clean inventory: `## codex/zero-redesign`; `git status --short` had no entries before audit evidence was added.
- Baseline HEAD: `0dbdb66f068afafe6cfe64bcffb47e8851a7dbd6` (`docs: plan zero desktop redesign execution`).
- Manifest (`core/release/manifest.json`): product `0.2.0`; build `0.2.0-7`; wire protocol `0.1`; render schemas `0.1`, `0.2`; database migration level `2`.
- Desktop package root: `desktop@1.0.0`; lockfile v3; SHA-256 `36dcd263269ddb9df397ff9a57a516f2eec1583b7497a8baf9b8978a0290622e`.
- Resolved lock versions: Electron `39.8.10`; electron-vite `5.0.0`; electron-builder `26.15.3`; Vite `7.3.6`; Vitest `5.0.0`; TypeScript `5.9.3`; React/React DOM `19.3.0`; Three `0.186.0`; Playwright `1.63.0`.
- Toolchain observed: Node `v26.0.0`, npm `11.12.1`, Go `go1.25.0 darwin/arm64`, Swift `6.3.3`, Command Line Tools selected at `/Library/Developer/CommandLineTools`.

## Live-state and resource sample

Sampling used `ps` twice, two seconds apart, for exact target names/paths `zerod`, `ZeroMenu`, `ZeroAudio`, `ZeroMacObserve`, and `Zero.app`; `pgrep` found no matching live process. Idle CPU and RSS are therefore **not measurable**, and helper count is **0**—not an assertion that the production service is healthy.

The known production path `/Users/hemangdoshi/Applications/Zero.app` and its `zerod` binary were absent; `/opt/homebrew/bin/zero` was also absent. `/Users/hemangdoshi/Library/Application Support/ProjectZero` exists, but `zero.db`, `zero.db-wal`, and `zero.db-shm` were absent, so all three database/WAL size measurements are **unavailable**.

Read-only `launchctl print` showed stale/inactive launch-agent configuration: `dev.projectzero.zerod` had `active count = 0`, `state = spawn scheduled`, and an absent `Zero.app` executable as program; `dev.projectzero.menu` had `active count = 0`, `state = not running`. The daemon agent also reported a failed spawn job state. No service was started, stopped, or queried through its socket.

No live Electron desktop process existed to operate. To preserve that state, this audit did not launch one. The bounded UI-interaction proxy was the isolated JSDOM taskbar test: it clicks the front taskbar button to minimize and a background/minimized button to restore/focus, with no Electron process, IPC, socket, filesystem, or provider dependency. It passed 6/6 in 425 ms, with React `act(...)` environment warnings.

## I/O and isolation preflight

The required search, `rg -n 'HOME|socket|zero.db|spawn|exec|fetch' apps/desktop/src core apps/macos/Tests`, found these relevant boundaries:

- Electron defaults point at `$HOME/Library/Application Support/ProjectZero/zero.sock` and preferences; its bridge code can spawn Codex/OpenCode only when explicitly connected. `ipc.ts` explicitly throws `send blocked until runtime path ships` for both `codex.send` and `ocp.send`. Test bridge subprocesses are injected fakes.
- Desktop socket tests use temporary sockets/mocked fetches; renderer tests use mocked `window.zero` calls. The suite was run without launching Electron.
- Go runtime/API tests construct SQLite files and sockets under `t.TempDir()`; integration tests create temporary Git repositories and stub helper scripts. Both Go commands used fresh `HOME`, `GOCACHE`, and `GOTMPDIR` under `/tmp/project-zero-audit-go.*`, so they could not address the production Application Support path.
- The one Swift real-transport test is guarded by `ZERO_TEST_SOCKET`; it was deliberately unset. Other socket fixtures use `/tmp` or in-memory transports.
- `tools/test-firmware.sh` builds and runs a host protocol executable, then calls `idf.py ... build`; inspection found no flash, erase, serial-port, or device command.

## Verification

| Command | Result | Notes |
| --- | --- | --- |
| `npm test -- --run --reporter=dot` (in `apps/desktop`) | PASS, 63 files / 813 tests, 3.17 s | Pre-existing output is noisy: React `act(...)` configuration warnings; `THREE_CJS_DEPRECATED`; JSDOM unknown Three element/prop warnings. |
| `npm run typecheck` | PASS | Node and web TypeScript projects both completed with no output. |
| `npm run lint` | PASS with 44 warnings | All are Prettier warnings, concentrated in Skills Lab and 3D desk files; no ESLint errors. |
| `npm run build` | PASS | `electron-vite build`; 23 main, 1 preload, and 916 renderer modules transformed. |
| `HOME=<tmp> GOCACHE=<tmp> GOTMPDIR=<tmp> go test ./...` | PASS | All test-bearing Go packages passed; no production data target. |
| `HOME=<tmp> GOCACHE=<tmp> GOTMPDIR=<tmp> go test -race ./...` | PASS | All test-bearing packages passed. Darwin linker emitted four `malformed LC_DYSYMTAB` warnings while building race test binaries. |
| `env -u ZERO_TEST_SOCKET HOME=<tmp> swift test --package-path apps/macos` | BLOCKED before tests | `Package.swift` manifest failed to link `PackageDescription.Package.__allocating_init` with selected Command Line Tools Swift 6.3.3. No runtime socket was supplied. |
| `bash tools/test-firmware.sh` | BLOCKED before host test | Isolated worktree lacks `.runtime/toolchains/esp-idf/components/json/cJSON/cJSON.c`; no hardware action occurred. |
| `npx vitest run src/renderer/src/desktop/taskbar.test.tsx --reporter=dot` | PASS, 1 file / 6 tests, 425 ms | Isolated bounded click/restore/minimize interaction; React `act(...)` warnings remain. |

## Concerns and follow-up

1. The prior snapshot's reported installed runtime is not current evidence. This sample instead finds an absent app/CLI/database plus a launch agent scheduled against the absent executable. Diagnose/recover that state only under separately authorized production scope.
2. Fresh desktop verification is green but not pristine: 44 lint warnings and substantial React/Three test stderr weaken baseline signal.
3. Native Swift and firmware host coverage are not reproducible in this worktree because the local Command Line Tools manifest linkage and ESP-IDF checkout are unavailable. Restore/verify those toolchain prerequisites before treating historical results as fresh.
4. No live desktop resource profile or real UI operation was measured because no desktop process was running, and starting the configured agent would risk production interaction. A later authorized isolated Electron profile should measure CPU/RSS and an actual route interaction.

## Task 2 — architecture and high-risk boundaries

Reviewed current HEAD `0bf0438` on 2026-09-22, with the approved September 13 redesign specification. Evidence is source inspection plus fake-child execution; no real provider, Electron window, installation, skill activation, daemon or board was started. Severity describes the implementation consequence, not evidence of an incident on this Mac. Owner plans below name the approved redesign units or a bounded audit follow-up.

### Complete renderer operation trace

All 23 operations in `apps/desktop/src/shared/ipc.ts:1` pass through the single `zero.invoke` preload surface (`apps/desktop/src/preload/index.ts:7`) to `createDispatch` (`apps/desktop/src/main/ipc.ts:104`). Operation names have a runtime allowlist; TypeScript payload types alone are not runtime schemas. `registerIpcHandlers` at line 47 discards the sender event, so no frame/origin authorization occurs there.

| Operations | Main validation / authority / side effects |
| --- | --- |
| `prefs.get`, `prefs.set` | Load or apply `applyPrefsPatch` and save main-owned preferences. |
| `snapshot.fetch`, `project.get` | Fixed socket snapshot; project ID checked as string and URL-encoded. |
| `command.send` | Checks command op is string, creates UUID, forwards body to daemon command validation/policy; body is not schema-checked by main. This is the committed-runtime command path, not a provider bridge call. |
| `skills.discover` | Treats only literal `refresh: true` as refresh; cached local discovery, fail-soft; no install or execution. |
| `codex.connect`, `ocp.connect` | Main chooses executable and spawns stdio child; renderer cannot supply executable/arguments. Codex initializes app-server; OpenCode initializes ACP. |
| `codex.disconnect`, `ocp.disconnect` | Main disconnects/kills the respective child and rejects pending requests. |
| `codex.send`, `ocp.send` | Unconditionally throw before bridge access; no renderer prompt-dispatch bypass through these operations. |
| `codex.state`, `ocp.state` | Return state and bounded diagnostic text. |
| `codex.discover`, `codex.threads` | Fixed `model/list` / `thread/list` requests, limit 100; require live connection. |
| `codex.thread.get` | Nonempty string ID; fixed `thread/read` with turns; require live connection. |
| `ocp.discover` | Main reads local OpenCode store, read-only; no ACP request or child spawn. |
| `wallpaper.pick` | Native image-selection dialog; subsequent preferences/image handler are separate boundaries. |
| `telemetry.sample`, `devices.list` | Main invokes bounded machine-observation helpers; device refresh true is literal boolean. No renderer-controlled shell string. |
| `artwork.fetch` | Hex digest pattern, fixed daemon artwork route, fail-soft conversion. |

The two preload subscription channels strip the Electron event argument. Cockpit pushes carry runtime projections; bridge pushes carry raw provider events. New prompt operations must use the proposed main-process gateway and preserve the current send block until that boundary exists.

### Confirmed defects

Fixed record shape: **severity | file:line | evidence/reproduction | impact | bounded fix | owner plan**.

- **High | `apps/desktop/src/main/bridges.ts:303` |** `mirror` synchronously appends the complete event including arbitrary `params` to `zero-meta/<harness>/events.jsonl`. A fake-child replay with `{method:'audit/fixture',params:{token:'SYNTHETIC_ONLY_AUDIT'}}` confirmed `synthetic token persisted: true` in a new `/tmp/zero-audit-bridge-*` directory. This requires only current HEAD, TypeScript's local transpiler, EventEmitter stdio fakes, and `JsonRpcStdio.connect`; no account or provider. **|** Provider event contents can persist sensitive text and the file grows without a count/byte/age limit; sync disk writes also block main. This does not claim a real secret was leaked or a prompt was sent. **|** Replace raw append with a sanitized, explicitly bounded evidence store; do not persist raw provider params. Test synthetic secret absence in all output sinks. **|** Airlock + Zero Bot/Inspector redesign, prerequisite to enabling sends.
- **Medium | `apps/desktop/src/main/bridges.ts:273` |** Response handling removes the pending entry and clears its timer before validating `error.message`; malformed `{id:1,error:{}}` then calls `failAll`, which cannot see that entry. Fake-child request with 20 ms timeout remained unsettled after 50 ms while bridge was disconnected (`malformed error promise settled: false`). **|** Caller can wait forever even after disconnect; reconnect UI or future dispatch can remain busy. **|** Validate before removing, or explicitly reject the removed entry; cover malformed-error and disconnect settlement. **|** Bridge correctness audit follow-up before provider dispatch.
- **Medium | `apps/desktop/src/main/index.ts:45`; `apps/desktop/src/main/ipc.ts:53` |** Window creation discards both subscription cleanup paths: cockpit subscription return is not retained, and returned bridge unsubscribe is ignored. Close/reopen creates another subscription; destroyed-window checks suppress sends but do not remove listeners. **|** Persistent Mac tray lifecycle retains old windows/listeners and eventually increases event work/warnings. **|** Return cockpit unsubscribe and invoke both on window close; test repeated window recreation with listener counts. **|** Desktop lifecycle audit follow-up.
- **Medium | `apps/desktop/package.json:3`; `tools/release-gen.py:7` |** Desktop package reports `1.0.0`, runtime manifest `0.2.0`/`0.2.0-7`; generator emits Swift/C metadata only, while bridge `ZERO_VERSION` at `bridges.ts:10` is independently hardcoded. **|** Desktop packaging/client identity can diverge from the product release. **|** Generate desktop release metadata from the manifest and verify packaged identity in a release check. **|** Packaging/release audit follow-up; no signing or deployment in this task.
- **Medium | `apps/desktop/src/renderer/src/routes/TopologyScene.tsx:588`; `SkillLabScene.tsx:222` |** Current wrappers have fixed 300 px / 320 px scene heights. Zero Bot composer at `ZeroBotRoute.tsx:937` is wrapping model buttons, followed by textarea and separate disabled send/voice controls. **|** Current source does not implement the approved responsive scene/composer/virtualized skills contracts. **|** Apply approved layout/list units with screenshots and keyboard acceptance. **|** Network desk, Zero Bot shell and Skills Lab redesign tasks. This is a confirmed source-contract gap; actual clipping at each viewport remains unmeasured.

### Risks requiring validation (not confirmed exploits or physical failures)

- **Medium | `apps/desktop/src/main/index.ts:53`; `apps/desktop/src/main/ipc.ts:47` |** Every new-window URL is passed to `shell.openExternal`; no scheme allowlist or `will-navigate` handler is present, and IPC does not inspect sender frame. Sandbox is explicitly enabled, preload is narrow, and CSP (`src/renderer/index.html:9`) restricts scripts to self. **|** Untrusted links/navigation need defense before richer provider/skill content arrives; this inspection does not prove a reachable remote-code exploit. **|** Allowlist external HTTP(S), deny unexpected navigation, validate main-frame origin, and exercise malicious-link fixtures. **|** Desktop security follow-up before catalog/provider content expansion.
- **Medium | `apps/desktop/src/main/skills.ts:33`; `src/renderer/src/routes/skillPlugins.ts:193` |** Discovery follows directories via `statSync`, reads whole files synchronously, and bounds recursion depth but not aggregate bytes/entries. **|** Oversized local skill files/package trees can stall main; symlink following is intentional for existing installs, not evidence of a write escape. **|** Add per-file/scan budgets and cancellation for discovery; staged installer must independently validate real paths, symlinks and types. **|** Skills Lab/catalog/staged-install redesign. No current installer mutation path was found in the main IPC operation inventory.
- **Medium | `apps/desktop/src/main/bridges.ts:192`, `:330` |** Request timeout rejects the local promise but sends no provider cancellation; disconnect sends one kill without awaiting child exit; stderr retains the last 4096 characters without sanitization. Response limit uses JS string length rather than byte length and writable backpressure is not handled. **|** Future turn cancellation/resource and diagnostic privacy contracts are not yet proven. **|** Explicit provider cancellation/exit acknowledgement, byte/pending bounds and sanitized diagnostics with fake-child failure tests. **|** Zero Bot provider/Inspector redesign before sends; no claim of current billable runaway work.
- **Medium | `core/storage/storage.go:43` |** WAL/FULL/foreign keys/busy timeout are configured, but no explicit application checkpoint/retention maintenance was found. SQLite's own checkpoint behavior must not be confused with absence of checkpointing. **|** Long-run WAL/database growth remains unmeasured because the baseline database is absent. **|** Isolated workload measurement with long-lived readers and bounded recovery checks, then justify any maintenance change from measurements. **|** Storage/performance follow-up, no production DB mutation.
- **Medium | `apps/macos/Sources/ZeroCockpit/CockpitApp.swift:16`; `apps/desktop/src/main/index.ts:117` |** Current source includes a real Swift cockpit with multiple WindowGroups and MenuBarExtra as well as the Electron desktop/tray. Historical handoff claiming only a menu prototype is stale. **|** Release ownership and duplicate companion activation need an explicit product decision and packaged-install verification. **|** Keep daemon ownership unchanged; identify the supported front end/launcher in release documentation. **|** Packaging/product follow-up, not permission to remove native code.
- **Medium | `nodes/esp32-desk/main/main.c:463` |** Current firmware handles requested reset in main loop with stop/destroy, clears socket/welcome state and flushes command/audio queues. **|** This supersedes the historical claim that overflow only flips a flag; it does not establish physical recovery or latency acceptance. **|** Restore missing host prerequisites, run fixtures, and separately authorize measured hardware checks. **|** Firmware recovery follow-up outside desktop redesign; leave display band untouched.
- **Low | `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx:982` |** Inspector presently shows thread/tool/context/bridge sections, not normalized usage/cost evidence. Compact/default/large visual and keyboard-only acceptance have not been run in a real isolated Electron window. Existing textarea/send accessibility labels and Network selection keyboard handler (`NetworkRoute.tsx:279`) are positive but insufficient for complete acceptance. **|** Missing usage must remain unavailable, never inferred as zero/free; layout/accessibility coverage remains open. **|** Add approved Inspector semantics and explicit viewport/keyboard acceptance. **|** Zero Bot + Network + Skills Lab redesign verification.

### Non-issues and bounded architecture observations

- **Informational | `apps/desktop/src/main/ipc.ts:204` |** Both provider-send branches fail closed; fixed discovery/read methods do not dispatch a prompt. **|** Airlock absence is a planned missing feature, not a demonstrated current send bypass. **|** Preserve deny tests while adding the gateway. **|** Airlock redesign.
- **Informational | `core/runtime/updates.go:46`, `:88`; `core/runtime/workers.go:14` |** Fan-out has one coalescing slot per subscriber, fixed domain vocabulary, cancellation under mutex, shared serialization and post-unlock publication. Workers run independently and serially per job; integration cadence at `core/runtime/integrations.go:341` is automation 1 s, Spotify 2 s, Git 15 s. **|** No unbounded per-subscriber event queue established; routine integration work does not spawn a new goroutine per tick. **|** Preserve isolated race tests and measure slow readers. **|** Runtime performance follow-up only if measurements warrant.
- **Informational | `core/storage/storage.go:15`; `tools/install-release.py:7`, `:35` |** Storage creates owner-only database, one DB connection, rejects future schema; installer uses SQLite backup and identity preflight before cutover, with restoration code. Electron builder names the existing local signing identity and hardened runtime (`apps/desktop/electron-builder.yml:10`). **|** These are useful source safeguards, not installed rollback/signing acceptance. No desktop auto-update path was identified in main startup/package configuration. **|** Verify installed artifacts only in authorized release scope. **|** Release follow-up.
- **Informational | `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx:982`; `apps/desktop/src/shared/ipc.ts:1` |** The audited renderer/main operation and package paths contain no payment initiation, checkout or payment processor subsystem. **|** Relevant monetary risk is future provider usage/cost truth and retries; no payment processor audit is invented. **|** Show unavailable cost until authoritative provider evidence or versioned prices exist. **|** Inspector redesign.

### Task 2 verification and limits

Fresh isolated `npx vitest run src/main/bridges.test.ts src/main/ipc.test.ts --reporter=dot`: **2 files, 48 tests passed**, 203 ms, clean output. Additional in-memory child reproductions loaded current `bridges.ts` via installed TypeScript transpilation and used only synthetic content plus a new temporary mirror directory; they reproduced both sensitive-field persistence and the malformed-error unsettled promise. No product tests/source were edited. The high claim above is independently reproducible without provider or production access. The earlier full-suite baseline remains applicable; real UI, native linkage, firmware prerequisites and installed resource measurements remain the explicitly recorded gaps.
