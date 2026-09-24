# Project Zero — Desktop Experience Refinement Specification

**Status:** Proposed
**Scope:** Project Zero Electron desktop shell and first-party applications
**Excluded:** 3D Network topology redesign
**Intent:** Refine the existing Project Zero visual system without replacing its identity.

---

# 1. Executive intent

Project Zero already has a strong visual foundation.

The current product successfully establishes:

- a desktop metaphor rather than a conventional web dashboard
- floating, overlapping application windows
- a warm, physical visual identity
- understated retro-computing influences
- visible system state
- applications with distinct responsibilities
- a local-computing feel despite integrating cloud AI providers

The next phase must **not redesign this foundation**.

The objective is to evolve Project Zero from:

> a technically impressive desktop-shaped engineering console

into:

> a coherent personal computing environment whose internal complexity is hidden until the user asks for it.

The refinement should primarily improve:

- information hierarchy
- readability
- responsive window behaviour
- interaction quality
- conversational AI experience
- cross-provider continuity
- privacy controls
- skill management
- event history
- visual consistency
- application semantics
- micro-interactions
- iconography
- settings
- progressive disclosure
- accessibility
- perceived quality

The product should feel **calm when nothing requires attention** and become technically detailed only when inspected.

---

# 2. Core product philosophy

Every UI decision should pass these principles.

## 2.1 Zero owns the experience

Codex, OpenCode and future providers are infrastructure.

They should not define the top-level UX.

The user interacts with **Project Zero**.

Project Zero determines which provider executes a task.

This distinction should be visible throughout the application.

---

## 2.2 Complexity should exist without dominating

Zero can expose enormous technical depth.

That does not mean every internal detail deserves permanent screen space.

Prefer:

**human interpretation → inspectable detail → raw technical evidence**

rather than:

**raw event → raw event → raw event**

For example:

Bad:

`entity.changed`
`entity.changed`
`entity.changed`

Better:

**Desk display disconnected**

Expandable:

> 17 underlying entity.changed events

---

## 2.3 Information should react, not scale

Window resizing must recompose information.

Content must never behave like a screenshot being stretched.

Typography does not shrink simply because a window becomes smaller.

Charts do not distort.

Cards reflow.

Secondary information collapses.

Dense views progressively simplify.

---

## 2.4 Zero must never pretend certainty it does not possess

If information is stale, partial, lower-bound, inferred or unavailable, say so.

Examples:

`Last seen 14:08`

`Context rebuilt from 14 messages and 6 files`

`3 tool events unavailable from previous provider`

This honesty should become part of Zero's personality.

---

## 2.5 Locality and trust should be understandable

The user should always be able to understand:

- what stays local
- what leaves the machine
- which provider receives it
- what Zero removed or transformed
- why something was blocked
- what permissions a skill possesses

This is especially important because Zero spans local software and cloud AI.

---

# 3. Overall information architecture

The first-party Zero environment should conceptually contain the following responsibilities.

| Surface | User question it answers |
|---|---|
| Desktop | What tools and objects exist in my Zero environment? |
| Desk | What is Zero currently doing? |
| Zero Bot | What do I want Zero to do? |
| Runtime | Is the machine/Zero runtime healthy? |
| Airlock | What information is allowed to leave my environment? |
| Skill Lab | What can Zero do and how can its capabilities evolve? |
| Flight Recorder | What happened and why? |
| Network | What systems are connected? |
| Settings | How should Zero behave? |

Every screen must remain faithful to its question.

If information does not help answer that question, move it elsewhere or place it under advanced inspection.

---

# 4. The desktop shell

This should receive significantly more attention than it currently does because every other application inherits its perceived quality.

## Current problem

The desktop metaphor already works visually, but some components still behave like styled web elements rather than operating-system objects.

In particular:

- icons have overly similar containers
- files and applications are visually conflated
- desktop labels can become hard to read over wallpaper
- active/inactive window states are subtle
- window resizing exposes web-layout artefacts
- the taskbar feels functional rather than intentionally designed
- settings currently feel like a wallpaper picker rather than system settings
- status pills appear in multiple places without a clear hierarchy

## Desired effect

The user should unconsciously accept the illusion:

> “This is an operating environment.”

Not:

> “This is an Electron page pretending to be a desktop.”

---

# 5. Window system

This should be the **highest-priority polish task**.

## 5.1 Live resizing

During pointer resize, application content must continuously reflow.

Do not wait until pointer release.

Recommended implementation behaviour:

- update window bounds continuously
- synchronize updates through `requestAnimationFrame`
- use `ResizeObserver` inside applications
- use container queries wherever appropriate
- debounce expensive calculations but not layout itself
- resize charts from parent bounds rather than CSS scaling rendered output

Expected result:

The user can drag a window edge slowly and see the application naturally reorganize itself.

---

## 5.2 Responsive states

Every first-party application should define explicit layout states.

For example:

### Wide

`> 1050px`

Multiple-column layouts.

### Standard

`700–1050px`

Primary content remains prominent while secondary metrics reposition.

