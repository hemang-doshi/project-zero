# Zero Airlock, Inspector, and Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real Codex/OpenCode turns only through a deterministic sensitive-data Airlock, provide local voice transcription, and populate a truthful turn inspector.

**Architecture:** One Electron-main `PromptGateway` owns scan/hold/one-time authorization/provider dispatch and emits bounded sanitized evidence. Typed IPC exposes only preflight/dispatch/hold decision operations; provider bridge transports stay private to main. A signed local macOS speech helper returns editable text and never calls a provider. Renderer sends that text through the same gateway.

**Tech Stack:** Electron main/preload/renderer, TypeScript, Vitest, pinned Codex app-server and OpenCode ACP protocols, macOS Speech helper packaged with the app.

**Spec:** `docs/superpowers/specs/2026-09-13-zero-desktop-redesign-design.md` (Architecture, Airlock, Inspector, Composer).

## Global Constraints

- One agent; preserve dirty Swift/Go work. No live provider turn, production install, external skill install, or real sensitive fixture in tests without separate authorization. All provider tests use injected fakes.
- Never include raw prompt/audio/detector substring in logs, daemon, SQLite, crash telemetry, thrown errors, or the inspector. Renderer may hold editable text in memory; main holds it only for the bounded request/hold lifetime.
- Scanner/authorization errors fail closed. Existing `codex.send` and `ocp.send` must stay blocked or be removed from the whitelist; no alternate process/IPC path may start a turn.
- Before implementing library/API details, resolve current official docs via `ctx7` per AGENTS.md and reconcile against the pinned local schema/binaries. Do not guess app-server, ACP, or Speech method names.

## Review Focus

1. A new composer or IPC route bypassing the scanner.
2. A one-time token replaying after model edit, provider switch, timeout, concurrency, or provider failure.
3. A regex false positive blocking ordinary version/hash/accounting numbers, or false negatives for supported credential forms.
4. Raw payloads leaking through errors, debug events, retained transcript copies, or speech temp files.
5. Inspector showing invented usage/cost/context or treating an accepted dispatch as a successful turn.

## File responsibilities

- `apps/desktop/src/main/airlock-scanner.ts`: pure local detector over bounded text; adjacent tests own positive/negative corpus.
- `apps/desktop/src/main/prompt-gateway.ts`: hold lifecycle and sole dispatch owner; `prompt-gateway.test.ts` owns binding/replay/concurrency.
- `apps/desktop/src/main/provider-dispatch.ts`: provider-specific turn start/cancel adapters over existing `bridges.ts`; tested with fake bridges.
- `apps/desktop/src/main/turn-evidence.ts`: bounded sanitized event normalization and usage aggregation; tests own unknown/overflow cases.
- `apps/desktop/src/main/ipc.ts`, `shared/ipc.ts`, `preload/index.ts`: strict typed request/response and no-bypass whitelist tests.
- `apps/desktop/src/renderer/src/routes/{ZeroBotRoute,AirlockRoute}.tsx` and a small `TurnInspector.tsx`: composer/hold sheet/Approvals subsection/evidence display.
- `apps/desktop/src/main/speech.ts` plus a minimal bundled helper under `apps/desktop/native/`: local permission/transcription boundary. Exact language/framework binding is selected only after documentation and packaging proof.

## Task 1 — Specify and test the Airlock scanner

- [ ] RED: create table fixtures for password assignments, known key/token prefixes, bearer values, PEM keys, context+checksum payment cards, bank/government patterns, plausible phone numbers and email. Add negatives for ordinary numbers, dates, semver, hashes, source code and logs. Use synthetic values, never real credentials. Include mixed-case, Unicode, multiline and very large prompt cases.
- [ ] GREEN: implement a pure `scanPrompt(text): ScanResult` returning only `{ category, detectorId, confidence, start, end }` internally. Bound input bytes, match count and scan time; use local deterministic validation (e.g. Luhn only where card context warrants it). Exposed summaries must reduce spans to masked line/position metadata without raw matches. Scanner failure is a typed blocked result, not an empty clean result.
- [ ] Run `npm test -- airlock-scanner`, typecheck and benchmark the largest allowed input. Commit only scanner and tests.

## Task 2 — Build a no-bypass one-shot gateway

