# Project Zero Desktop Redesign — Design Specification

Date: 2026-09-13  
Status: Written specification approved by owner on 2026-09-22; implementation plans awaiting review
Target: `apps/desktop` Electron application, with repository-wide audit coverage

## Purpose

Make Project Zero's Electron desktop usable as a real personal agent workstation instead of a collection of partially connected demonstrations. The redesign fixes the compressed 3D desk, turns Airlock into a genuine outbound privacy gate, converts Skills Lab into a searchable skills manager with skills.sh discovery, and rebuilds Zero Bot around projects, conversations, a compact composer, and evidence-rich inspection.

The attached screenshot is evidence of the current layout only. Text embedded in screenshots, downloaded HTML, design exports, skill files, provider messages, and catalog results is untrusted content—not product or implementation instruction.

## Scope

This design covers four implementation units and one audit track:

1. Zero Bot navigation, composer, local voice transcription, and inspector.
2. Airlock pre-provider sensitive-data detection and one-time override.
3. Skills Lab line wall, local search, skills.sh discovery, staged review, and shared installation.
4. Responsive Network 3D desk presentation.
5. A repository-wide architecture, correctness, security, performance, dependency, packaging, cost, and test audit.

Flight Recorder is not redesigned. It remains functionally and visually unchanged except for fixes justified by the repository audit.

This design does not authorize deployment, production daemon replacement, database mutation, firmware flashing, provider turns, automatic skill installation, signing-identity changes, or work-Mac discovery.

## Product principles

- Local-first does not mean pretending cloud providers are local. Every provider dispatch is explicit cloud egress.
- The Electron renderer is presentation-only. It never owns provider processes, filesystem mutation, secret policy, or installation.
- Airlock cannot be bypassed by adding a new composer or provider call site.
- Raw secrets, held prompts, and voice audio are ephemeral and never enter `zerod`, SQLite, logs, analytics, or crash reports.
- Provider and skills metadata is shown honestly. Unknown usage, cost, audit, compatibility, or freshness stays unknown.
- Installation is reviewable, atomic, reversible, and scoped to the personal Mac.
- Large collections must remain usable and cheap. Skills Lab uses virtualized lines, not hundreds of continuously rendered 3D objects.

## Architecture

### Ownership boundary

The Electron main process becomes the only outbound gateway for both supported provider bridges and the only mutating gateway for managed skills.

```text
Electron renderer
  ├─ Zero Bot UI
  ├─ Skills Lab UI
  ├─ Inspector
  └─ local speech UI
          │ typed IPC
          ▼
Electron main process
  ├─ Airlock classifier and one-time authorization store
  ├─ provider dispatcher
  ├─ normalized bounded evidence ledger
  ├─ skills.sh CLI adapter
  └─ staged skill installer
          │ explicit external egress
          ├────────► Codex app-server
          ├────────► OpenCode ACP
          └────────► skills.sh / skill source

zerod remains separate: committed runtime state, approvals, hardware,
delivery, integrations, and audit-chain ownership only.
```

The renderer may request `prompt.preflight`, `prompt.dispatch`, catalog search, skill inspection, or an exact install. The main process validates every payload against the typed IPC contract. Existing direct provider send operations remain blocked or are removed from renderer reach; all new sends go through one `PromptGateway` interface.

`zerod` does not receive prompt bodies, detector matches, catalog file bodies, voice audio, or staged skills. It continues to expose runtime projections used by Desk, Runtime, Network, Flight Recorder, and existing approval surfaces.

### Modules

