# Zero Desk and Bot Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Network desk fully visible at supported window sizes and deliver the approved Zero Bot navigation/composer shell without enabling provider sends prematurely.

**Architecture:** Keep the Network scene demand-driven; make its container non-shrinking and refit the perspective camera on size changes. Zero Bot reads registered projects through the existing daemon API, groups Codex threads by trustworthy bindings, and switches between Codex Projects and local OpenCode directory groups. Composer stays renderer presentation until the Airlock plan supplies a send gateway.

**Tech Stack:** React 19, TypeScript, React Three Fiber 9, Electron typed IPC, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-zero-desktop-redesign-design.md` (Zero Bot information architecture, Responsive Network desk).

## Global Constraints

- One agent; preserve unrelated dirty lanes. No provider turn, skill installation, daemon mutation, app deployment, or hardware action in this plan.
- Project groups come only from `GET /v0.1/projects` and verified Codex thread bindings, never a filesystem scan. Unknown bindings go to `Unprojected`; OpenCode folder groups never imply Project Zero registration.
- A blocked send remains visibly blocked until the gateway is proven in the separate Airlock plan. No fixture-derived success state.

## Review Focus

1. A scene that is 420px high but still clips the desk because the camera is not refit.
2. A route less than 420px tall shrinking the scene instead of scrolling it.
3. A guessed project association based on a similar directory name.
4. Both provider trees remaining mounted in the sidebar after switch.
5. Composer controls wrapping or implying that a disabled send succeeded.

## File responsibilities

- `apps/desktop/src/renderer/src/routes/TopologyScene.tsx`: scene height, measured aspect, camera fit, WebGL fallback.
- `apps/desktop/src/renderer/src/routes/NetworkRoute.tsx`: scroll container and devices/evidence below scene.
- `apps/desktop/src/main/ipc.ts` and `apps/desktop/src/shared/ipc.ts`: read-only `projects.list` contract backed by the existing daemon endpoint.
- `apps/desktop/src/renderer/src/routes/chat.model.ts`: pure project/thread grouping with stable sort and Unprojected bucket.
- `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx` and `ZeroBotChat.tsx`: segmented sidebar and inline composer surface. Existing event retention and transcript behavior stay intact.
- Adjacent `*.test.ts(x)` files own regression tests. Add an e2e viewport spec under `apps/desktop/tests/` only after inspecting current Playwright layout.

## Task 1 — Fix scene layout and camera

- [ ] RED: in `topologyScene.test.tsx` and `networkRoute.test.tsx`, assert scene contract `height: clamp(420px, 58vh, 680px)`, `flexShrink: 0`, route scroll, and intact 2D fallback. Add a camera refit unit around the camera-fit helper with compact/wide aspect inputs; assert all scene object bounds are in frame.
- [ ] GREEN: replace `sceneWrap.height = 300` in `TopologyScene.tsx` with the specified clamp and non-shrink style. Extract a small pure `fitDeskCamera(bounds, aspect)` helper only if needed to test fit; wire measured container aspect through React Three Fiber resize state and set camera position/FOV/target without resetting an active focus transition. Keep `frameloop` demand-driven.
- [ ] Run `npm test -- topologyScene networkRoute`, then typecheck. Capture real Chromium screenshots at compact/default/large window sizes; verify monitor, laptop, ESP32, keyboard, mouse pad, phone, peripherals and labels, plus scroll below scene. Record pixel sizes and any unavoidable compact scroll. Commit only scene, route, and their tests.

## Task 2 — Add trustworthy Projects projection

- [ ] RED: extend `main/ipc.test.ts` and `shared/ipc.test.ts` for `projects.list`; reject malformed response, preserve empty/unavailable state, and assert the call is the read-only `/v0.1/projects` endpoint. The daemon's current route is at `core/api/unix.go`; do not add a duplicate source of truth.
- [ ] GREEN: add `projects.list` to `OPS`; in `createDispatch`, return the validated bounded project projection from `deps.fetchSnapshot(deps.socketPath, { path: '/v0.1/projects' })`. Do not expose arbitrary path fetch to the renderer.
- [ ] RED: in `chat.model.test.ts`, cover registered project, missing/unknown binding, duplicate project display names, stable conversation recency, and `Unprojected` last. Resolve the actual thread metadata shape against the pinned local Codex schema before implementing binding extraction; an absent binding is not inferred from title or cwd.
- [ ] GREEN: implement a pure `groupThreadsByRegisteredProject(projects, threads)` result with `groups` and `unprojected`; return path/name only when present in the validated project projection. Keep `ThreadRow` backward-compatible. Run focused tests/typecheck; commit exact paths.

## Task 3 — Recompose the sidebar

- [ ] RED: in `zeroBotRoute.test.tsx`, assert top `Projects | OpenCode` segmented control, Projects default, only the active tree mounted, project groups before bottom-anchored `Unprojected`, and OpenCode groups from existing `ocp.discover` directory data. Test disconnected Codex with an honest empty state and OpenCode discovery without a connection.
- [ ] GREEN: replace the two concurrently rendered provider blocks in `ZeroBotRoute.tsx` with selected-mode conditional trees. Keep bridge controls in the sidebar footer independent of tree scroll; keep OpenCode rows labels until a real transcript API exists. Preserve `codex.thread.get` merge semantics and event subscriptions.
- [ ] Run focused tests and keyboard navigation in Chromium; verify no directory scan was added. Commit route/tests only.

## Task 4 — Inline the composer controls

- [ ] RED: assert one multiline bordered composer, compact model `<select>`, microphone icon, send icon in that order at lower right; labels, focus order, Enter newline, Command-Enter request behavior, busy/held/disabled presentation, and no text loss on provider disconnect. At this stage Command-Enter must remain blocked just like clicking Send.
- [ ] GREEN: replace model-chip wrapping row and the lower text-button row in `ZeroBotRoute.tsx`; use advertised model IDs when present and a safe last-known option when absent. Avoid a model switch silently changing provider. Keep the text in local component memory; expose a single callback seam for the later `prompt.dispatch` wiring, but do not call `codex.send`/`ocp.send`.
- [ ] Run `npm test -- zeroBotRoute zeroBot`, `npm run typecheck`, `npm run lint`. Take compact/default/large screenshots and keyboard-only checks. Commit only composer/test paths. Record the still-blocked send as intentional, not as feature completion.
