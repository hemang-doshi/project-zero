# Project Zero Redesign Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a current, evidence-ranked repository audit and resource baseline before the redesign, then reconcile findings after implementation.

**Architecture:** Read-only inspection and isolated test/measurement runs. Findings live in one dated report; no adjacent production changes are smuggled into an audit task.

**Tech Stack:** Electron/React/TypeScript, Swift/SwiftUI, Go, ESP-IDF host fixtures, Git, macOS process tools.

**Spec:** `docs/superpowers/specs/2026-09-13-zero-desktop-redesign-design.md` (Repository-wide audit, Verification strategy).

## Global Constraints

- One agent in this task; no delegation. Preserve the dirty Swift/Go/docs lanes and do not stage them. No production install, daemon restart, provider turn, skill install, firmware flash, or work-Mac discovery.
- Before a diagnostic that could contact a live service, identify its target. Use isolated development data for active runtime tests. Read the installation/recovery runbooks before any later release operation.
- Report source, installed, wire, and migration versions separately; do not call a build or source test physical acceptance.
- Audit evidence must have an exact path/line or measured command/output, impact, severity, reproduction, and bounded remediation. Unknown payment plumbing is not invented.

## Review Focus

1. Existing dirty changes contaminating baseline or being overwritten.
2. A “read-only” test reaching production socket/database or spawning a provider turn.
3. Dependency advisory claims lacking a lockfile/version and reachable-path check.
4. CPU/WAL conclusions inferred from one stale process sample.
5. Cost/payment findings asserting a payment processor where none exists.

## File responsibilities

- `docs/evidence/2026-09-22-zero-redesign-audit.md`: current audit report, evidence table, baseline, post-change comparison, remediation backlog.
- `snapshot.md`, `handoff.md`: operational state and findings reconciliation, updated at task close.
- `apps/desktop/src/{main,preload,renderer,shared}`: Electron audit surface; `core/{api,runtime,storage}`: daemon surface; `apps/macos`, `nodes/esp32-desk`, `tools`: other audit surfaces. These are inspected, not edited by this plan.

## Task 1 — Freeze a reproducible baseline

- [ ] Record `git status --short --branch`, `git rev-parse HEAD`, manifest release fields, package lock versions, installed component versions, and the exact running processes in the report. Do not assume snapshot PIDs are still current.
- [ ] Identify test commands and their I/O targets before execution. Use `rg -n 'HOME|socket|zero.db|spawn|exec|fetch' apps/desktop/src core apps/macos/Tests` to flag accidental live dependencies.
- [ ] Run from `apps/desktop`: `npm test -- --run`, `npm run typecheck`, `npm run lint`, `npm run build`; record pass/fail counts and pre-existing warnings. Run `go test ./...` and `go test -race ./...` only with isolated environment/data proven by inspection; run Swift and firmware host checks only when their preflight confirms no live mutation.
- [ ] Record measured idle desktop/daemon CPU, RSS, helper count, database/WAL sizes, and a bounded active UI interaction using read-only tools. Include sampling interval and process identity, not just a screenshot.
- [ ] Verify: report contains exact HEAD, dirty-file inventory summary, versions, process targets, commands, and measurements; no source file changed. Commit only the new report if desired, with explicit path staging.

## Task 2 — Review architecture and high-risk boundaries

- [ ] Trace every renderer IPC op from `apps/desktop/src/shared/ipc.ts` through `preload/index.ts` and `main/ipc.ts`; record who validates payloads, who can spawn a process, and whether a provider send can bypass Airlock.
- [ ] Trace `main/bridges.ts` lifecycle, cancellation, stdout/stderr handling, event retention and redaction; inspect `main/skills.ts`, `routes/skillPlugins.ts`, and any installer work for path and supply-chain boundaries.
- [ ] Inspect Electron window settings, origin navigation, external links, CSP, preload exposure, packaging/signing, persistence and update paths. Inspect native Swift duplication/product ownership and the Go daemon's queue, stream fan-out, integration cadence, storage/WAL maintenance, recovery, and release generation. Inspect firmware protocol/host fixtures without touching the board.
- [ ] Review user-visible responsive/accessibility behavior at compact/default/large sizes, keyboard-only operation, unknown usage/cost handling, and the absence or presence of a payment-processing subsystem.
- [ ] Write findings in the report using a fixed record shape: `severity | file:line | evidence/reproduction | impact | bounded fix | owner plan`. Distinguish confirmed defects, risks needing validation, and non-issues.
- [ ] Verify: every high/critical claim is independently reproducible from current HEAD or current measured state; each has a concrete owning redesign task or a separate follow-up. Do not alter product code in this task.

## Task 3 — Dependency and consumption review

- [ ] Inspect lockfiles, pinned toolchains, package scripts and external service calls. Run available advisory tooling only after checking it will not mutate files or send secrets. If network/advisory lookup is unavailable, say so; do not infer “no vulnerabilities.”
- [ ] Enumerate model/CLI/provider calls and polling timers; distinguish connected-idle, disconnected-idle, user-triggered calls, and automatic calls. Trace where usage and price originate. Document paths that could generate excess tokens, process spawns, network traffic, or database churn.
- [ ] Verify: report contains an explicit payment-flow conclusion based on searched code, and separate `usage`, `cost`, and `billing` fields rather than equating them.

## Task 4 — Reconcile after the three implementation plans

- [ ] After the desk/Zero Bot, Airlock/Inspector/voice, and Skills Lab plans are implemented, rerun the same commands, process measurements, and viewport checks against exact new HEAD. Preserve before/after data and note environmental differences.
- [ ] Re-test every high/critical finding, mark fixed/unfixed with evidence, and create a bounded remaining backlog. Do not silently refactor unrelated issues discovered here.
- [ ] Update `snapshot.md` and `handoff.md` with installed/source versions, dirty state, verification, live processes, unresolved physical failures, and the next owner decision.
- [ ] Verify: report has no unsupported “fully secure,” “payment fixed,” or “hardware accepted” claim. Commit report and handoff updates only by exact paths, leaving unrelated dirty work untouched.