### Compact

`480–700px`

Single-column layout.

### Minimum

Application-specific lower limit.

The UI should not attempt to display every piece of information at minimum width.

Instead it progressively removes secondary information.

---

## 5.3 Minimum dimensions

Each application must define:

- minimum width
- minimum height
- preferred initial width
- preferred initial height

For example:

Runtime should not become narrow enough that chart labels collide.

Zero Bot should retain enough width for conversation readability.

Skill Lab should not shrink its inspector below usable dimensions.

The window manager should enforce these constraints.

---

## 5.4 Active vs inactive windows

The focused window should be perceptually obvious without becoming flashy.

Use subtle combinations of:

- stronger shadow
- slightly stronger title text
- increased border contrast
- active traffic-light controls
- perhaps slightly higher background opacity

Inactive windows should not become illegible.

They should simply recede.

---

## 5.5 Window elevation

Define a deterministic elevation scale.

For example:

Desktop
→ normal window
→ focused window
→ popover
→ modal
→ system alert

Avoid arbitrary shadows per application.

Create shared shadow tokens.

---

## 5.6 Window movement

Dragging should feel physical.

Requirements:

- no visible lag
- no text selection while dragging
- drag cursor only where appropriate
- window remains completely interactive immediately after release
- positions persist between sessions
- windows cannot become permanently unreachable beyond screen bounds

Optional later enhancement:

subtle magnetic snapping near viewport edges.

---

## 5.7 Traffic-light controls

The red/yellow/green controls should have real semantics.

Red:
close

Yellow:
minimize

Green:
maximize/restore or controlled zoom

Their hit targets should be larger than the visible circles.

---

# 6. Typography

This is one of the largest remaining visual problems.

The current monospaced aesthetic gives Zero personality, but it is being used too broadly.

## Desired system

Use **two typographic voices**.

### Human/UI voice

Use the native system stack or equivalent:

`-apple-system`
`BlinkMacSystemFont`
`SF Pro Text`
`SF Pro Display`

Use this for:

- app titles
- buttons
- body text
- descriptions
- chat
- navigation
- section headings
- settings
- explanations

### Machine voice

Use a high-quality mono font for:

- Git hashes
- timestamps
- event identifiers
- terminal commands
- model identifiers
- telemetry values
- raw logs
- technical metadata

This creates a meaningful semantic distinction.

Machine-looking typography should mean:

> this information came from the system.

---

# 7. Typography sizing

Avoid extremely small uppercase labels.

Recommended floor:

- normal UI text: ~13–14px minimum
- dense metadata: ~11–12px
- major window headings: 18–24px
- hero/status numbers: larger where justified

Uppercase mono text should have increased letter spacing.

Never rely purely on tiny text to communicate hierarchy.

---

# 8. Colour system

The existing cream/warm neutral aesthetic should remain.

Do **not** convert Zero into a dark cyberpunk dashboard.

Instead introduce a more systematic semantic palette.

Green:
healthy / available / active

Amber:
attention / stale / partial / degraded

Red:
blocked / offline / destructive / policy conflict

Blue:
informational / data / neutral system action

Purple or another controlled accent:
AI/provider/context-related operation if useful

Neutral brown/charcoal:
system metadata

Colours must indicate meaning consistently across applications.

Do not allow:

green = active in one app
green = selected in another
green = successful in a third

unless those meanings align.

---

# 9. Status language

Status indicators should become standardized components.

Examples:

`LIVE`

`STALE`

`OFFLINE`

`BLOCKED`

`SYNCING`

`PARTIAL`

`LOCAL`

`CLOUD`

`READY`

`RUNNING`

Each must have:

- defined colour
- icon/dot
- tooltip
- semantic meaning
- allowed contexts

Avoid inventing arbitrary labels on individual screens.

---

# 10. Desktop icons

This is another high-impact visual refinement.

## Current issue

Almost every icon currently appears inside a similar rounded white tile.

This makes:

- applications
- documents
- utilities
- PDFs

feel like the same class of object.

## Desired model

Applications and files must look fundamentally different.

---

# 11. Application icon family

Create a shared Project Zero icon family.

Design language:

- dimensional
- tactile
- slightly soft
- subtly 3D
- warm materials
- coherent lighting direction
- not glossy iOS candy
- not flat corporate SVGs
- enough detail to feel crafted
- still readable at small size

Potential metaphors:

Desk → display / desk terminal

Runtime → instrument gauge

Zero Bot → bot/core/orb

Airlock → shield / gate

Skill Lab → laboratory flask + module

Flight Recorder → instrumentation/log device

Network → connection nodes

Icons should feel like they belong to one operating system.

---

# 12. Files should look like files

A PDF should not appear as:

white rounded tile → PDF document

It should simply be a document object.

Same for:

- `.txt`
- images
- Markdown
- ZIP files
- source documents

Use:

- folded-corner document metaphors
- meaningful file-type badges
- image thumbnails when appropriate
- filename underneath

Applications may use sculpted icons.

