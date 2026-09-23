# Zero Bot Reliability and UI Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task in the current task with one agent. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents; Project Zero's working agreement requires one agent.

**Goal:** Make Codex and OpenCode conversations reliably send, read, select models and present long transcripts without visual overload.

**Architecture:** Keep main-process provider dispatch and Airlock as the sole send boundary. Add typed, redacted failure evidence and provider-derived usage; make the renderer a projection of verified provider state. Create local composer drafts and compact display groups without altering stored provider transcripts.

**Tech Stack:** Electron, React, TypeScript, Vitest, Codex app-server, OpenCode ACP.

**Spec:** `docs/superpowers/specs/2026-09-23-zero-desktop-recovery-design.md`

## Global Constraints

- Work in the isolated canonical app worktree; preserve original dirty checkout and both data profiles.
- No provider prompt during automated tests; use fake bridges. A live test turn requires the approved execution and a disclosed destination.
- Airlock remains on every provider send. Never log prompt text, scan hits, token contents or raw provider stderr.
- Network and Flight Recorder are outside this plan.
- Preserve reduced-motion support and existing light/dark preference.

## Review Focus

- A Codex thread whose cwd exists but is absent from daemon project list: show the true destination and either allow the verified cwd or give an actionable block. Test in Task 1.
- Provider accepts a turn, then the renderer changes thread or text: never clear the newer draft or claim that newer text was sent. Test in Task 1.
- OpenCode advertises no models or rejects the selected model: disable send with a useful reason, preserve draft, and do not create an empty session. Test in Task 2.
- Consecutive empty reasoning items around a tool call: collapse only contiguous reasoning and preserve tool ordering. Test in Task 3.
- Usage notification for another thread or incomplete fields: do not display it as selected-thread totals or a monetary cost. Test in Task 4.

---

### Task 1: Diagnose and repair the blocked send path

**Files:** Modify `apps/desktop/src/main/prompt-gateway.ts`, `provider-dispatch.ts`, `ipc.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx`; test `prompt-gateway.test.ts`, `provider-dispatch.test.ts`, `zeroBotRoute.test.tsx`.

**Interfaces:** Keep `prompt.submit` and `prompt.decide`; return a bounded `{state:'blocked', reason:<known code>}` to the renderer. Add a main-only diagnostic callback with destination IDs hashed or truncated and stage codes, never text.

- [x] **Step 1: Reproduce.** Capture selected provider, model, thread ID, resolved cwd, bridge state and gateway stage for the reported scenario with a fake bridge. Check current dev socket absence separately with `test -S "$HOME/Library/Application Support/ProjectZero/dev-electron/zero.sock"`; no provider message is sent.
- [x] **Step 2: Add failing tests.** Assert that the exact blocked reason reaches an actionable UI notice, the draft remains, the expected provider method is or is not called, and a cwd-derived thread works without a daemon only if its path and identity are verified. Include stale edit/thread changes and scanner failure.
- [x] **Step 3: Implement one confirmed root-cause fix.** Make the smallest dispatch/binding change justified by the reproduction. Replace the generic renderer fallback with mapped reason copy. Avoid revealing provider error text in UI or logs.
- [x] **Step 4: Verify.** Run targeted Vitest and `npm run typecheck`; then, during approved execution, send a deliberately harmless explicit prompt to a disclosed existing thread, confirm a returned turn ID and visible response, and check the actual Airlock hold path once.
- [x] **Step 5: Commit** only the task files with a focused message and record observed provider/hardware limits in snapshot and handoff.

### Task 2: Provider session and model lifecycle

**Files:** Modify `apps/desktop/src/main/ipc.ts`, `provider-dispatch.ts`, `opencode-sessions.ts`, `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx`, `chat.model.ts`; test matching `ipc.test.ts`, `provider-dispatch.test.ts`, `opencode-sessions.test.ts`, `zeroBotRoute.test.tsx`.

**Interfaces:** Introduce a renderer-only draft `{provider,cwd,model,text}` with no provider ID. On first send, main creates the provider session, then dispatches through the same Airlock binding; return `{threadId,turnId}` after acceptance. Main advertises model options and the selected current model for the active session.

- [x] **Step 1: Verify the installed protocol.** With read-only requests, inspect OpenCode `session/load` `configOptions` and Codex `model/list`/thread metadata against installed versions; refresh Context7 first if its OAuth is fixed. Record exact shapes in tests, not assumptions from old ACP docs.
- [x] **Step 2: Add failing tests.** `New conversation` opens a local draft without `session/new` or `thread/start`; first accepted send creates one provider ID; cancelled/blocked Airlock creates none; no advertised model leaves send disabled with draft intact; stale session response cannot overwrite the current selector.
- [x] **Step 3: Implement creation at the first accepted send.** Keep scan before session creation. If creation succeeds but prompt dispatch fails, show the actual created session as recoverable without duplicating IDs on retry. Persist no empty local history row.
- [x] **Step 4: Refresh model choices and labels.** Render only the active provider's advertised options, show unavailable selection explicitly, derive a friendly untitled label from the first user message when the provider title is generic, and demote timestamps to secondary text.
- [x] **Step 5: Verify** fake-bridge lifecycle, saved-session read, empty legacy session behavior, typecheck and full desktop suite; commit the focused change.

