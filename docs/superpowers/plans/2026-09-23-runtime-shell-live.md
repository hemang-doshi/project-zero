# Runtime Telemetry and Desktop Shell Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` in one agent in the current task. Steps use checkbox (`- [ ]`) syntax. Do not dispatch subagents under the Project Zero working agreement.

**Goal:** Show recent measured machine telemetry immediately on opening Runtime, add an honest GPU chart and attributable process details, and make theme/wallpaper state reliable and understandable.

**Architecture:** Keep telemetry in Electron main, separate from the Zero daemon. Main owns a bounded timestamped ring buffer and samples only while the app is active according to a measured CPU budget; Runtime subscribes and renders a fixed time window with gaps for missing data. Wallpaper import copies a chosen image into the app profile; theme remains a saved preference.

**Tech Stack:** Electron main/renderer, React, TypeScript, macOS system counters, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-zero-desktop-recovery-design.md`

## Global Constraints

- Do not start a second production daemon or change the runtime socket. The dev profile remains separate.
- Do not fabricate historical telemetry, process attribution, GPU values or hardware connection state.
- Sampling must stop or reduce when the app is idle/hidden and must respect the existing idle CPU budget.
- Preserve production preferences and original files; import new wallpaper into the chosen profile without deleting source images.
- Network and Flight Recorder route behavior remain unchanged.

## Review Focus

- Runtime opens 20 seconds into a 30-second display window: show existing timestamped points at their real positions and blank spans where measurements were absent. Test in Task 1.
- Main sampler is unavailable or one command times out: preserve prior points, mark a gap, and show which family failed. Test in Task 1.
- GPU utilization key is absent on a Mac: show unavailable with a reason, never a 0% graph. Test in Task 2.
- Process exits between ranking samples or counter wraps: remove stale row or mark rate unknown, never show a negative rate. Test in Task 2.
- Imported wallpaper source is removed and the app restarts: managed copy still renders; missing managed copy falls back visibly. Test in Task 3.

---

### Task 1: Timestamped telemetry and first-open history

**Files:** Modify `apps/desktop/src/main/telemetry.ts`, `index.ts`, `ipc.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/renderer/src/routes/RuntimeRoute.tsx`, `telemetry.model.ts`; test `telemetry.test.ts`, `runtimeRoute.test.tsx`, `telemetry.model.test.ts`.

**Interfaces:** `TelemetryPoint = {at:number, sample:TelemetrySample, failures:string[]}`; main exposes `telemetry.history` for a bounded recent window and a push event or controlled polling for new points. The renderer keeps actual timestamps, not just arrays of evenly spaced samples.

- [x] **Step 1: Measure the current sampler** with read-only runs in the isolated preview: command time, CPU overhead, response shape and behavior with no daemon. Record the selected window length and cadence from measured cost before coding.
- [x] **Step 2: Add failing tests** for pre-open points, missing samples, visibility changes, concurrent requests, counter warm-up, buffer cap and replay after route remount. A graph starts with available prior measured data but never invents earlier values.
- [x] **Step 3: Move rolling history to main.** Serialize sampling, timestamp each result, retain a bounded ring, and seed the route on mount. Keep sample-family errors separate so one failed source does not blank healthy charts.
- [x] **Step 4: Draw a fixed-time x-axis** and include truthful empty spans. On the first observation, show the current reading even if rate-based disk/network values need a second sample. Separate machine telemetry status from daemon/focus session status in labels.
- [x] **Step 5: Verify** isolated no-daemon preview, app hidden/visible behavior, target performance budget, targeted tests and typecheck; commit.

### Task 2: GPU graph and top-process details

**Files:** Modify `apps/desktop/src/main/telemetry.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/renderer/src/routes/RuntimeRoute.tsx`, `telemetry.model.ts`; create `apps/desktop/src/main/process-telemetry.ts` with tests.

**Interfaces:** Add nullable GPU history from measured `ioreg` values. `ProcessMetric` carries PID, name, sample time, metric, unit and provenance. Only metric families with verifiable per-process data are offered as ranking tabs.

- [x] **Step 1: Probe macOS counter capabilities** with read-only `ps`/`proc_pid_rusage` or supported system APIs on this host. Determine which of CPU, resident memory, disk I/O and network bytes are attributable per process without privileged access. Write down unsupported categories; do not approximate pressure as a process value.
- [x] **Step 2: Add failing tests** for GPU present/absent, ranking ties, PID reuse, exited process, permission-denied rows and counter rollback. The selected metric's unit and timestamp must be visible.
- [x] **Step 3: Add the fifth GPU panel** reusing measured history and making absent `ioreg` data explicitly unavailable. Keep the footer as a short source/provenance note.
- [x] **Step 4: Add an expandable top-10 process drawer** for supported metrics. For CPU and memory, show exact measured definitions. Offer disk/network tabs only if the probe confirms reliable per-process counters; otherwise show an explicit unsupported explanation, not invented rankings.
- [x] **Step 5: Verify** with fixtures and physical host samples, no runaway sampler cost, full desktop suite and visual review; commit.

### Task 3: Theme verification and durable wallpaper import

**Files:** Modify `apps/desktop/src/main/prefs.ts`, `wallpaper-image.ts`, `ipc.ts`, `apps/desktop/src/renderer/src/desktop/SettingsSheet.tsx`, `DesktopCanvas.tsx`, `WallpaperLayer.tsx`, `apps/desktop/src/renderer/src/theme.css`; test prefs/wallpaper/settings/canvas files.

**Interfaces:** A selected custom image is validated, copied into managed profile storage, and referenced by an internal path/ID. Existing absolute-path preferences migrate without changing or deleting the original file.

- [x] **Step 1: Reproduce theme and wallpaper behavior** in dev and packaged preview. Confirm the saved theme, initial flash, all route token coverage, Settings visibility and whether the custom path survives relaunch/source deletion.
- [x] **Step 2: Add failing tests** for light/dark hydration, theme setting persistence, selected image import, restart, removed source file, invalid/oversize format and stale saved path.
- [x] **Step 3: Implement managed wallpaper copies** with an atomic file write in the correct profile; reuse the existing safe image protocol. Keep a visible neutral fallback for missing or unreadable managed assets. Do not touch unrelated prefs keys.
- [x] **Step 4: Improve Settings affordance** so the theme choice is easy to find and its selected state is clear. Audit contrast and hard-coded colors across Zero Bot, Desk, Runtime and Skills Lab; change only confirmed offenders. Verify reduced-motion state and avoid flashy idle animation.
- [ ] **Step 5: Verify** restart in isolated dev profile and unpacked preview, targeted tests, typecheck, full desktop suite and `git diff --check`; commit.

## Execution record — 2026-09-24

Runtime uses a bounded history of measured macOS samples, including ioreg GPU data when exposed. Playwright verified recent history, all five chart families, the daemon/machine status distinction, and the CPU/memory process drawer; disk/network process attribution stays explicitly unavailable. Theme switching was exercised through Settings in Playwright and restored to dark. Wallpaper managed-copy behavior is covered by tests; a native file-picker/source-removal restart was not exercised in the app. See [snapshot.md](../../../snapshot.md) for packaging and environment limits.
## Completion gate

Demonstrate immediate prior measured data on Runtime opening, five honest chart states, correct daemon-vs-machine status, supported top-process ranking, persisted imported wallpaper and discoverable dark mode. Record exact sampler overhead and unavailable metrics in snapshot/handoff. No physical desk acceptance is implied.