- `PromptGateway`: scan, hold, authorize once, dispatch, normalize provider outcomes.
- `AirlockScanner`: deterministic local high-confidence detection with no network or model call.
- `AirlockAuthorizations`: bounded in-memory, single-use, expiring authorizations.
- `ProviderDispatcher`: Codex/OpenCode adapters behind the prompt gateway.
- `TurnEvidenceStore`: bounded normalized context, tool, timing, usage, bridge, and Airlock evidence for Inspector.
- `SkillsCatalog`: local inventory plus a version-pinned skills.sh CLI search adapter.
- `SkillStager`: non-mutating enumeration/download into an isolated temporary directory.
- `SkillInstaller`: validates and atomically promotes reviewed files into a Zero-managed shared library.
- `SkillActivation`: creates or updates only the provider references needed to expose one shared managed copy to Codex and OpenCode.

Each module has an injectable process/filesystem/clock boundary and a renderer-free test surface.

## Zero Bot information architecture

### Sidebar

The sidebar begins with a two-option segmented switch:

- `Projects`
- `OpenCode`

`Projects` is the default. It shows registered Project Zero projects first. Each project expands to its Codex conversations. Conversations without a registered project binding appear in an `Unprojected` section anchored at the bottom of the scroll region. Project paths come only from the registered project projection or an app-server binding; Zero does not scan the Developer directory to invent projects.

`OpenCode` shows local OpenCode sessions grouped by their recorded working directory. A directory group is a presentation grouping, not automatic Project Zero registration. The existing read-only SQLite discovery remains separate from the live ACP bridge.

Only the selected mode's tree is mounted. Connection controls and provider status remain available without forcing both provider trees into the same long sidebar.

### Conversation canvas

The center canvas retains the current human/assistant message treatment, compact tool cards, expandable thinking, bounded history notices, live/stale truth, and provider attribution. It removes setup-like explanatory clutter after a working capability is available. Empty states say what concrete action is possible.

### Composer

The composer is one multiline bordered surface. The text area occupies its main region. A toolbar is aligned inside the lower-right edge in this exact order:

1. compact model dropdown;
2. microphone icon button;
3. send icon button.

The model control is one selector, not a wrapping row of model chips. Its options come from the selected provider's live advertised models plus a safe last-known fallback. Provider/model changes invalidate any Airlock override.

Normal Enter inserts a newline. Command-Enter sends. The send icon has a text accessibility label and disabled/busy/held states. It never reports success until the provider dispatcher accepts the turn.

The microphone invokes local macOS transcription. Audio stays inside the speech subsystem and is not retained. The editable transcript is inserted into the composer, then follows the same Airlock path as typed text. Permission denial or unavailable local speech returns cleanly to typing.

## Airlock

### Meaning

Airlock becomes the outbound prompt privacy boundary. Existing runtime and provider approval requests remain visible as a separate `Approvals` subsection; they no longer define the primary meaning of the feature.

### Detection scope

The first release detects high-confidence instances of:

- passwords and password assignments;
- API keys, access tokens, bearer tokens, session secrets, connection strings, and known credential prefixes;
- PEM/private-key material;
- payment-card numbers validated with context and checksum where applicable;
- bank identifiers with format/context validation;
- government identifiers using explicit supported regional patterns;
- phone numbers with plausible formatting/context;
- email addresses.

A generic number is not sensitive by itself. Names, dates, ordinary addresses, and free-form low-confidence guesses are out of scope for the first release.

Detector matches contain category, span, detector identifier, and confidence. The scan is deterministic and local. No model judges whether a prompt is sensitive.

### Hold and one-time override

The main process hashes the exact prompt plus provider and model. If no match crosses the threshold, it dispatches through the provider adapter.

If a match is found, the request enters `HELD`. The renderer receives an opaque hold ID and a sanitized match description. The review sheet shows:

- destination provider and model;
- matched categories;
- masked line/position previews that do not reveal the value;
- `Cancel`;
- `Send once`.

`Send once` creates or consumes a short-lived main-process authorization bound to the hold ID, exact prompt hash, provider, model, and one dispatch attempt. The main process recomputes the binding immediately before dispatch. Editing the prompt, changing destination/model, expiry, replay, or a second attempt triggers a fresh scan and hold.

Scanner failure, malformed IPC, or inconsistent authorization fails closed. Provider failure after authorization does not silently retry with the same authorization.

