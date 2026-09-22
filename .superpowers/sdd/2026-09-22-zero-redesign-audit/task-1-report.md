# Task 1 — Reproducible baseline

**Status:** DONE_WITH_CONCERNS
**Observed:** 2026-09-22 17:16–17:20 IST
**Worktree:** `/Users/hemangdoshi/.codex/worktrees/zero-redesign/project-zero`
**Scope:** Read-only diagnostics and isolated test execution only. No provider turn, daemon/socket/database command, production install, skill action, firmware flash, or source edit was performed.

## Baseline identity

- Branch and clean inventory: `## codex/zero-redesign`; `git status --short` had no entries before this report was added.
- HEAD: `0dbdb66f068afafe6cfe64bcffb47e8851a7dbd6` (`docs: plan zero desktop redesign execution`).
- Manifest (`core/release/manifest.json`): product `0.2.0`; build `0.2.0-7`; wire protocol `0.1`; render schemas `0.1`, `0.2`; database migration level `2`.
- Desktop package root: `desktop@1.0.0`; package lock v3; Electron `^39.2.6`, React/React DOM `^19.3.0`, TypeScript `^5.9.3`, Vite `^7.2.6`, Vitest `^5.0.0`, Playwright `^1.63.0`, Three `0.186.0`.
- Toolchain observed: Node `v26.0.0`, npm `11.12.1`, Go `go1.25.0 darwin/arm64`, Swift `6.3.3`, Command Line Tools selected at `/Library/Developer/CommandLineTools`.

## Live-state and resource sample

Sampling used `ps` twice, two seconds apart, for the exact target names/paths `zerod`, `ZeroMenu`, `ZeroAudio`, `ZeroMacObserve`, and `Zero.app`; `pgrep` found no matching live process. Therefore idle CPU and RSS are **not measurable**, and the helper count is **0**—not an assertion that the production service is healthy.

The known production path `/Users/hemangdoshi/Applications/Zero.app` and its `zerod` binary were absent; `/opt/homebrew/bin/zero` was also absent. `/Users/hemangdoshi/Library/Application Support/ProjectZero` exists, but `zero.db`, `zero.db-wal`, and `zero.db-shm` were absent, so all three database/WAL size measurements are **unavailable**.

`launchctl print` was read-only and showed stale/inactive launch-agent configuration: `dev.projectzero.zerod` has `active count = 0`, `state = spawn scheduled`, and an absent `Zero.app` executable as its program; `dev.projectzero.menu` has `active count = 0`, `state = not running`. The daemon agent also reported a failed spawn job state. No service was started, stopped, or queried through its socket.

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
| `env -u ZERO_TEST_SOCKET HOME=<tmp> swift test --package-path apps/macos` | BLOCKED before tests | `Package.swift` manifest failed to link `PackageDescription.Package.__allocating_init` with the selected Command Line Tools Swift 6.3.3 environment. No runtime socket was supplied. |
| `bash tools/test-firmware.sh` | BLOCKED before host test | Isolated worktree lacks `.runtime/toolchains/esp-idf/components/json/cJSON/cJSON.c`; no hardware action occurred. |
| `npx vitest run src/renderer/src/desktop/taskbar.test.tsx --reporter=dot` | PASS, 1 file / 6 tests, 425 ms | Isolated bounded click/restore/minimize interaction described above; React `act(...)` warnings remain. |

## Concerns and follow-up

1. The prior snapshot's reported installed runtime is not current evidence. This sample instead finds an absent app/CLI/database plus a launch agent scheduled against the absent executable. Diagnose/recover that state only under separately authorized production scope.
2. Fresh desktop verification is green but not pristine: 44 lint warnings and substantial React/Three test stderr weaken baseline signal.
3. Native Swift and firmware host coverage are not reproducible in this worktree because the local Command Line Tools manifest linkage and ESP-IDF checkout are unavailable. Restore/verify those toolchain prerequisites before treating their historical results as fresh.
4. No live desktop resource profile or real UI operation was measured because no desktop process was running, and starting the configured agent would risk production interaction. A later authorized isolated Electron profile should measure CPU/RSS and an actual route interaction.

## Files changed and self-review

- Added only this report. No product source, snapshot, or handoff file changed.
- `git diff --check` passed before adding the report; final status and diff are reviewed below before commit.
