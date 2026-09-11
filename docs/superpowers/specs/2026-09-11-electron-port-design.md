# Electron port of the Project Zero cockpit — design

Date: 2026-09-11. Status: approved design (owner-approved Approach A, sections 1–7).
Companion handoff context: [snapshot.md](../../../snapshot.md), [handoff.md](../../../handoff.md).
Stitch visual references: `assets/stitch/project-zero-cockpit-interface/` and `docs/superpowers/specs/2026-09-10-stitch-screen-anatomy.md`.

## 1. Why

The SwiftUI macOS app keeps producing window-management and performance defects
(stacked windows, drag hit-testing, resize CPU bursts) and carries heavy
packaging friction (Go+Swift cross-builds, Keychain prompts, install timing).
The owner asked for a comprehensive plan to port the UI to Electron and to
recreate the Stitch design as a **real desktop inside an app**: freely
placeable, draggable, resizable windows; desktop icons; dummy files; a
customizable wallpaper. Subagent-driven execution is the primary process.

## 2. Scope

**In scope:** a new Electron app at `apps/desktop/` replacing the SwiftUI
cockpit (`ZeroMenu`/`ZeroCockpit` views) as the primary UI once accepted.

**Out of scope / unchanged:** Go daemon (`zerod`), CLI (`zero`), wire protocol,
ESP32 firmware, ZeroAudio and ZeroMacObserve native helpers (they report to the
daemon; the UI reads Spotify state from the cockpit snapshot exactly as the
Swift app does today — no helper change needed), production install and
services during development.

**Coexistence:** parallel build. The installed SwiftUI app keeps working until
the Electron app passes owner-side visual acceptance; only then is the SwiftUI
UI retired and a production install attempted.

## 3. Architecture

Three processes:

1. **Renderer** — React 18 + Vite (electron-vite), TypeScript strict, Tailwind
   with CSS variables generated from the same token hex values as
   `apps/macos/Sources/ZeroCockpit/Theme.swift`. Sandbox + contextIsolation on;
   the renderer never touches Node, sockets, or child processes. All views
   speak only to the typed preload API.
2. **Preload** — `contextBridge` exposing `window.zero.*`: `snapshot()`,
   `stream(cb)`, action calls (session, approvals, integrations, Codex/OpenCode
   send), prefs read/write, wallpaper pick dialog.
3. **Main process** (TypeScript) owns everything native:
   - `UnixSocketClient`: `GET /v0.1/cockpit` and SSE `/v0.1/cockpit/stream`
     over the owner Unix socket (`~/Library/Application Support/
     ProjectZero/zero.sock`) via Node `http.request({ socketPath })`.
   - `CockpitModel`: TS port of the Swift `CockpitModel` semantics — SSE epoch
     and freshness fencing, causal delivery baselines, serialized retry,
     keepalive/staleness → `LIVE / STALE / RECONNECTING`.
   - `CodexAppServer` and `OpenCodeACP` bridges: `child_process.spawn` stdio
     JSON-RPC, manual connect, strict harness lock — same rules as the Swift
     bridge; send honestly blocked until the runtime path exists.
   - `PrefsStore`: layout/wallpaper/desktop-items persistence (see §6).
   - Tray companion (compact: runtime/focus/delivery only — later task).

Tooling: electron-vite scaffold; packaging with electron-builder; codesigning
with the existing **Project Zero Local Release** identity at packaging time.

Key decision: all I/O lives in main; the renderer is a pure view. This makes
the model unit-testable (Vitest with a fake socket) and keeps security posture
simple.

## 4. Desktop canvas

The whole Electron window is a desktop. Layers bottom → top:

1. **Wallpaper** — bundled wallpapers rendered from the Stitch palette
   (muted-green dotted, cream, canvas-tan) plus custom image via file dialog,
   cover/tile modes, persisted.
2. **Desktop items** — freely placeable icon grid, positions persisted:
   - six route app icons (Desk, Runtime, Network, Flight Recorder, Airlock,
     Zero Bot); double-click opens the route window; running apps show an
     indicator dot;
   - seeded **dummy files** (text, image, PDF mock, notes) from
     `desktop-items.json`; double-click opens an in-app viewer window. No real
     filesystem reads.