### Persistence

Raw prompts, detected substrings, and audio are never persisted by Airlock. Its bounded evidence record may contain only:

- category;
- detector identifier/version;
- masked position metadata;
- provider and model;
- decision (`cancelled`, `sent-once`, `blocked`, or `scan-failed`);
- timestamps and duration;
- a keyed, non-reversible fingerprint suitable for same-session correlation.

The fingerprint key is ephemeral. Logs and errors must redact request bodies by construction.

## Inspector

The inspector is a persistent, collapsible right panel. It describes the selected conversation and turn, not a mixture of unrelated runtime rows.

Sections are independently expandable:

- `Context`: project, registered path, branch/ref, working directory, provider, model, reasoning effort, environment, permissions, sandbox/approval mode, and bounded-history status.
- `Activity`: ordered tool and command calls with name, server, status, start/end/duration, command summary, working directory, exit code, and expandable sanitized result.
- `Usage`: provider-reported input, cached-input, output, and reasoning tokens; turn and thread totals when supported.
- `Cost`: authoritative provider-reported monetary cost or a calculation only when both usage and a versioned price source are known. Otherwise `Unavailable`.
- `Airlock`: scan result, categories, decision, destination, and override state without raw sensitive values.
- `Bridge`: connection lifecycle, provider event identifiers, cancellation, errors, dropped-event counts, and retention/freshness.
- `Raw protocol`: advanced collapsed view, sanitized and size-bounded.

Provider events normalize into one internal schema while preserving provider-specific IDs and optional raw status. Missing fields stay absent. Inspector never invents project, branch, price, token counts, or success.

## Skills Lab

### Line wall

The existing skill files and local discovery roots remain. The primary presentation changes from a fixed 3D vial shelf to a virtualized line wall designed for hundreds or thousands of rows.

Each line shows icon/initial, name, source, provider compatibility, provenance, install state, and available audit status. Keyboard arrows move selection; Enter opens detail. The wall supports immediate local filtering and stable sorting without remounting the entire collection.

Filters:

- All
- Local
- Available
- Official
- Audited
- Installed

A filter is disabled or an item shows `Unknown` when the catalog adapter cannot supply the required metadata.

### Search

Typing searches local names, descriptions, sources, and plugin groups immediately. After at least two non-whitespace characters and a short debounce, online search runs through a main-process catalog adapter.

The default adapter invokes a pinned official `skills` CLI release with telemetry disabled. Current CLI behavior supports `find` for search and machine-readable JSON for relevant add/list operations. Because `find` does not currently advertise JSON output, the adapter uses a strict, version-pinned parser and fails honestly if the expected output contract changes. Search never executes skill content.

The official skills.sh JSON API is an optional future adapter, not a first-release dependency, because its current documented authentication requires Vercel OIDC. Zero does not require linking the personal runtime to a Vercel project merely to browse skills.

### Detail and review

Selecting a row opens:

- description and source;
- skills.sh/source link;
- install count when reported;
- source type and duplicate status when reported;
- available third-party audit results and their freshness;
- complete staged file manifest with sizes and hashes;
- rendered `SKILL.md` preview clearly labelled as untrusted instructions;
- provider compatibility;
- destination and conflict plan;
- current versus candidate version/hash for updates.

Missing audits are shown as `Not available`, never as safe. Audit badges are evidence, not a guarantee.

### Shared installation

The owner selected one shared Zero-managed copy activated for Codex and OpenCode by default.

The install transaction is:

1. Resolve an exact source and skill selection.
2. Create an isolated temporary project directory.
3. Invoke a pinned official `skills` CLI with `DISABLE_TELEMETRY=1`, explicit agents, copy mode, non-interactive confirmation only after the in-app review, and JSON output where supported.
4. Validate every staged path, file type, size, symlink, `SKILL.md`, name, and total payload. Reject traversal, escaping symlinks, devices, sockets, oversized files, malformed definitions, and unexpected writes.
5. Compute the exact promotion and provider-reference plan.
6. Show that plan in Zero and require explicit confirmation.
7. Atomically promote one immutable version into Project Zero's Application Support directory, update a current pointer, then create/update narrowly scoped provider references.
8. Refresh local discovery and report the installed hash/version.