Files should use document semantics.

---

# 13. Desktop labels

Wallpaper can make text unreadable.

Add one of:

- subtle label shadow
- translucent text backdrop
- carefully tuned outline
- adaptive contrast

Avoid giant dark boxes behind labels.

The treatment should almost disappear when not needed.

---

# 14. Desktop selection states

Icons need:

hover

selected

double-click/open

dragging

drop target

context menu

active/running indicator

The current green dot concept can continue, but its meaning must be explicitly defined.

Example:

green dot = application currently has a live process/state

not simply “this exists.”

---

# 15. Taskbar / dock area

The bottom bar should evolve into an intentional Zero taskbar.

It should communicate:

- open applications
- focused application
- minimized applications
- perhaps unread/attention state

Current focused app should have a stronger indication than open-but-background.

Avoid overcrowding.

The taskbar should not become Windows Start-menu imitation or macOS Dock imitation.

It should remain visually native to Zero.

---

# 16. Global LIVE indicator

The global top-right `LIVE` indicator currently lacks a precise semantic contract.

Define it.

For example:

`LIVE` means Zero's core daemon is connected and delivering realtime state.

Then an application-specific `LIVE` means:

that application's view is connected to current state.

If the global daemon disconnects:

`LIVE → RECONNECTING → OFFLINE`

Applications can separately display stale state.

This eliminates ambiguous duplicate badges.

---

# 17. Desk

Desk should become Zero's **at-a-glance control surface**.

It should not become another Runtime page.

## Primary question

> What is Zero doing right now?

## Current strengths

- timer
- display state
- media
- agent activity
- Git state

These are good categories.

The problem is their presentation hierarchy.

---

# 18. Desk hierarchy

The window should prioritize:

### 1. Current activity

What Zero is currently doing.

Examples:

**Working on Project Zero UI**

Codex · GPT-5.6 Sol

`Editing 3 files`

or:

**Idle**

No active agent run.

### 2. Current session duration

Keep the timer.

### 3. Important peripheral state

Displays

media

connected devices

### 4. Supporting technical information

Git branch

dirty status

recent activity

Move verbose implementation descriptions behind inspection.

---

# 19. Desk empty states

Current text such as:

> Runs derive from streamed bridge events...

is technically useful but inappropriate as the primary empty state.

Replace with something like:

**No active agent runs**

Start a task in Zero Bot and active work will appear here.

Then:

`View technical details`

can expose the streamed-bridge explanation.

---

# 20. Desk cards

Cards should not all have identical visual weight.

Use hierarchy:

Current task → strongest

Warnings → visible

Media → moderate

Displays → quieter

Git state → footer-level metadata

The eye should know where to look within one second.

---

# 21. Zero Bot — highest-value application redesign

Zero Bot should become the conversational centre of Project Zero.

The current implementation is conceptually too close to a provider diagnostics panel.

It needs to become an actual **AI workspace**.

---

# 22. Fundamental Zero Bot model

There should be:

**one Zero conversation**

inside which individual turns may be executed by:

OpenCode models

Codex models

future providers

local models

specialized agents

Provider selection belongs at the **execution level**, not the conversation level.

---

# 23. Eliminate top-level provider mode switching

Current:

`Codex | OpenCode`

This suggests two distinct experiences.

Replace that concept with a provider/model selector near the composer.

Example:

`OpenCode · Muse Spark 1.3 ▼`

The next turn might use:

`Codex · GPT-5.6 Sol ▼`

without creating a new conversation.

---

# 24. Conversation ownership

Project Zero owns:

- conversation identity
- message history
- file references
- project context
- decisions
- task state
- working-tree state
- tool outputs
- memory references
- provider-switch metadata

Providers execute individual turns.

This distinction must be reflected both in backend architecture and UI language.

---

# 25. Zero Bot layout

Recommended structure:

### Left sidebar

Projects

Recent conversations

Pinned conversations

Agents if appropriate

Potential context collections

### Main canvas

Conversation

### Bottom composer

Message input

attachments

provider/model selector

context indicator

send button

possibly voice later

### Optional right inspector

Current task

files in context

tools

memory/context

execution details

This right panel should be collapsible.

---

# 26. Sidebar

It should feel closer to a serious work environment than a consumer chatbot.

Potential hierarchy:

**NEW CONVERSATION**

PROJECTS

Project Zero
Morphism
etc.

RECENT

Refine Skill Lab
Fix Electron resizing
Implement Airlock policies

PINNED

Long-lived important sessions

Do not overload it with every technical subsystem.

---

# 27. Conversation message design

Each message should make provider execution visible but subordinate.

Example:

**Zero**

*via Codex · GPT-5.6 Sol*

Then content.

Provider metadata can be muted.

Tool executions should appear as compact expandable cards.

Example:

`Read 4 files`

`Ran tests`

`Modified 2 files`

`Created commit 8f31c2`

Users can inspect details.

---

# 28. Streaming state

The UI must clearly distinguish:

thinking/execution

tool call

response generation

completed