3. **Windows** — react-rnd cards:
   - free drag by header, 8-handle resize; live preview is transform-only
     (route content laid out at committed size; one relayout on release —
     the same model that fixed the SwiftUI resize CPU bursts);
   - traffic-light close/min/max chrome; click-to-front; rect per route
     persisted;
   - one-time layout seed on first launch spreads window positions (ported
     migration logic; own namespace, never touches the SwiftUI defaults).
4. **Taskbar strip** along the bottom edge: open windows, click focuses or
   restores.

Performance rule: memoized route components and Zustand sliced selectors so an
SSE tick does not re-render unrelated windows. Target: <10% idle CPU with two
windows open (the same bar the Swift app was measured against).

## 5. Data flow

Direction of truth: daemon → main → renderer. The UI never writes runtime
state directly; actions go through typed IPC validated in main.

- Main pushes a full snapshot on connect plus deltas on `runtime.changed`;
  the renderer slices per route so unrelated updates do not re-render windows.
- Actions (pause/resume, approval confirm/deny with exact-ID authority,
  integrations, Codex/OpenCode send) call `window.zero.action(...)`; main
  performs the socket/stdio call and pushes results back.
- Staleness: SSE epoch + freshness timestamps drive a `LIVE / STALE /
  RECONNECTING` badge on every route — identical semantics to the Swift
  `UnixEventStream`.

## 6. Persistence

- **Daemon DB (untouched):** sessions, focus, projects, audit, approvals,
  nodes — all runtime state stays in `zero.db`.
- **PrefsStore** (`~/Library/Application Support/ProjectZero/desktop-electron/
  prefs.json`): window rects per route, desktop icon positions, wallpaper
  choice/mode, seeded dummy files, Codex/OpenCode connection prefs, and a
  desktop layout version under the `desktop-electron/` namespace — it never
  touches the daemon's defaults or DB namespaces.
- **One-time seed:** first launch writes prefs with spread window positions
  and the default icon grid (ported from `DesktopWindows.swift` migration
  logic, covered by tests).

## 7. Error handling

- **Daemon unreachable:** model enters `RECONNECTING` with serialized
  exponential backoff; full-canvas "Runtime unavailable — reconnecting" slate;
  windows keep the last snapshot grayed with a `STALE` badge.
- **SSE drop:** reconnect refetches the snapshot first, then resubscribes.
- **Codex/OpenCode process death:** bridge emits `disconnected`; Zero Bot
  shows disconnected state; manual reconnect only.
- **Malformed records:** typed parse at the main boundary; malformed records
  are logged and dropped, never crash renderer state.
- **prefs.json corruption:** version-checked; on parse failure the file is
  quarantined and defaults reseeded (cosmetics lost, runtime state unaffected).

## 8. Testing

- **Vitest** (main + shared model): CockpitModel epoch/freshness fencing with
  a fake socket stream; layout seeding/migration; 8-handle resize rect math
  (leading/top inversion, anchor math); `elapsed` H:MM:SS format port;
  PrefsStore round-trip and corruption quarantine.
- **Playwright (Electron driver):** open a route from a desktop icon, drag and
  resize a window, change wallpaper and verify persistence, open a dummy file
  viewer.
- **Owner-verify gates:** drag/resize feel, visual match against the Stitch
  PNGs, idle CPU with two windows.

## 9. Process

Executed via subagent-driven-development (one subagent per task, sequential,
per-task scoped review, ledger under `.superpowers/sdd/2026-09-11-electron-port/`).
Rough task order: scaffold → tokens/theme → socket client + model (TDD) → IPC
contract → desktop canvas → route windows (≤2 lanes parallel) → desktop
items/files → wallpaper/settings → Codex/OpenCode bridges → tray → packaging
(codesign) → Playwright pass.

Boundaries (unchanged from AGENTS.md): no second production daemon, no
database switch, no production install until owner acceptance, one agent in
the current task unless subagent dispatch is explicitly approved (it is, for
this effort, per the owner's "subagent use is primary").
