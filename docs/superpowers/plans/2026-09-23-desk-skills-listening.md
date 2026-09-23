# Desk Listening and Skills Lab Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` in one agent in the current task. Steps use checkbox (`- [ ]`) syntax. Do not dispatch subagents under the Project Zero working agreement.

**Goal:** Make Desk a real Spotify listening-session view and Skills Lab an honest, working discovery and reviewed learning surface with verified icons.

**Architecture:** Retain the daemon as owner of committed local state. A user-authorized Spotify adapter supplies playback metadata and optional history to a bounded listening-session reducer; the Desk renderer consumes its projection. Skills Lab distinguishes installed files, proposed learning drafts and installed approved skills, with explicit provenance for icons.

**Tech Stack:** Go runtime/API, native macOS Spotify adapter, Electron/React/TypeScript, SQLite, Vitest and Go tests.

**Spec:** `docs/superpowers/specs/2026-09-23-zero-desktop-recovery-design.md`

## Global Constraints

- Do not modify ESP32 firmware or claim physical delivery from a software preview. Read installation/recovery runbooks before any later deployment.
- No Spotify OAuth or playlist write until the user approves execution and explicitly authorizes the account connection/action.
- No automatic model calls, scheduled AI tasks or unreviewed skill installation. Bounded local history observation requires a visible user opt-in and must be reversible.
- Keep Network and Airlock behavior unchanged; the Desk page may link to their status.

## Review Focus

- Spotify pauses for a long time then resumes the same track: do not falsely merge sessions without a documented gap rule. Test in Task 1.
- A playlist/radio source changes or is unavailable: show observed context and offer creation only for eligible sessions. Test in Task 2.
- Spotify recent history returns tracks from before local observation began: label source and avoid presenting them as witnessed in this session. Test in Task 2.
- A proposed skill contains a symlink, secret, or duplicate installed name: reject or require review without overwriting existing files. Test in Task 3.
- Official brand artwork cannot be verified or disappears offline: show a neutral unknown state, never a false logo. Test in Task 4.

---

### Task 1: Listening session state and Desk composition

**Files:** Modify `core/runtime/integrations.go`, `core/api` cockpit snapshot projection, `apps/desktop/src/renderer/src/routes/DeskRoute.tsx`, `runtime.types.ts`; create focused runtime session reducer and tests in `core/runtime` and `apps/desktop/src/renderer/src/routes/desk.model.test.ts`.

**Interfaces:** Project a bounded `ListeningSession` with ID, source, start, last observed, active duration, playback state, context type/URI and ordered track observations. Timestamps are local observed evidence; paused time is excluded from active duration.

- [x] **Step 1: Inspect the configured Spotify observer and isolated test DB.** Confirm which fields exist today and whether a playlist context URI or track URI is available. Record the exact session-boundary rule before coding: start on a playing transition; pause does not advance active duration; end after an explicit stop or a documented inactivity gap; resume after the gap creates a new session.
- [x] **Step 2: Add failing reducer tests** for play/pause/resume, track repeat, out-of-order observation, daemon restart, no observer, and source change. Assert stable order and bounded history.
- [x] **Step 3: Implement and project measured session state** in the daemon using isolated development data. Preserve existing artwork/audio fields and avoid altering display firmware transport.
- [x] **Step 4: Recompose Desk** around current track, active session clock, source context and a compact track timeline. Remove the virtual display mockup from the primary page; expose physical display state only as a small status/link with `unverified` wording when no real test exists.
- [x] **Step 5: Verify** Go tests, route tests, dev preview with fixture playback, and the unavailable state with no daemon. Record that ESP32 delivery remains physically unproven; commit.

### Task 2: Spotify history and explicit playlist creation

**Files:** Modify or add a bounded Spotify OAuth adapter under the existing native/helper integration, its Go integration boundary, typed IPC and `DeskRoute.tsx`; test adapter, runtime reducer and route behavior.

**Interfaces:** Separate `ObservedTracks` from `RecentlyPlayedTracks`; include URI, played-at and source. `CreatePlaylistRequest` contains a reviewed name, privacy choice and exact ordered track URIs; only a final button click sends it.