failed

cancelled

Do not simply show an infinite spinner.

Examples:

`Inspecting repository…`

`Running tests…`

`Writing response…`

These states may be driven by actual harness events.

---

# 29. Model selector

The selector needs significantly more thought than a dropdown of model names.

Group models by provider.

For example:

### Recommended

GPT-5.6 Sol

### Codex

GPT-5.6 Sol
GPT-5.6 Luna

### OpenCode

Muse Spark
GLM
DeepSeek

Show useful metadata:

cost class

speed

context availability

capabilities

But do not turn the selector into a benchmark table.

---

# 30. Manual provider switching

When changing providers in the same thread:

do not display a scary generic warning every time.

Zero should calculate handoff integrity.

Ideal states:

### Full

`Context ready`

### Reconstructed

`Context rebuilt for Codex`

### Partial

`Some provider-specific state cannot transfer`

Clicking reveals details.

---

# 31. Handoff card

On provider switch, Zero could briefly show:

**Context rebuilt for Codex**

14 messages
6 files
Git `a31d92f`
3 task decisions
2 tool outputs

`Inspect context`

This would communicate that Zero genuinely owns continuity.

---

# 32. Canonical context layer

This is not purely UI and absolutely belongs in the specification because the UX depends upon it.

Zero should persist a canonical session representation independent of provider sessions.

Suggested conceptual entities:

`Conversation`

`Turn`

`Execution`

`ProviderSession`

`Artifact`

`Decision`

`Task`

`FileReference`

`ToolResult`

`MemoryReference`

`WorkingStateSnapshot`

`ContextPacket`

The user should never need to understand these entities, but the architecture should.

---

# 33. Context packets

Before every provider execution, Zero creates a provider-specific context packet.

Potential contents:

- recent conversation
- summarized older conversation
- project objective
- active task
- current plan
- decisions
- relevant files
- Git state
- selected memories
- previous tool results
- unresolved questions
- relevant errors

The packet is then transformed according to provider capabilities.

---

# 34. Provider handoff integrity

Zero should record what survived transfer.

Example internal result:

conversation history: full

files: full

provider tool state: unavailable

hidden reasoning: unavailable

terminal process state: partial

repository snapshot: full

The UI then reduces this to:

`Context rebuilt · 2 provider-specific details unavailable`

This is vastly better than pretending two providers share native context.

---

# 35. Automatic routing — future

Do not build this before manual switching works well.

Future option:

`AUTO`

Zero chooses model/provider based on:

- task complexity
- cost
- latency
- provider capability
- context requirements
- user policy

Possible preference:

`Balanced`

`Prefer quality`

`Prefer low cost`

Manual override must always remain available.

---

# 36. Zero Bot composer

The current composer is not yet a real composer.

It needs:

multi-line input

attachments

drag/drop

file mentions

model selector

send

stop generation

keyboard shortcuts

context indicator

possibly tool/permission status

potential slash commands

---

# 37. File mentions

Support patterns such as:

`@README.md`

`@src/airlock`

`@current-diff`

`@runtime-log`

This is especially powerful because Zero owns project context.

---

# 38. Conversation continuity indicators

Near the composer:

`12 files in context`

or:

`Project Zero · branch build/v0.2`

Click to inspect.

This reassures the user that the model is operating inside the correct environment.

---

# 39. Tool output cards

Do not dump raw tool output directly into chat by default.

Show semantic summaries.

Example:

**Tests**

42 passed
1 failed

`View output`

or:

**Files changed**

`src/runtime.ts`
`src/window-manager.ts`

`View diff`

---

# 40. Error handling inside Zero Bot

Errors should explain whether the problem came from:

Zero

provider

network

tool

permission

Airlock

Example:

Bad:

`SEND FAILED`

Better:

**Codex could not start**

The provider session expired.

`Reconnect`

`Use Codex instead`

Technical details should be available but secondary.

---

# 41. Runtime

Runtime is one of the strongest screens already.

Do not redesign it radically.

Focus on responsiveness and interpretability.

---

# 42. Runtime hierarchy

The user should primarily see:

memory pressure

CPU/load if relevant

disk activity

network activity

machine health

Exact cumulative counters are secondary.

---

# 43. Responsive Runtime charts

Charts must use real measured container dimensions.

Never stretch an already-rendered canvas/SVG.

Use `ResizeObserver`.

On narrow layouts:

reduce axis labels

hide secondary legends

reduce historical detail

stack cards vertically

preserve sparkline clarity

---

# 44. Runtime numbers

Avoid aggressive truncation such as:

`13,303,7...`

Instead:

`13.3M`

with hover:

`13,303,724 reads`

Human-readable abbreviation should be default.

Raw exact values available through tooltip/inspection.

---

# 45. Runtime visual hierarchy

Primary current value:

large

Secondary cumulative value:

smaller

Historical graph:

supporting

Peak:

small annotation

This should make the interface readable without decoding tables.

---

# 46. Runtime sampling

The UI should distinguish:

sampling frequency

display refresh rate