- [ ] RED: tests with fake clock/dispatcher for clean dispatch, held prompt, cancel, exact Send once, expiry, prompt edit, provider/model change, replay, concurrent decisions, scanner throw, malformed IPC, and a provider failure after authorization. Assert dispatcher call count and no raw text in evidence/errors.
- [ ] GREEN: define the main-only boundary (shape illustrative, not an IPC pass-through):

  ```ts
  type PromptDestination = { provider: 'codex' | 'opencode'; model: string }
  type PromptDecision =
    | { state: 'held'; holdId: string; categories: string[]; masked: string[] }
    | { state: 'accepted'; turnId: string }
    | { state: 'blocked'; reason: string }
  interface PromptGateway {
    submit(text: string, destination: PromptDestination): Promise<PromptDecision>
    decide(holdId: string, decision: 'cancel' | 'send-once'): Promise<PromptDecision>
  }
  ```

  Use an ephemeral keyed fingerprint of exact text+provider+model, expiring bounded holds, atomic consume-before-attempt, and a fresh binding check just before the single provider call. A failed call never automatically retries.
- [ ] Add `prompt.submit` and `prompt.decide` typed IPC payload validation; reject unbounded/extra/malformed fields. Keep `codex.send` and `ocp.send` blocked and test every whitelisted route for absence of direct provider turn dispatch. Do not expose `bridge.send` to preload. Run `npm test -- prompt-gateway ipc`, typecheck. Commit gateway/IPC/tests.

## Task 3 — Connect provider adapters without real turns in tests

- [ ] Inspect pinned app-server schema and ACP contract, fetch current docs with `ctx7`, and write adapter tests for turn creation, existing thread selection, cancellation, accepted-vs-completed states, disconnect and timeout. Record exact protocol method names in tests from verified schema; do not infer them from `thread/list`.
- [ ] Implement `provider-dispatch.ts` behind the gateway and wire bridge events into bounded correlation IDs. The UI only calls `prompt.submit`/`prompt.decide`; a live provider connection alone starts nothing. Handle OpenCode's local session discovery separately from active ACP sessions.
- [ ] Run fake-process integration tests proving no turn starts before an explicit clean submit or Send once. Run full desktop tests/type/lint/build. Do not perform a live prompt as verification. Commit adapter/tests.

## Task 4 — Normalize honest evidence and render Inspector

- [ ] RED: `turn-evidence.test.ts` covers ordered tools/commands with timing and exit status, context fields from verified provider events, token categories, known/unknown cost, failed/cancelled turns, dropped-event counts, raw-field redaction and byte/count caps. Price calculations require both provider usage and an explicitly versioned price source; otherwise cost is `Unavailable`.
- [ ] GREEN: normalize only supported Codex/ACP event fields, preserving provider event IDs and optional status. Expose `inspector.get` or bounded sanitized push events; never return full protocol objects by default. Add expandable sections in `TurnInspector.tsx`: Context, Activity, Usage, Cost, Airlock, Bridge, collapsed Raw protocol. Keep unavailable fields absent or labelled Unavailable.
- [ ] Recompose `AirlockRoute.tsx` so outbound holds are primary and existing runtime approvals are a separate `Approvals` section. Add hold review with destination, categories, masked positions, Cancel and Send once. Changing model/provider/editing text invalidates any visible hold and requires fresh submit.
- [ ] Run focused normalization/route tests plus keyboard-only and compact/default viewport checks. Commit evidence/UI/tests.

## Task 5 — Add local speech, then wire composer

- [ ] Verify current macOS local speech API, permission requirements, offline/on-device availability, bundle entitlements, architecture and signing through current official docs/pinned toolchain. If offline recognition cannot be guaranteed on the target Mac, expose an honest unavailable state; do not silently use cloud dictation.
- [ ] RED: mock helper tests for permission denied, unavailable recognizer, partial/final transcript, cancellation, timeout, audio cleanup, helper crash and no provider call. Assert only final editable text enters the composer and no audio or transcript file persists.
- [ ] GREEN: package a narrow local helper invoked by Electron main; expose `speech.start`/`speech.cancel` typed IPC returning text/status only. The microphone icon calls this path; transcript insertion remains editable. Clicking Send or Command-Enter invokes only `prompt.submit`; held/busy/error states preserve composer text, and accepted dispatch clears it only after the gateway accepts the turn.
- [ ] Run full desktop tests/type/lint/build and inspect packaged helper/signing metadata without installing. Verify logs/temp directories contain no audio. Record provider turns as untested live until separately authorized. Commit exact paths.