- [ ] **Step 1: Verify current official Spotify endpoints/scopes** at execution time. Current docs list currently playing, recently played, `POST /me/playlists`, and `POST /playlists/{id}/items`; the older `/tracks` add endpoint is deprecated. Confirm OAuth PKCE, rate-limit and account eligibility details before coding.
- [ ] **Step 2: Add failing tests** for dedupe/order, unavailable or local-file URIs, 401/403/429, interrupted create/add sequence, and explicit user cancellation. An ineligible or already-playlist-backed session must not silently create a new playlist.
- [ ] **Step 3: Implement user-initiated OAuth and bounded reads** with credentials stored in the existing secure local pattern; request only required read scopes. Keep local observed history separate from remote recently-played data and label the distinction in UI.
- [ ] **Step 4: Implement the write path** only behind a review sheet listing exact tracks, playlist name and private/public status; request modify scope when the user proceeds. Use idempotent local operation tracking so a retry after an uncertain network result does not duplicate a playlist without checking.
- [ ] **Step 5: Verify** with adapter fixtures, a user-authorized real account check, no automatic network mutation, and route tests; commit. If OAuth/client registration is unavailable, leave the write action disabled with a specific setup state and record the gate.

### Task 3: Real self-learned skill lifecycle

**Files:** Modify `apps/desktop/src/main/skills.ts`, `skill-stager.ts`, `apps/desktop/src/renderer/src/routes/SkillLabRoute.tsx`, `skillPlugins.ts`; create a small learner proposal store and tests under `apps/desktop/src/main`.

**Interfaces:** `SkillProposal` includes bounded source references, repeated-workflow evidence, draft SKILL.md, creation time and review status. A saved `learningEnabled` preference gates read-only observation of recent provider history while the app is open. Only approved proposals become installed files in the declared learned-skills root; discovery reads them as `self-learnt`.

- [x] **Step 1: Inventory only explicit existing skill roots and prior `Debug Zero` references.** Confirm whether any actual file exists. Do not restore fixture labels as if they were learned output.
- [x] **Step 2: Add failing tests** for opt-in off by default, bounded read-only observation when on, repeated-workflow detection, proposal generation, restart persistence, review/edit/reject, duplicate names, path escape, symlinks/hardlinks, secret-like text and no unattended provider invocation.
- [x] **Step 3: Implement local learning proposals.** When enabled, read only the bounded recent Codex/OpenCode records already available to Zero while the app is open, extract repeated command/tool sequences deterministically, and create a candidate with source references. Also offer “Propose skill from this work” for explicit selection. If a later approved design includes model-assisted drafting, show the provider and exact destination before a call. Stage safely and use the existing validator before install.
- [x] **Step 4: Add review and approval UI** with source/provenance, editable draft, conflict warning and rollback. Only an approved installation writes a learned skill and causes discovery to show it. Make installed/proposed states visually distinct.
- [ ] **Step 5: Verify** isolated filesystem tests and a manual demo using a synthetic conversation; do not run on private production history during development. Commit.

### Task 4: Verified skill and plugin artwork

**Files:** Modify `apps/desktop/src/renderer/src/routes/SkillLabRoute.tsx`, `SkillLabScene.tsx`, `skillWall.ts`, `skillPlugins.ts`; create a curated local asset manifest and provenance notes under `apps/desktop/src/renderer/src/assets/skill-brands`; test manifest/discovery/rendering.

**Interfaces:** `BrandAsset` maps an exact plugin/package identity to asset path, source URL, license/permission and verified date. Unknown identity returns `null`; UI displays a neutral unknown marker with its name, not an invented brand.

- [x] **Step 1: Inventory displayed plugin identities and official icon availability.** Prefer icon references shipped by the plugin itself; for downloaded artwork, verify it from the owner’s official source and record license/provenance. Do not fetch images at runtime.
- [x] **Step 2: Add failing tests** for exact-match mapping, package rename, missing image, invalid path, unknown identity and offline rendering.
- [x] **Step 3: Replace generic brand glyphs where verified assets exist.** Keep skill-specific frontmatter icons only when they are valid text/icon references and are not being mistaken for a plugin brand. Unknown remains explicit.
- [x] **Step 4: Verify** visual size/contrast in both themes, legal/provenance notes and desktop tests; commit.

## Execution record — 2026-09-24

The listening-session projection and Desk redesign are implemented and covered by Go and Electron tests. Playwright verified the actual no-daemon state: no Spotify playback is claimed, and the physical display is not represented as connected. Task 2 remains gated: there is no registered Spotify client or account authorization on this Mac. The UI keeps playlist creation disabled and explains that account connection is required. Self-learning is opt-in and persisted; the isolated preview currently has learning disabled, so this verification did not create, approve, or install a skill. The interactive synthetic-proposal demo remains unverified.
## Completion gate

Run relevant Go tests, Electron full suite, typecheck, lint and packaged preview. Inspect real Spotify data only after connection consent. Physical ESP32 acceptance requires a later measured test with the device online; otherwise report the limitation.