historical window

Example:

system sampled every 1s

chart animates smoothly between observations

Do not fake higher-frequency telemetry than Zero actually receives.

---

# 47. Runtime chart colours

Standardize semantics.

Blue can represent inbound/read.

Red can represent outbound/write.

Keep this consistent between disk and network where appropriate.

---

# 48. Flight Recorder

This needs a conceptual redesign.

It should become a **semantic history timeline**, not a raw event table.

---

# 49. Primary purpose

The user opens Flight Recorder to answer:

> What happened?

and possibly:

> Why did Zero do that?

not:

> What event names were emitted?

---

# 50. Event aggregation

Raw events should be grouped into human events.

Instead of:

17 × `entity.changed`

show:

**Desk display disconnected**

17 underlying state changes

or:

**Codex task completed**

12 files touched
3 commits
4m 18s

---

# 51. Timeline structure

Each row/event should contain:

timestamp

semantic event title

actor

outcome

optional summary

expand indicator

Severity/state can be communicated visually.

---

# 52. Event categories

Potential filters:

Agents

Files

Providers

Airlock

Skills

System

Devices

Errors

Git

User actions

Do not expose event-channel names as the main filter vocabulary unless Developer Mode is enabled.

---

# 53. Expansion

Expanding an event may reveal:

related raw events

payload metadata

actor

request ID

source

duration

affected objects

Airlock decisions

tool calls

provider

Git references

This retains forensic value.

---

# 54. Search

Flight Recorder should support search.

Examples:

`README`

`Codex`

`blocked`

`skill`

`display`

Advanced mode could support exact IDs.

---

# 55. Developer mode

A toggle can expose raw events.

Example:

`Semantic`

`Raw`

Raw mode may resemble the current table.

The current UI therefore does not need to be thrown away; it becomes an advanced view.

---

# 56. Airlock

Airlock should be repositioned conceptually.

It is not merely an approval queue.

It is Zero's **outbound trust boundary**.

---

# 57. Core Airlock responsibility

Before information leaves the local Zero environment for:

Codex

OpenCode

external APIs

cloud services

other remote tools

Airlock applies policy.

---

# 58. Policy classes

At minimum support conceptually:

### LOCAL ONLY

Data may never leave the machine.

### SUMMARY ONLY

Raw data remains local.

Zero may generate a sanitized local representation.

### ALLOW WHEN REQUIRED

May leave the machine when explicitly relevant to an authorized task.

### ALLOWED

Normal outbound use.

These labels should be user-understandable.

---

# 59. User-defined sensitive data

Airlock should eventually allow rules such as:

phone numbers

email addresses

address

personal IDs

API keys

tokens

specific filenames

directories

patterns

custom strings

Examples:

`~/Documents/Personal/** → LOCAL ONLY`

`.env → LOCAL ONLY`

`phone numbers → REDACT`

---

# 60. Secret detection

Deterministically detect likely:

API keys

private keys

access tokens

credentials

authorization headers

`.env` values

SSH secrets

database credentials

These should generally be blocked or redacted automatically.

---

# 61. PII detection

PII detection may include:

phone numbers

emails

addresses

government identifiers where feasible

User-defined patterns should have higher confidence than probabilistic detection.

Do not silently pretend PII detection is perfect.

---

# 62. Airlock request flow

Conceptual pipeline:

local context selected

↓

Airlock classification

↓

policy application

↓

redaction/transformation

↓

provider-specific payload

↓

transmission

↓

audit entry

This flow should exist architecturally whether or not visually shown every time.

---

# 63. Airlock home UI

Most users should see a calm summary.

Example:

**Protected**

128 outbound requests inspected today

7 sensitive values removed

0 policy violations

Then recent notable events.

Most clean requests should not visually flood the screen.

---

# 64. Airlock event

Example:

**Sent context to Codex**

12 source files

`.env` excluded

2 phone numbers redacted

21 KB transmitted

**Allowed**

Click:

`Inspect payload`

---

# 65. Airlock block

Example:

**Transmission blocked**

`customer-data.csv`

Policy:

`LOCAL ONLY`

Codex requested this file while completing:

“Analyze customer churn.”

Actions:

`Keep blocked`

`Allow once`

`Change policy`

Explicit permission should apply only to the exact object/request unless the user deliberately changes policy.

---

# 66. Determinism

Airlock should avoid purely LLM-based security decisions.

Security-sensitive behaviour should use:

file policies

rules

pattern matching

secret scanners

allow/deny lists

deterministic transforms

An LLM may help explain results.

It should not be the sole enforcement mechanism.

---

# 67. Airlock metrics

Replace confusing counters with meaningful ones.

Useful:

Requests inspected

Data blocked

Redactions

Policy overrides

Providers contacted

Potentially:

`0 unresolved`

Avoid displaying `100 pending` unless there are genuinely 100 user-relevant pending decisions.

---

# 68. Skill Lab

This screen needs perhaps the largest visual redesign after Zero Bot.

Right now it is a list of boxes.

