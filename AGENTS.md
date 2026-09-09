# AGENTS.md

Behavioral guidelines to reduce common coding-agent mistakes.

Base: [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills/tree/2c606141936f1eeef17fa3043a72095b4765b9c2), community guidance derived from Andrej Karpathy’s observations; upstream README declares MIT. Adapted for this repository.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project Zero working agreement

- First read [snapshot.md](snapshot.md), then [handoff.md](handoff.md). The snapshot is the current operational state; the handoff explains decisions, architecture, evidence and unfinished work. Neither authorizes resuming a stopped task.
- **Every agent must update both documents before ending substantive work or handing off.** Update the snapshot’s timestamp, branch/commit context, dirty work, installed versions, verification, running processes and next step. Reconcile the handoff’s decisions, blockers, evidence and recovery instructions. Replace stale claims; do not append a conversation transcript. Even a review-only task should record its material findings or that no state changed.
- Keep this file short and durable. Put implementation details, commands, incident history and transient status in the two documents or linked runbooks.
- Zero is a deterministic, local-first personal runtime. The daemon owns committed state; the menu and desk display reflect it. Keep integrations bounded and observational. Reliability, explicit authorization and explainable state matter more than additional features.
- Work on the personal Mac and explicitly registered repositories only. Do not scan the Developer folder or inspect/discover the work Mac. Times Gate is a read-only hardware/recovery reference unless the user asks otherwise.
- Use one agent in the current task; no delegation, new tasks, scheduled AI checks or automatic model calls unless newly authorized. The soak/evaluation time gates were waived. Use applicable Superpowers workflows, meaningful regression tests and measured physical checks; do not equate a build with hardware acceptance.
- Preserve existing work, production history, grants and paired keys. Use isolated development data. Never start a second production daemon, silently switch databases, erase provisioning, commit secrets/private flash backups, or replace the signing identity to bypass a prompt. Read the installation/recovery runbooks before deploying.
- Generate component versions from `core/release/manifest.json`; distinguish product/build, wire protocol and migration versions. Verify installed components, not only source metadata.
- For library/SDK/API specifics, fetch current official documentation with `ctx7`: resolve the library before querying docs; keep secrets out of queries. Existing local pinned source is useful corroboration. Report quota/lookup failures rather than guessing.
- Make routine reversible decisions within the approved scope. Do not repeatedly ask permission for already-authorized work. State real uncertainty and blockers plainly. Never report an unresolved physical failure as fixed.