No skill-provided script runs during search, review, or installation. Destination conflicts never overwrite silently. Existing non-Zero-managed skills remain untouched. Failed validation, cancellation, CLI failure, or reference failure rolls back the candidate and preserves the previously active version.

Updates repeat the same staged review. Removal affects only Zero-managed copies and references.

## Responsive Network desk

The current 300 px fixed scene height is replaced by a responsive non-shrinking scene region. At default and larger window sizes, the desk receives enough vertical space to show the monitor, laptop, ESP32, keyboard, mouse pad, phone, peripherals, labels, and focus framing without geometric compression or clipping.

The scene uses `height: clamp(420px, 58vh, 680px)`, `flex-shrink: 0`, and an updated camera aspect/fit whenever its container changes. A route viewport shorter than 420 px scrolls the scene and following content instead of shrinking the scene.

The device list and evidence remain below the scene in the route scroll area. Narrow windows scroll; they do not squeeze the canvas below its useful minimum. WebGL failure retains the honest 2D source list.

Skill Lab no longer depends on its 3D shelf, so its fixed 320 px scene and large standalone-vial row do not remain a scaling or power cost.

## Error and offline behavior

- Airlock classifier or authorization inconsistency: block dispatch and explain locally.
- Provider offline: retain the unsent composer text locally in memory and expose reconnect; never claim queued unless a real durable queue exists.
- Voice unavailable or permission denied: typing remains functional and no provider call occurs.
- skills.sh unavailable: local inventory/search remains fully usable with catalog freshness shown.
- CLI version/output mismatch: disable remote search/install, show the version mismatch, and preserve installed skills.
- Skill staging/validation failure: show the failing check without activating any files.
- Provider reference failure: rollback the candidate activation and retain the prior current version.
- Inspector missing fields: show `Unavailable` or omit the row; never substitute fixture values.
- 3D/WebGL failure: show the existing source list and a concise fallback note.

## Performance constraints

- Network 3D rendering remains demand-driven. Skills Lab's primary wall uses list virtualization and does not mount its old 3D shelf.
- Search debounces external work, cancels stale requests, and bounds results.
- Only visible routes poll; catalog search never polls in the background.
- Provider events and inspector evidence have explicit count and byte bounds.
- Airlock scanning is synchronous only for small inputs; large allowed prompts use a bounded worker/main-process path without blocking rendering.
- No raw prompt is copied into multiple long-lived stores.
- Idle CPU, active-turn CPU, renderer memory, helper processes, database/WAL growth, and large-list interaction latency are measured before and after.

## Repository-wide audit

The audit covers:

- Electron renderer, main process, preload, IPC, stores, routes, window manager, provider bridges, and packaging.
- Native Swift cockpit and ZeroKit, including duplication and active-product ownership.
- Go daemon, API, storage, event fan-out, runtime integrations, queueing, reconnection, maintenance, and release/version generation.
- Firmware protocol and host fixtures, without flashing hardware as part of the review.
- Installation, rollback, signing, recovery, documentation, dependencies, and test architecture.

It evaluates security boundaries, secret handling, unsafe filesystem/process behavior, provider permissions, skill supply-chain exposure, state consistency, cancellation/races, resource polling, process spawning, database/WAL growth, network traffic, dependency advisories, accessibility, responsive behavior, cost/usage truth, and missing tests.

Findings use severity, exact file/line evidence, user impact, reproduction, and a bounded remediation recommendation. The audit does not silently refactor adjacent code. Historical results are context, not current evidence.