It does not communicate experimentation.

---

# 69. Skill Lab product concept

Skill Lab is where Zero's capabilities are:

discovered

created

tested

validated

enabled

disabled

inspected

shared across providers

It should feel like a **workbench**.

---

# 70. Skill states

Potential lifecycle:

Draft

Testing

Validated

Enabled

Disabled

Incompatible

Broken

These states are much more useful than simply showing every item as another card.

---

# 71. Skill provenance

The current concepts are good:

Authored

Learned in Codex

Learned in OpenCode

Keep them.

Make them meaningful metadata.

Example:

**Zero Debug Ritual**

Source
Learned in Codex

Compatibility
Codex ✓
OpenCode ✓

Status
Validated

---

# 72. Skill Lab layout

Possible structure:

### Top toolbar

search

filter

create skill

import

enabled count

### Main workbench

skills grouped or presented as modules

### Inspector

selected skill details

### Test area

run skill against controlled input

View result and compatibility.

---

# 73. Skill card

Each skill should show only:

name

short purpose

status

compatibility

provenance

Do not show the entire manifest in every card.

---

# 74. Skill inspector

Selecting a skill should reveal:

description

instructions

permissions

files

provider compatibility

version

provenance

last validated

failures

test history

source

Enable/Disable

Edit

Test

Duplicate

Delete

---

# 75. Skill permissions

A crucial concept.

Skills should declare what they may do.

Examples:

read repository

write repository

run shell

use network

access browser

access personal memory

call provider

send external data

This integrates strongly with Airlock.

---

# 76. Skill sandbox

New or modified skills should initially exist in a testing/sandbox state.

Zero can validate:

manifest

required fields

permissions

provider compatibility

syntax

test execution where appropriate

Only then:

`Validated`

---

# 77. Broken skill UX

Current `broken-skill` presentation is technically accurate but visually crude.

Instead:

**broken-skill**

⚠ Cannot be used

Missing:

Name
Description

`Repair`

`Edit source`

Detailed parser error underneath only if expanded.

---

# 78. Skill Lab visual language

Introduce visual differentiation without turning it into colourful SaaS cards.

Potential techniques:

provenance glyphs

thin provider colour accents

status lights

mini node/socket visuals

permission icons

connection lines inside the selected inspector

The environment should suggest **components/modules** rather than documents in rectangles.

---

# 79. Settings

The current settings surface is dramatically underspecified.

Wallpaper alone is not enough.

Settings should evolve into a real system application.

---

# 80. Suggested Settings architecture

### Appearance

Wallpaper

desktop density

window translucency

reduced motion

theme if supported later

### Desktop

icon size

icon arrangement

taskbar behaviour

restore windows on launch

### Providers & Models

Codex

OpenCode

authentication status

default provider

model preferences

### Zero Bot

default model

auto-routing preferences later

conversation behaviour

### Airlock & Privacy

default policy

rules

sensitive data patterns

audit retention

### Skills

global skill policy

enable/disable

permissions

### Runtime

sampling settings

history retention

### Data & Memory

Zero memory

conversation history

context retention

### Developer

raw events

debug panels

bridge information

daemon diagnostics

---

# 81. Settings search

Once settings grow, implement search.

Search:

`wallpaper`

`OpenCode`

`privacy`

`memory`

`developer`

Results should jump to settings sections.

---

# 82. Wallpaper picker

Improve the existing picker visually.

Show actual thumbnails.

Support:

built-in wallpapers

custom image

fill modes

Preview before applying.

Potential options:

Cover

Contain

Stretch

Tile

Avoid displaying these as ambiguous standalone words without preview.

---

# 83. Content design

A large part of the remaining polish is **writing**.

Project Zero currently speaks too much like its backend implementation.

The UI should use three layers.

### Layer 1 — Human

`Display offline`

### Layer 2 — Explanation

`Desk Display has not checked in for 2 hours.`

### Layer 3 — Developer

`Lease expired at 14:08:18. Source zerod/display/heartbeat.`

The default interface should primarily use layers 1 and 2.

---

# 84. Remove backend jargon from normal UI

Terms such as:

bounded runtime projection

streamed bridge events

daemon-derived

read-only transcript read

lease status

exact-ID commands

should generally move behind:

`Technical details`

unless the term itself becomes part of Zero's intentional product vocabulary.

---

# 85. Empty states

Every application should have intentionally designed empty states.

An empty state should answer:

what is missing?

is that expected?

what can I do?

Example:

**No active tasks**

Start a conversation in Zero Bot to begin one.

Not:

`No active agent runs derive from streamed events…`

---

# 86. Errors

Error language should contain:

what failed

what caused it if known

what Zero can do

what the user can do

technical details optionally

Example:

**OpenCode disconnected**

Zero cannot send new requests through OpenCode.

`Reconnect`

`Use Codex instead`

Technical details should be available but secondary.

---

# 87. Loading states

Avoid blank windows.

Use context-aware loading states.

For short waits:

spinner/activity indicator

For longer waits:

semantic step