### Task 3: Conversation typography, reasoning and terminal presentation

**Files:** Modify `apps/desktop/src/renderer/src/routes/ZeroBotChat.tsx`, `ZeroBotRoute.tsx`, `chat.model.ts`, `zeroBot.presentation.ts`, `apps/desktop/src/renderer/src/theme.css`, `apps/desktop/src/shared/tokens.ts`; test `ZeroBotChat.test.tsx`, `chat.model.test.ts`, `zeroBot.presentation.test.ts`, `zeroBotRoute.test.tsx`.

**Interfaces:** Add pure `groupVisibleItems(items: ChatItem[]): DisplayItem[]`, where a reasoning group contains only consecutive reasoning items and retains their original IDs/content for expansion.

- [x] **Step 1: Add failing display tests.** Input `[reasoning empty, reasoning summary, tool, reasoning empty, message]` yields one compact reasoning disclosure before the tool, no useless empty disclosure after it, and unchanged tool/message order. Assert keyboard activation, `aria-expanded`, and no raw hidden content in collapsed DOM.
- [x] **Step 2: Implement the grouping and render.** Use a small borderless inline accordion; show available provider summary, otherwise a neutral count while active, and never claim thoughts that were withheld. Render opened shell commands and output in a dark, selectable monospace terminal panel with bounded scroll, clear command/status separation and failure coloring.
- [x] **Step 3: Establish a readable type scale.** Use a dependable system font or bundled licensed face, reserve mono for code/IDs, raise small body text, use consistent line-height and whitespace, and shorten collapsed command labels without discarding details.
- [x] **Step 4: Add restrained state motion.** Animate accordion/inspector and new-item entry with stable layout, keep scrolling predictable, add `prefers-reduced-motion` coverage, and verify no perpetual animation while idle.
- [x] **Step 5: Review** long and short real-shaped fixtures at narrow/standard widths in light/dark modes; run targeted tests, typecheck and visual checks; commit.

### Task 4: Usage, cost and inspector hierarchy

**Files:** Modify `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx`, `opencodeTranscript.ts`, `runtime.types.ts`; create `apps/desktop/src/renderer/src/routes/providerUsage.ts`; test corresponding route/parser tests.

**Interfaces:** A thread-keyed `VerifiedUsage` carries source, timestamp, input, cached input, output, reasoning output, total and optional provider-reported cost. Unknown fields are `null`, never zero by default.

- [x] **Step 1: Add failing tests** for Codex `thread/tokenUsage/updated`, OpenCode saved usage, mismatched thread IDs, partial payloads and no-cost payloads. The selected thread alone can populate its inspector.
- [x] **Step 2: Parse and bind provider usage** from notifications and read responses where verified; on reconnect, label retained figures with age/source. Display cost only when explicitly provided; no local price table.
- [x] **Step 3: Reorder inspector.** Default it closed. Keep Calls by tool in its useful disclosure. Make Airlock a compact `Active`, `Held` or `Unavailable` state with history link. Put thread ID, timestamps, raw events and protocol notes under Details. Remove repeated explanatory paragraphs from the main view.
- [x] **Step 4: Verify** with fixture notifications, screen reader labels, light/dark visual review, targeted tests and full desktop suite; commit.

### Task 5: Collapsible project and folder navigation

**Files:** Modify `apps/desktop/src/renderer/src/routes/ZeroBotRoute.tsx`, `chat.model.ts`, `apps/desktop/src/renderer/src/theme.css`; test `zeroBotRoute.test.tsx`, `chat.model.test.ts`.

**Interfaces:** Group by verified registered project first, then provider cwd; OpenCode uses saved session directory. Expansion state is local UI state keyed by stable group ID.

- [x] **Step 1: Add failing tests** for nested worktree cwd, absent daemon registry, duplicate project names, selection surviving collapse, and zero-count groups.
- [x] **Step 2: Render accessible project/folder accordions** with counts and selected-thread visibility. Hide full paths behind a tooltip/details affordance and keep timestamps secondary. Do not infer parent folders by name alone.
- [x] **Step 3: Verify** keyboard operation, large fixture performance, narrow widths and full desktop suite; commit.

## Execution record — 2026-09-24

The five implementation tasks and their automated checks are complete. Playwright drove the actual Electron Zero Bot UI for one user-authorized Codex turn; the provider accepted it, ran two read-only checks, and returned a response. A synthetic credential-shaped draft triggered the real Airlock hold and was cancelled before provider dispatch. OpenCode saved transcript and usage reads work; this host did not advertise a live OpenCode model/session for a send test. Context7 documentation lookup returned an expired OAuth-token error. See [snapshot.md](../../../snapshot.md) for current limits and verification.
## Completion gate

Run `npm test`, `npm run typecheck`, changed-file lint and `npm run build:unpack` in the canonical worktree. Manually inspect light/dark screenshots and one approved real send per available provider. Record unavailable provider or daemon as an explicit limit, not a pass.