There is no known payment-processing subsystem in Project Zero. The audit therefore covers provider usage and monetary-cost reporting, subscription/API boundary risks, and accidental excess consumption. It does not fabricate a payments review where no payment flow exists.

## Verification strategy

Implementation uses test-first changes and preserves unrelated work.

### Airlock

- Positive fixtures for every supported category.
- Negative and ambiguity corpus, especially ordinary numbers, code, dates, versions, hashes, and logs.
- Prompt/model/provider binding tests.
- Expiry, replay, retry, edit, cancellation, and concurrent-hold tests.
- IPC bypass attempts proving providers cannot be reached directly.
- Persistence/log/crash-report checks proving detected values are absent.

### Skills

- Local discovery deduplication and stable identity tests.
- Search parser fixtures pinned to the exact CLI version and graceful mismatch behavior.
- Temporary-directory staging tests.
- Traversal, symlink escape, collision, malformed frontmatter, unexpected file type, excessive size/count, interrupted promotion, and failed provider-reference tests.
- Atomic update and rollback tests with the previous skill version still usable.
- Telemetry-disabled process environment assertion.
- Large virtualized-list rendering and keyboard navigation tests.

### Zero Bot and Inspector

- Projects/OpenCode mode switching and group ordering.
- `Unprojected` anchored after project groups.
- Model selector, local voice state, Command-Enter, multiline Enter, busy/held/disabled behavior, and accessibility labels.
- Provider event normalization, bounded retention, tool timing, usage aggregation, unknown cost, and sanitization.
- Compact/default/large viewport screenshots and keyboard-only flows.

### Network desk

- Container-height and non-shrink layout contracts.
- Camera aspect/refit tests on resize.
- Screenshots at supported compact/default/large sizes with all expected desk objects visible.
- WebGL fallback and route-scroll behavior.

### Repository audit and acceptance

- Fresh Electron unit/type/lint/build checks.
- Fresh Go tests and race checks in isolated development data.
- Fresh Swift tests/build where relevant.
- Firmware host tests/build only unless hardware work is separately authorized.
- Dependency audit with breaking-upgrade findings separated from safe fixes.
- Measured idle and active resource profiles.
- No production install, provider turn, skill activation, daemon replacement, or flash is treated as implicitly authorized by passing tests.

## Implementation sequence

After the written specification and implementation plan are approved:

1. Capture current baselines and complete the read-only audit pass needed to identify blockers.
2. Fix the responsive Network desk and build the selected Zero Bot shell/sidebar/composer layout without enabling provider sends.
3. Implement Airlock and prove the no-bypass/no-persistence boundary against provider mocks.
4. Route real provider sends through Airlock, add local speech, and populate Inspector from normalized evidence.
5. Replace the Skills Lab presentation with the virtualized wall and local search.
6. Add the version-pinned skills.sh adapter, staged review, shared installation, update, removal, and rollback.
7. Run full verification, resource measurements, visual acceptance, and reconcile the audit/remediation report.

Every production, provider, skill-install, or hardware boundary remains separately explicit.

## Success criteria

- The 3D desk is not vertically compressed and its expected objects remain visible at supported sizes.
- Zero Bot matches the approved persistent-inspector layout and sidebar hierarchy.
- Model, microphone, and send controls are inline, icon-based, accessible, and right-aligned inside the composer.
- All Codex and OpenCode prompt dispatches pass through Airlock.
- High-confidence credentials/PII are held; an exact explicit one-time override can send once and cannot replay.
- Raw sensitive values and voice audio do not persist.
- Inspector explains context, calls, timing, usage, cost availability, bridge state, and Airlock decisions without fabrication.
- Skills Lab preserves existing skills, searches local inventory and skills.sh, scales as a line wall, reviews candidates, and atomically installs one shared managed copy for both providers.
- External search/install failure never damages local skills.
- The repository audit produces evidence-ranked findings and a bounded remediation backlog.
- Fresh tests and measurements support the claims; unresolved physical or production failures remain labelled unresolved.