`Connecting to Zero…`

`Loading conversation…`

`Rebuilding context…`

---

# 88. Motion

Motion should reinforce the desktop metaphor.

Use restrained animations.

Suitable examples:

window opening

window minimizing

popover appearing

card expansion

provider change

status transitions

taskbar focus indicator

Avoid excessive springiness.

This is an engineering environment, not a mobile social application.

---

# 89. Animation timing

Define common durations.

Fast UI feedback:

~100–150ms

Standard transition:

~180–250ms

Larger spatial change:

~250–350ms

Respect:

`prefers-reduced-motion`

---

# 90. Hover states

Interactive elements should communicate interactivity before click.

Buttons

cards

skills

timeline events

taskbar items

desktop icons

model selector

file references

should all have deliberate hover states.

Avoid hover styling on non-interactive containers.

---

# 91. Focus states

Keyboard focus must be visible.

The UI should be completely navigable without guessing where focus currently exists.

---

# 92. Keyboard support

Project Zero should eventually feel like a serious desktop tool.

Baseline shortcuts:

`⌘K` command palette

`⌘N` new Zero conversation where appropriate

`⌘W` close window

`⌘M` minimize

`⌘,` Settings

`⌘F` search within current application

Zero Bot:

`⌘Enter` possibly send if multiline conventions warrant it

Model switch shortcut could come later.

---

# 93. Command palette

A Zero command palette would significantly improve the operating-system illusion.

Potential commands:

Open Runtime

Open Airlock

New Zero conversation

Switch model

Show recent activity

Open Skill Lab

Search settings

Open file

It should search actions, not merely applications.

---

# 94. Accessibility

Polish does not mean tiny interfaces.

Requirements:

reasonable text size

WCAG-conscious contrast

visible keyboard focus

semantic HTML

screen-reader labels

status not encoded by colour alone

larger invisible pointer hit targets

reduced-motion support

tooltips for unfamiliar iconography

---

# 95. Performance

A polished UI that stutters will feel less premium than today's UI.

Set explicit goals.

Window dragging:

perceptually 60fps

Window resize:

perceptually smooth

Opening common application:

near-immediate after initial load

Desktop interactions:

no blocking work

Telemetry processing:

must not rerender unrelated windows

---

# 96. Electron architecture considerations

Where practical:

main process owns native window/system responsibilities

renderer owns UI

state updates should be selective

avoid giant global state updates causing all windows to rerender

high-frequency telemetry should use isolated stores/subscriptions

charts should not trigger layout thrashing

large logs should be virtualized

---

# 97. State persistence

Persist:

window positions

window sizes

open applications

possibly minimized state

selected wallpaper

settings

Zero Bot sidebar state

last selected provider/model where sensible

Do not necessarily reopen transient modals.

---

# 98. Data freshness

Every view using realtime information must define:

live

stale

offline

unknown

For example:

Live:
recent event inside expected heartbeat window

Stale:
data exists but expected refresh missed

Offline:
source confirmed unavailable

Unknown:
state cannot be determined

Avoid mapping unknown to offline.

---

# 99. Tooltips

Tooltips are appropriate for:

technical status

icon-only buttons

truncated metadata

raw numeric values

provider capabilities

security classification

Do not require tooltips to understand basic navigation.

---

# 100. Truncation

Avoid ellipses where formatting could solve the problem.

Prefer:

`13.3M`

over:

`13,303,7...`

Prefer line wrap for meaningful human text.

Use ellipsis mainly for genuinely arbitrary identifiers or paths.

---

# 101. Developer Mode

This is crucial because Project Zero genuinely needs deep engineering information.

Instead of forcing a choice between friendly UI and technical visibility, support both.

Normal mode:

semantic product interface

Developer mode:

event IDs

bridge state

raw provider sessions

exact payload metadata

daemon information

raw telemetry

developer diagnostics

This protects Zero's power while massively improving default usability.

---

# 102. Visual density

The current design is pleasantly restrained.

Do not overcorrect by filling empty space.

Whitespace should remain part of Zero's identity.

The target is:

**more meaningful hierarchy**

not:

**more widgets**

---

# 103. Component standardization

Build shared primitives.

Examples:

`WindowShell`

`WindowTitleBar`

`StatusPill`

`Metric`

`MetricCard`

`EmptyState`

`EventRow`

`InspectorPanel`

`ProviderBadge`

`ModelBadge`

`FileChip`

`ToolCallCard`

`SectionHeader`

`TechnicalDetails`

`ErrorState`

`SearchField`

`AppIcon`

`DocumentIcon`

`Popover`

`Tooltip`

`SegmentedControl`

Individual applications should not reimplement these visually.

---

# 104. Design tokens

Move visual decisions into tokens.

At minimum:

spacing

font sizes

font weights

border radii

borders

backgrounds

foreground colours

status colours

shadow levels

animation durations

z-index levels

window padding

card padding

This prevents gradual visual drift.

---

# 105. The visual target

Project Zero should not feel like:

macOS clone

Windows clone

Linux desktop skin

AI SaaS dashboard

retro terminal

gaming HUD

corporate admin panel

It should feel like:

> a quiet, tactile, technically sophisticated personal operating environment built around local intelligence.

That is the design identity worth protecting.

---

# 106. Expected impact

Each refinement should map to a concrete product outcome.

| Improvement | Expected impact |
|---|---|
| Responsive windows | Makes Zero feel like real software instead of a responsive webpage |
| Human/system typography split | Better readability without losing identity |
| App vs document icon distinction | Strengthens desktop illusion |
| Zero-owned conversations | Makes cross-provider AI feel coherent |
| Provider-per-turn model selection | Enables cost/quality orchestration |
| Context reconstruction UI | Builds trust in provider switching |
| Semantic Flight Recorder | Makes system history actually useful |
| Airlock privacy model | Establishes a differentiated trust architecture |
| Skill Lab workbench | Makes extensibility tangible |
| Settings redesign | Makes Zero feel like an operating environment |
| Developer Mode | Preserves engineering depth without overwhelming default UI |
| Standard states/components | Creates consistency and makes future features easier to build |
| Improved microcopy | Reduces cognitive load |
| Motion/focus/hover polish | Produces perceived craftsmanship |
| Accessibility work | Improves real usability rather than cosmetic polish |

---

# 107. Implementation priority

I would explicitly tell the coding model **not to implement everything simultaneously**.

### Phase 1 — foundational polish

Window resize system

minimum application sizes

design tokens

typography system

shared status primitives

window chrome

focus/elevation

desktop icon semantics

### Phase 2 — Zero Bot

conversation architecture

sidebar

composer

provider/model selection

provider-per-turn execution

context packet abstraction

handoff integrity

tool call cards

### Phase 3 — semantic system surfaces

Flight Recorder aggregation

Airlock redesign

Desk simplification

Runtime responsive behaviour

### Phase 4 — Skill Lab

workbench architecture

skill inspector

permissions

testing/sandbox

compatibility/provenance

### Phase 5 — system UX

Settings

command palette

keyboard navigation

desktop refinements

microanimations

errors

empty states

accessibility

### Phase 6 — final polish

icon family

document icons

fine spacing

typography tuning

visual QA

performance QA

cross-window consistency

---

# 108. Explicit non-goals

This section is important because models love scope creep.

For this refinement cycle:

Do not rebuild the existing desktop metaphor.

Do not introduce a radically different visual theme.

Do not redesign the 3D Network topology.

Do not introduce automatic AI routing before manual provider switching is reliable.

Do not convert every application into a dashboard.

Do not remove technical information; relocate it behind progressive disclosure.

Do not sacrifice information honesty for cleaner screenshots.

Do not create artificial telemetry.

Do not invent capabilities unsupported by the backend.

Do not redesign functional backend architecture unless required to support specified UX.

Do not replace the warm Zero aesthetic with generic modern SaaS styling.

---

# 109. Acceptance criteria

The implementation should not be considered complete merely because screenshots look better.

It should pass behavioural tests.

### Windowing

Dragging any resize handle continuously recomposes content.

No chart stretches visibly.

No text becomes unreadably small.

No application can resize below its defined minimum.

Focus state is obvious.

Window state persists.

### Zero Bot

One conversation supports successive turns through different providers.

The provider/model used for each response is visible.

Switching provider does not create a new thread.

Zero rebuilds context from canonical state.

Partial context transfer is communicated honestly.

### Airlock

Outbound model context passes through defined policy enforcement.

Blocked/local-only items cannot silently leave the machine.

Redactions are auditable.

The UI can explain why something was blocked or modified.

### Flight Recorder

Repeated low-level events are aggregated.

Users can inspect underlying events.

Search and filtering work.

Raw mode remains available.

### Skill Lab

Skills can be selected.

Provenance is visible.

Compatibility is visible.

Broken skills explain the problem.

Skill details do not require reading raw manifests.

### Runtime

Metrics remain legible at every supported size.

Graphs redraw rather than scale.

Values do not truncate nonsensically.

### Accessibility

All important flows are keyboard accessible.

Focus indication exists.

Reduced-motion is respected.

Colour is never the sole state indicator.

---

# 110. Visual QA matrix

Test every major application under:

full-size window

medium window

minimum-size window

focused

unfocused

live data

stale data

offline source

empty state

loading

error

very long text

very large numbers

very long filenames

very long model names

light wallpaper

dark wallpaper

busy wallpaper

This catches far more issues than designing against one screenshot.

---

# 111. The single most important rule for implementation

> **Do not “beautify” Project Zero indiscriminately. Preserve the existing design language. Every change must improve usability, semantic clarity, responsiveness, or perceived craftsmanship while maintaining the current visual identity.**

---

*Adopted as binding for all future UI lanes per owner direction (see `.superpowers/sdd/2026-09-11-electron-port/progress.md`). Direct owner orders override; 3D Network topology work continues under explicit owner direction per the non-goal exception noted in the ledger.*
