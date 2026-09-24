Project Zero Canonical Build Specification
Architecture product protocol security and staged implementation plan
Version 0.1
8 September 2026


Purpose
This document is the canonical build specification for Project Zero. It defines the product boundary, architecture, protocol, trust model, implementation stages, and acceptance criteria that coding agents and human contributors must follow.
Project Zero is a local-first personal environment runtime. The personal Mac is the initial authority, a native macOS application is the cockpit, and software, agents, phones, and physical devices participate through explicit capabilities and authenticated protocol messages.
Canonical rule
A conflicting implementation is a defect unless an explicit architecture decision record supersedes this specification.
________________


Contents
1 Executive summary
2 Product definition
3 Constitution
4 Goals requirements and non goals
5 Vocabulary and component boundaries
6 System architecture
7 Zero Protocol
8 State model
9 Composable context
10 Intents
11 Persistent goals and tasks
12 Policy and permissions
13 Security privacy and trust
14 AI routing and cost model
15 Agents and executors
16 Persistence and storage
17 Networking and connectivity
18 Observability and auditability
19 Failure and retry semantics
20 Memory
21 Interfaces
22 First nodes
23 Integrations
24 Technology choices and prior art
25 Repository and monorepo structure
26 SDK strategy
27 API and schema governance
28 Testing strategy
29 Roadmap and acceptance criteria
30 Unforgettable demo narrative
31 Architecture decisions to record first
32 Implementation rules for Codex
33 Known risks and mitigations
34 Open questions for staged resolution
35 Reference sources
36 Definition of success
________________


1 Executive summary
Project Zero is a local-first personal environment runtime that coordinates software, devices, data, and agents through shared state, events, capabilities, policies, and persistent goals. It is not primarily a chatbot, smart-home controller, or agent framework. It is an operating layer for one person's computational and physical environment.
The initial system runs on the owner's personal Mac. A native macOS application is the cockpit; a Go daemon named zerod is the runtime; SQLite is the authoritative local store; and the CLI is the first complete administrative interface. An ESP32 desk display is the first constrained physical node. An iPhone becomes the first remote node. A Raspberry Pi may later become an always-on host, but no protocol rule may assume a permanent master or a permanently available node.
Zero remains useful without AI. Natural language is compiled into structured intents and goals. Deterministic software handles validation, authorization, state transitions, routing, retries, and execution whenever possible. Models are optional, replaceable executors for ambiguity, planning, summarization, perception, and complex work. Model calls are routed by privacy, capability, latency, and budget.
Security is part of the architecture: explicit permissions, encrypted secrets, sensitive-data boundaries, authenticated node identity, audit trails, credential isolation, and user-visible explanations. The Oracle or work Mac is outside the system and must never be enrolled, discovered as an actionable node, or used as a source of personal context.
The thesis milestone is not merely feature completeness. It is a demonstrated distributed personal system that survives disconnections and restarts, coordinates a Mac, iPhone, and ESP32, explains its actions, and safely carries a persistent software goal overnight. The lasting success condition is repeated personal use and evolution.
2 Product definition
2.1 Canonical sentence
Project Zero is a local-first personal environment runtime that coordinates software, devices, data, and agents through shared state, events, and capabilities.
2.2 Product thesis
The user's environment can behave like one coherent computer without surrendering ownership of its state or reducing every interaction to an LLM prompt. Each participating device or service is a node. Each action it can perform is an explicit capability. Changes are events. Current facts are state. Concurrent circumstances are composable context. Human language becomes typed intent. Work that persists through time becomes a goal. Policy decides what may happen. Executors perform only authorized work.
2.3 Locked decisions
1.  Personal-first, generic core, and no consumer-onboarding requirements.
2.  Local core: authoritative state and runtime remain local; cloud APIs and models are optional capabilities.
3.  The personal Mac is the initial runtime host. Future always-on nodes are allowed; permanent-master assumptions are forbidden.
4.  Zero may model projects, creator activity, routines, places, preferences, people, health, activity, conversations, and long-term memory, subject to explicit privacy boundaries.
5.  Autonomy progresses from policies and suggestions to bounded autonomy and persistent goal execution.
6.  Permissions use ALWAYS_ALLOWED, ASK, SESSION_ALLOWED, and DENIED.
7.  The work/Oracle Mac is completely excluded.
8.  Permissions, encryption where appropriate, auditability, agent credential isolation, and cloud-export boundaries are foundational.
9.  The primary mature interface is a native macOS cockpit, accompanied by CLI, menu bar, iPhone, physical controls/displays, notifications, and later voice.
10.  Natural language is important but compiles into structured forms and deterministic capabilities where possible.
11.  Context is composable and multidimensional, never one global mode.
12.  Persistent goals are a core eventual primitive.
13.  Physical computing is first-class, including constrained ESP32-class nodes.
14.  Remote iPhone-to-home-Mac connectivity, offline behavior, reconnection, and queued work are first-class.
15.  Zero invents abstractions only where it has something meaningful to say.
16.  The ambition is an engineering-thesis-grade system that genuinely runs part of the user's life.
3 Constitution
1.  Deterministic before intelligent. If normal software can reliably solve a problem, Zero must not require a model.
2.  AI is a capability, not the architecture. Providers and agents are replaceable executors.
3.  Everything participating is a node. Macs, phones, microcontrollers, future hubs, local processes, and cloud adapters use one conceptual model.
4.  Every action is explicit. Nodes advertise typed capabilities; no component receives ambient authority merely because it is connected.
5.  State and events belong to the owner. The local system remains useful without a cloud-hosted brain.
6.  Every action is explainable. Zero can answer what happened, why, under which policy, on which node, with which data, and at what cost.
7.  Autonomy has boundaries. Authorization, confirmation, timeout, retry, cancellation, and destructive-action protection are runtime concerns.
8.  Personal usefulness outranks generic polish. Bespoke integrations are valid; generic semantics belong in the core.
9.  Physical computing is part of the system. Hardware is not a decorative dashboard layer.
10.  New capabilities compound. A new node or integration should expand the same environment rather than create another silo.
11.  No invisible export. Data crossing a trust boundary is classified, minimized, disclosed, and logged.
12.  Offline is a state, not an exception. Disconnection, stale state, queues, and reconciliation are designed behavior.
4 Goals requirements and non goals
4.1 Functional requirements
Zero shall:
* discover, pair, authenticate, register, monitor, suspend, revoke, and remove nodes;
* accept capability advertisements and invoke capabilities with typed inputs and results;
* ingest immutable events and maintain materialized state;
* compute composable context from observations, assertions, and policies;
* parse structured commands and natural language into reviewable intents;
* create, pause, resume, cancel, and complete durable goals and their tasks;
* evaluate policy before every side effect and cloud export;
* route deterministic work, model calls, and agent jobs according to capability, privacy, cost, and risk;
* operate on local networks and across secure remote connectivity;
* queue eligible work for offline nodes and reconcile after reconnect;
* expose a native macOS cockpit, CLI, menu bar surface, iPhone node, notifications, and physical interfaces;
* maintain searchable audit, event, invocation, decision, and cost histories;
* continue useful local operation when internet services are unavailable.
4.2 Non functional requirements
* Ownership: authoritative data is stored on owner-controlled hardware by default.
* Recoverability: a runtime restart must not lose acknowledged commands, goal state, policy decisions, or audit records.
* Responsiveness: local status reads target p95 below 100 ms; local capability dispatch below 250 ms excluding device work.
* Resource discipline: an idle zerod target is below 150 MB RAM on macOS; the ESP32 client uses bounded memory and messages.
* Interoperability: protocol semantics are transport-neutral and versioned.
* Observability: all meaningful side effects have a correlated decision and result record.
* Cost control: model budgets and per-goal limits are enforced before calls are made.
* Security: default deny for unknown nodes, unknown capabilities, sensitive exports, and destructive operations.
* Maintainability: the core has stable interfaces, migration tests, simulators, and no dependency on the UI process.
4.3 Explicit non goals
* A consumer SaaS product, multi-tenant service, marketplace, or generalized onboarding flow.
* Control, observation, enrollment, or data extraction from the Oracle/work Mac.
* A kernel, replacement desktop operating system, or universal home-automation protocol.
* A general-purpose agent framework competing with every orchestration library.
* A cloud control plane required for normal local operation.
* Inventing cryptographic primitives, VPN protocols, message transports, databases, or model runtimes.
* Guaranteeing exactly-once physical effects. Zero instead provides durable intent, idempotency, deduplication, and explicit uncertainty.
* Storing every available life signal. Collection must be purposeful, classified, and reversible.
5 Vocabulary and component boundaries
Term
	Definition
	Owns
	Does not own
	Zero Runtime/Core
	The local control plane implemented by zerod
	Registry, routing, state, policy, goals, audit, adapters
	Presentation and device-specific behavior
	Zero Protocol
	Versioned semantics and envelopes shared by nodes
	Identity claims, lifecycle, events, invocations, results
	Transport implementation or business-specific payloads
	Zero Mac app
	Native personal cockpit
	Presentation, intent review, approvals, rich local UX
	Authoritative execution state
	Node
	An authenticated participant with identity and lifecycle
	Its keys, connections, capabilities, local execution
	Global policy or global truth
	Capability
	A typed action a node can perform
	Input/output contract, risk metadata, idempotency behavior
	Permission grant
	Event
	Immutable statement that something occurred
	Historical fact and correlation
	Mutable current truth
	State
	Current materialized facts with provenance and freshness
	Queryable latest view
	Full history
	Context
	Time-bounded composition of dimensions and evidence
	Current situational interpretation
	One exclusive global mode
	Intent
	Validated structured request derived from human or system input
	Desired immediate outcome and proposed steps
	Long-term orchestration
	Goal
	Durable desired outcome surviving commands and restarts
	Lifecycle, plan, tasks, budget, evidence
	Unbounded authority
	Policy
	Declarative rule that permits, denies, constrains, or asks
	Authorization and automation decisions
	Performing side effects
	Agent/executor
	Replaceable worker that plans or performs bounded work
	Assigned task inside a sandbox
	Credentials or policy bypass
	Memory
	Curated retained information with provenance and lifecycle
	Recall, consolidation, retention
	Raw indiscriminate surveillance
	Interface
	Human or programmatic entry point
	Input and presentation
	Core semantics
	Integration
	Adapter for an external app/service/data source
	Mapping external concepts to Zero
	Redefining core primitives
	

6 System architecture
6.1 Initial topology
 Human
  |  native UI / global palette / menu bar / CLI
  v
+------------------------ personal Mac -------------------------+
|  Zero.app             zero CLI                               |
|       \                  /                                   |
|        +---- local authenticated API ----+                    |
|                                          v                    |
|                                      +--------+               |
|                                      | zerod  |               |
|                                      +---+----+               |
|       +-----------------+----------------+----------------+   |
|       |                 |                |                |   |
|  Registry/router   Event + state    Policy/goals     AI router|
|       |                 |                |                |   |
|       +-----------------+-------+--------+----------------+   |
|                                 |                            |
|                         SQLite + encrypted secrets            |
+---------------------------------+----------------------------+
                                 |
                        authenticated Zero Protocol
                                 |
                    +------------+-------------+
                    |                          |
               Mac node adapter          ESP32 desk node
               repo.*, app.*,            display.*, input.*,
               notify.*, agent.*          sensor.*
6.2 Mature topology
                         optional cloud services
                   models / GitHub / Spotify / relay
                               ^
                               | explicit export boundary
                               v
iPhone <-- encrypted link --> Zero home runtime <-- LAN --> ESP32 nodes
                               |
                               +---- local Mac capabilities
                               |
                               +---- future Pi runtime candidate

Authority is logical, leased, and recoverable. Connectivity is not authority.
No node is trusted merely because it is local or online.
6.3 Core modules
zerod is a modular monolith until evidence demands process or service separation:
* API gateway: Unix-domain socket for local clients; TLS network listener for nodes.
* Identity and registry: node records, keys, pairing, revocation, metadata, leases.
* Protocol session manager: handshake, negotiation, heartbeat, backpressure, reconnect.
* Capability catalog/router: schemas, routing, permission checks, invocation records.
* Event journal: append-only domain events, subscriptions, replay, retention.
* State projector: durable materialized views and compare-and-set mutations.
* Context engine: evidence aggregation, confidence, freshness, conflict handling.
* Intent compiler: deterministic grammar first; optional model-assisted parsing.
* Policy engine: authorization and event-condition-action evaluation.
* Goal engine: durable state machines, task scheduling, checkpoints, budgets.
* Executor manager: process adapters, sandboxes, credentials broker, cancellation.
* Memory service: ingestion, classification, retrieval, summarization, deletion.
* Integration host: adapters for local and cloud services.
* Audit and telemetry: structured logs, traces, metrics, decisions, exports, costs.
The modular-monolith boundary is deliberate. A personal system does not need distributed internal services on day one. Modules communicate through typed interfaces and transactions so they can later move without changing domain semantics.
6.4 Control and data flow
Input -> Intent -> validation -> policy decision -> plan
                     |               |
                     v               v
               structured error   approval if needed
                                     |
                                     v
Goal/task or direct invocation -> capability router -> node/executor
       |                                  |
       v                                  v
durable transition <----- result/event/audit/cost
       |
       v
state projections -> context -> UI, policies, and future decisions
7 Zero Protocol
7.1 Scope and principles
The protocol defines meaning above existing transport. It must be:
* transport-neutral, with an initial WebSocket/TLS binding and an MQTT profile for constrained nodes if needed;
* self-describing enough for debugging, bounded enough for microcontrollers;
* authenticated at the session and message levels appropriate to the transport;
* correlated, idempotency-aware, versioned, and forward-compatible;
* explicit about delivery class, expiry, ordering scope, and replay behavior;
* incapable of granting authority solely through capability advertisement.
7.2 Envelope
The canonical JSON diagnostic representation is:
{
 "zero": "0.1",
 "type": "capability.invoke",
 "id": "msg_01J...",
 "time": "2026-09-08T19:21:42.123Z",
 "source": "node:mac-personal",
 "target": "node:desk-display-01",
 "correlation_id": "corr_01J...",
 "causation_id": "msg_01J...",
 "trace_id": "tr_01J...",
 "ttl_ms": 30000,
 "delivery": "durable",
 "classification": "PRIVATE",
 "body": {}
}
Required fields are zero, type, id, time, source, and body. Targeted messages require target. Side effects require an idempotency key in the body or envelope. Canonical wire encoding begins as JSON for inspectability. CBOR becomes the constrained-node profile after schema stability; semantic equivalence tests must prove both encodings represent the same messages.
7.3 Message classes
Class
	Examples
	Delivery default
	Persistence
	Session
	session.hello, session.welcome, session.error
	live
	audit summary
	Lifecycle
	node.register, node.heartbeat, node.goodbye
	live
	latest plus audit
	Catalog
	capability.advertise, capability.withdraw
	durable
	registry
	Invocation
	capability.invoke, capability.accepted, capability.result
	durable
	full
	Event
	event.publish
	declared by event type
	journal/retention
	State
	state.get, state.patch, state.result
	durable for writes
	state plus journal
	Goal
	goal.create, goal.signal, goal.status
	durable
	full
	Policy
	approval.request, approval.decision
	durable
	full audit
	Flow control
	ack, nack, resume, sync.request
	transport/session
	bounded
	

7.4 Version negotiation
* Major protocol versions break compatibility; minor versions add optional fields/types.
* session.hello sends supported major versions, encodings, compression, max frame size, and feature flags.
* The runtime selects one profile in session.welcome or rejects with a machine-readable reason.
* Receivers ignore unknown optional fields, reject unknown required features, and never reinterpret known fields.
* Every capability has an independent semantic version and JSON Schema or generated equivalent.
* Deprecation requires two supported minor releases or a documented migration window, whichever is longer.
7.5 Node identity discovery and registration
Identity. Each node generates an asymmetric keypair locally. node_id is stable and bound to the public key through a signed enrollment record. Private keys never leave the node. On Apple platforms use Keychain/Secure Enclave when practical; on ESP32 use secure storage and, on supported boards, hardware-backed key protection.
Discovery. LAN discovery uses mDNS/DNS-SD service _zero._tcp with only non-sensitive bootstrap metadata: protocol major, pairing status, port, and node class. Discovery is not authentication. The iPhone declares the Bonjour service type and local-network purpose. Manual address and QR bootstrap are fallback paths.
Pairing. New nodes start untrusted. A local-owner action opens a short-lived pairing window. The node presents a public-key fingerprint and one-time code or QR. The owner verifies it in the Mac app. The runtime signs an enrollment certificate containing node ID, allowed node class, expiry/rotation policy, and initial capability ceiling.
Registration. An authenticated node submits metadata, software/firmware version, supported protocol profiles, and capability advertisement. Registration updates the registry but does not grant capability permissions.
Revocation. Revocation invalidates the enrollment credential, closes sessions, cancels eligible queued work, preserves audit history, and requires re-pairing. Key rotation maintains a signed link between old and new keys.
7.6 Heartbeat and lifecycle
Node lifecycle states are:
UNPAIRED -> PAIRED -> CONNECTING -> ONLINE -> DEGRADED
                                     |          |
                                     v          v
                                  OFFLINE <- SUSPECT
                                     |
                             REVOKED or RETIRED
* Heartbeat interval is negotiated by node class: desktop 15 s, phone background-adaptive, ESP32 30 s by default.
* After two missed intervals the node is SUSPECT; after the negotiated lease expires it is OFFLINE.
* DEGRADED means connected but missing required capability, low power, stale sensor, or failing health check.
* Wall-clock timestamps are accompanied by runtime receive time and monotonic sequence where available; clock skew never determines authorization alone.
* Last-will/offline notices are hints. Lease expiry is authoritative.
7.7 Capability advertisement
{
 "capability": "display.render",
 "version": "1.0.0",
 "description": "Render a named Zero view",
 "input_schema": "zero://schemas/display.render/1.0.0/input",
 "output_schema": "zero://schemas/display.render/1.0.0/output",
 "risk": "LOW",
 "effects": ["PHYSICAL_OUTPUT"],
 "idempotency": "KEYED",
 "offline_queue": "LATEST_ONLY",
 "max_runtime_ms": 3000,
 "constraints": {"max_payload_bytes": 4096}
}
Capability names use reverse-domain-like, lowercase segments: repo.status, notification.send, agent.execute, display.render. Names describe effects, not implementation. The runtime validates input before dispatch and result before commit. Advertisement is a claim about ability, not permission.
7.8 Invocation and results
An invocation record includes request ID, idempotency key, principal, target selector, capability/version constraint, input, deadline, retry policy, risk, classification, policy decision, and goal/task correlation.
Result status is one of SUCCEEDED, FAILED, REJECTED, CANCELLED, TIMED_OUT, EXPIRED, UNKNOWN_EFFECT, or PARTIAL. UNKNOWN_EFFECT is mandatory when connectivity is lost after dispatch and the runtime cannot prove whether a non-idempotent effect occurred. Such work is never blindly retried.
Executors first return capability.accepted when work outlives the request window. Progress events are advisory and rate-limited. Final results include structured output, error code, retryability, observations, start/end time, and evidence references.
7.9 Event schema
{
 "event_id": "evt_01J...",
 "type": "focus.session.started",
 "schema_version": "1.0.0",
 "occurred_at": "2026-09-08T19:30:00Z",
 "observed_at": "2026-09-08T19:30:00.120Z",
 "producer": "node:mac-personal",
 "subject": "person:owner",
 "data": {"project_id": "project:zero"},
 "classification": "PRIVATE",
 "confidence": 1.0,
 "correlation_id": "corr_01J...",
 "causation_id": "intent_01J...",
 "dedupe_key": "focus-start-20260908T1930",
 "retention": "1y"
}
Events are immutable. Corrections are new events referencing superseded records. Ordering is guaranteed only within a producer stream or explicit aggregate sequence, never globally. Consumers must tolerate duplicates and late arrival. Event type names use past-tense facts. Commands and intents are not events.
7.10 Delivery classes and backpressure
* EPHEMERAL: presence/telemetry that may be dropped; no replay.
* LATEST: retain only the newest value per key, suitable for display state.
* DURABLE: persist until terminal result or expiry; explicit acknowledgement.
* AUDITED: durable plus immutable policy and export evidence.
Each session negotiates in-flight limits. Slow consumers receive bounded buffers, coalesced LATEST updates, and disconnect before unbounded memory growth. Durable work remains in the runtime outbox.
8 State model
8.1 Separation from events
Events say what happened; state answers what is currently believed. State is projected from events or set through controlled mutations. The runtime stores provenance, freshness, classification, and revision with each value.
{
 "key": "context.project.active",
 "value": "project:zero",
 "revision": 418,
 "valid_from": "2026-09-08T19:30:00Z",
 "expires_at": null,
 "source": "policy:enter-project",
 "evidence": ["evt_01J..."],
 "confidence": 0.98,
 "classification": "PRIVATE"
}
State writes use optimistic concurrency (expected_revision). Multi-key invariants use one SQLite transaction. The Mac runtime is initially authoritative. Remote nodes cache scoped snapshots with freshness labels; they do not silently become global authorities.
8.2 Consistency
* Registry, permissions, approval, goal transitions, and invocation dispatch are strongly consistent within the home runtime transaction boundary.
* Node presence, sensor readings, integration state, and remote caches are eventually consistent and visibly timestamped.
* UI may optimistically render pending actions but must distinguish pending from committed.
* A future runtime-host transition requires a lease/epoch and single-writer fencing. Multi-leader state is out of scope until demonstrated necessary.
9 Composable context
Context is a set of independently sourced dimensions, not a mode enum:
activity=coding       project=zero       location=home
attention=focused     social=alone       device=mac-personal
media=playing         energy=medium      availability=do-not-disturb
Each dimension contains value, confidence, source, evidence, valid interval, decay function, classification, and override precedence. Sources include explicit user assertions, deterministic sensors, calendar/integrations, inferred rules, and model inference. Precedence defaults to explicit assertion > policy-derived fact > trusted sensor > integration > model inference.
Conflicts are retained as evidence and resolved into a current view; they are not erased. Sensitive dimensions such as health, exact location, people, and conversation content are independently permissioned. Context selectors let policies require several dimensions without coupling them:
when:
 all:
   - context.project == "project:zero"
   - context.activity == "coding"
   - context.location in ["home", "unknown"]
   - context.attention != "meeting"
Context changes emit events only when material thresholds are crossed, preventing noisy policy loops.
10 Intents
An intent represents an immediate desired outcome and must be inspectable before execution:
{
 "intent_id": "int_01J...",
 "kind": "project.session.start",
 "source": {"interface": "mac.palette", "raw": "work on Zero"},
 "slots": {"project_id": "project:zero"},
 "confidence": 0.94,
 "proposed_actions": [
   {"capability": "focus.session.start"},
   {"capability": "repo.status"},
   {"capability": "display.render"}
 ],
 "ambiguities": [],
 "classification": "PRIVATE"
}
Compilation pipeline:
1.  Parse explicit CLI/typed forms deterministically.
2.  Match known natural-language templates locally.
3.  If ambiguity remains, call an allowed model with the smallest classified context slice.
4.  Validate the returned intent against a schema and capability catalog.
5.  Resolve targets and simulate policy decisions.
6.  Ask a concise clarification only when ambiguity materially changes effects.
7.  Display a preview for sensitive actions, then execute or create a goal.
Models never emit executable shell text directly into the runtime. They emit structured proposals that pass normal validation and policy.
11 Persistent goals and tasks
11.1 Goal model
A goal is a durable desired outcome with explicit authority and completion evidence:
{
 "goal_id": "goal_01J...",
 "title": "Implement resilient ESP32 reconnect behavior",
 "desired_outcome": "The node reconnects and restores the latest display within 10 seconds",
 "success_criteria": ["tests pass", "hardware simulation passes", "diff reviewed"],
 "state": "RUNNING",
 "owner": "person:owner",
 "created_by": "intent:int_01J...",
 "scope": {"repo": "project-zero", "paths": ["firmware/", "core/protocol/"]},
 "budget": {"money_usd": 3, "model_tokens": 200000, "wall_time": "8h"},
 "authority_profile": "overnight-development",
 "deadline": "2026-09-09T07:00:00+05:30",
 "checkpoint_policy": "after_each_task",
 "result_policy": "prepare_review_never_push"
}
11.2 State machine
DRAFT -> PLANNED -> WAITING_APPROVAL -> QUEUED -> RUNNING
                    ^                    |          |
                    |                    v          v
                NEEDS_INPUT <--------- PAUSED   VERIFYING
                                                  |
                        +-------------------------+----------------+
                        v                         v                v
                    COMPLETED                   FAILED         CANCELLED
Every transition is transactional and evented. A runtime crash resumes from the latest committed transition. Plans are versioned; replanning never rewrites history. A goal may spawn tasks, but tasks cannot expand the goal's scope, authority, deadline, or budget.
11.3 Durable execution semantics
Zero should study Temporal's event-history and replay model, but initially own a smaller local workflow engine rather than operate Temporal. Goal logic is deterministic; side effects occur in idempotent activities/capability invocations. The runtime persists the decision to dispatch before dispatching through a transactional outbox. Results are persisted before advancing. Timers are durable. Long tasks heartbeat and checkpoint. Retrying non-idempotent activities requires an explicit compensating or reconciliation strategy.
11.4 Overnight software goal safeguards
The overnight-development profile shall:
* operate only in a declared repository/worktree and path allowlist;
* snapshot the starting commit and dirty state;
* create a dedicated branch/worktree unless explicitly told otherwise;
* prohibit access to the work Mac, unrelated personal directories, password stores, and browser profiles;
* provide brokered, task-specific credentials rather than raw secret values;
* prohibit purchase, deployment, merge, push, destructive deletion, or external messaging unless separately approved;
* enforce wall-time, token, money, process, disk, and network budgets;
* checkpoint after plan, edits, tests, and verification;
* capture commands, diffs, test results, model calls, and exceptions;
* stop on repeated failure, scope uncertainty, suspicious prompt injection, or exhausted budget;
* leave a reviewable branch, summary, evidence, and unresolved questions in the morning.
The system may complete implementation autonomously; it may not redefine success or silently broaden scope.
12 Policy and permissions
12.1 Decision model
Every side effect evaluates:
principal + capability + target + input classification + context
+ goal authority + session grant + risk + time + export destination
-> ALLOW | ASK | DENY | ALLOW_WITH_CONSTRAINTS
Policies are versioned data. Decisions record matched rules, precedence, resolved facts, and constraints.
12.2 Permission states
State
	Meaning
	ALWAYS_ALLOWED
	Allowed whenever all policy constraints hold; revocable at any time
	ASK
	Requires a fresh user decision before dispatch
	SESSION_ALLOWED
	Allowed only within a named, time-bounded, scope-bounded session
	DENIED
	Prohibited; cannot be bypassed by an agent or lower-priority policy
	

Default is ASK for new low/medium-risk capabilities and DENIED for unknown, high-risk, or cross-boundary actions. SESSION_ALLOWED includes expiry, principal, capability patterns, target, data classes, and maximum counts/cost. ALWAYS_ALLOWED is never inferred from repeated approvals.
12.3 Risk tiers
* R0 Read-only: local status, public metadata.
* R1 Reversible: app open, display update, notification, draft creation.
* R2 Material: file edits, process execution, calendar modification, sharing private data.
* R3 Sensitive/destructive: delete, push, deploy, send message, unlock, purchase, secret access.
* R4 Prohibited by constitution: work-Mac interaction, policy bypass, secret exfiltration, disabling audit.
Physical confirmation may be required for selected R3 actions. Approval binds to a hash of the exact proposed effect; changing target, payload, or scope invalidates it.
12.4 Policy ordering
1.  Constitutional denies and revoked identities.
2.  Data/export restrictions.
3.  Capability/target denies.
4.  Goal authority ceiling.
5.  Session grants.
6.  Persistent permission.
7.  Automation rules.
8.  Default.
Higher-level deny wins. Policies cannot recursively trigger themselves without a causation guard and rate limit.
13 Security privacy and trust
13.1 Trust boundaries
[Owner UI] --local auth--> [zerod trusted core]
                             |  |  |
            -----------------   |   ----------------
            v                   v                  v
     [sandboxed agent]    [paired node]     [cloud integration]
      untrusted output    device identity     explicit export

[Oracle/work Mac]  OUTSIDE ZERO -- no pairing, no discovery action, no data path
The trusted computing base is zerod, its database/migrations, policy evaluator, identity code, secrets broker, and signed release/update path. UI, integrations, nodes, models, websites, prompts, and agent output are potentially compromised.
13.2 Threat model
Threat
	Example
	Required control
	Stolen node
	Lost iPhone sends commands
	device key, OS protection, remote revocation, short leases
	Rogue LAN device
	Spoofs ESP32 discovery
	discovery untrusted, mutual authentication, pairing proof
	Prompt injection
	README asks agent to leak secrets
	untrusted-content labeling, policy mediation, credential broker
	Compromised integration
	Cloud token abused
	least-scope tokens, isolation, rotation, audit, rate limits
	Malicious capability
	Node advertises file.read
	advertisement grants no authority; allowlists and schemas
	Replay/duplication
	Old unlock command reappears
	nonce/ID, expiry, sequence, idempotency, approval binding
	Runtime compromise
	Attacker reads all personal data
	OS account boundary, encryption, backups, minimized collection
	Physical ESP32 access
	Firmware/key extraction
	revocable per-device key, no broad secrets, optional secure boot
	Supply-chain attack
	Dependency or update compromised
	lockfiles, signed artifacts, SBOM, limited update authority
	Confused deputy
	Agent uses UI's broad privilege
	explicit principal propagation and delegated authority
	Data leakage
	Health context sent to model
	classification, export policy, minimization, export audit
	Availability loss
	Mac sleeps mid-goal
	durable checkpoints, reconnect, optional future Pi host
	

Zero does not promise protection against an attacker with full control of the logged-in personal Mac. It limits blast radius, provides evidence, and protects remote/node/cloud boundaries.
13.3 Data classification
Class
	Examples
	Default handling
	PUBLIC
	public repository metadata
	local or approved cloud
	INTERNAL
	device health, generic configuration
	local; approved service metadata allowed
	PRIVATE
	projects, routines, conversations, creator metrics
	local; explicit purpose-bound export
	SENSITIVE
	exact location, health, people, private content
	encrypted at rest where practical; ASK export
	SECRET
	tokens, private keys, credentials
	secret store only; never in prompts/logs/state payloads
	PROHIBITED
	Oracle/work-Mac data or credentials
	do not collect, store, process, or export
	

Every schema field may override its container classification upward. Derived data inherits the highest source class unless a reviewed declassification rule applies.
13.4 Secrets handling
* Apple Keychain is the initial root secret store. Database rows store opaque secret references.
* Node private keys remain on nodes; runtime signing keys remain in Keychain/Secure Enclave where available.
* Agents receive short-lived capability tokens or broker handles, not provider API keys.
* Secrets are never placed in event bodies, logs, traces, crash reports, prompts, CLI arguments, or environment dumps.
* Redaction occurs at ingestion and again at output sinks.
* Rotation and revocation are explicit operations with audit records.
* Backups encrypt sensitive database and configuration material with a separately recoverable key.
13.5 Cloud export policy
Each export decision includes destination, provider, purpose, fields, classification, retention expectation, model-training setting if known, goal, user grant, and estimated cost. The export filter selects the minimum context slice and produces a preview for SENSITIVE data. SECRET and PROHIBITED are never exportable. Provider adapters must declare whether requests are logged or retained; unknown treatment raises the risk level.
The audit stores hashes and metadata for sensitive exports by default, not an unnecessary duplicate of the exported content. A privacy dashboard answers: what left the Mac, where, why, when, under which grant, and how to revoke future access.
14 AI routing and cost model
14.1 Router inputs
The AI router selects no model, a local model, or a cloud model based on:
* task type and required capability;
* input classification and export policy;
* required context window and modalities;
* quality/reliability target;
* latency target and online status;
* per-call, daily, and per-goal budgets;
* cached prior result and deterministic alternatives;
* provider health and rate limits.
14.2 Routing ladder
1.  Deterministic parser/rule/template.
2.  Cached or previously verified result.
3.  Small local model.
4.  Small/cheap cloud model with minimized context.
5.  High-capability cloud model for justified tasks.
6.  Human clarification or refusal when policy/budget prevents a safe route.
Every call records provider/model, input/output token counts, latency, estimated and actual cost, classification, export decision, cache status, and goal/task. Budgets are hard ceilings. A model cannot authorize another model call beyond its delegated budget.
14.3 Quality controls
* Structured output schema validation and repair limits.
* Confidence is never treated as authorization.
* High-impact plans require deterministic checks or human review.
* Provider fallback cannot cross a stricter data boundary.
* Prompt and tool-output provenance is retained for debugging with classification-aware redaction.
* Evaluation suites cover intent parsing, tool selection, privacy leakage, and cost regression.
15 Agents and executors
Agents are untrusted planners/executors behind the same capability boundary as devices. An executor manifest declares supported task kinds, sandbox type, network policy, filesystem scope, maximum duration, checkpoint protocol, and required brokered credentials.
Preferred macOS isolation sequence:
1.  Dedicated worktree or temporary workspace.
2.  Child process with sanitized environment and explicit working directory.
3.  Filesystem allowlists enforced by the executor wrapper and OS sandbox where feasible.
4.  Network deny by default or destination allowlist.
5.  XPC helper for narrowly privileged Mac operations.
6.  Resource limits and process-group cancellation.
Agent output is evidence, not truth. Diffs, tests, generated artifacts, and claims are independently verified. External content is labeled untrusted. Agents cannot read approval tokens or write audit decisions.
16 Persistence and storage
16.1 SQLite layout
One SQLite database in WAL mode is the initial authoritative store, with schema migrations and online backups. WAL is appropriate because readers can continue while one writer appends, but the database must remain on local storage rather than a network filesystem.
Core tables:
nodes, node_keys, node_sessions, capabilities, capability_versions
events, event_stream_heads, state_values, context_evidence, context_current
intents, goals, goal_plans, tasks, task_attempts, timers
invocations, invocation_attempts, outbox, inbox_dedupe
policies, permission_grants, approval_requests, approval_decisions
memories, memory_sources, memory_embeddings, retention_jobs
integrations, secret_refs, cloud_exports, model_calls
audit_entries, schema_versions, migrations
Large blobs live in a content-addressed local object directory with hashes and database metadata. The event journal is append-only at the application layer. State, goals, invocation dispatch, and outbox rows use transactions.
16.2 Backups and recovery
* Scheduled SQLite online backup plus encrypted object-store snapshot.
* Retention: daily 14 days, weekly 8 weeks, monthly 12 months by default.
* Restore drills are part of release verification.
* Recovery validates hashes, schema version, key availability, and last durable sequence.
* Audit export can be independently verified through chained hashes; this is tamper-evidence, not an immutable external ledger.
17 Networking and connectivity
17.1 Local connectivity
* Local app/CLI to daemon: Unix-domain socket with peer credentials; a narrow HTTP or Connect/gRPC-like API above it.
* Node transport v0: TLS WebSocket for easy Go/Swift implementation and inspectability.
* LAN discovery: Bonjour/mDNS only as a locator.
* ESP32 profile: MQTT 5 over TLS if WebSocket resource/reconnect behavior proves inferior; shared Zero semantics remain unchanged.
* Loopback-only developer API is allowed; unauthenticated LAN listeners are not.
17.2 Remote iPhone connectivity
The preferred first production path is to run Zero over an existing Tailscale/WireGuard-style private network. This provides authenticated encrypted reachability and NAT traversal while Zero retains application-level node identity and authorization. Zero must not implement a VPN.
Fallback evolution:
1.  Direct encrypted peer path where available.
2.  End-to-end encrypted relay for commands when direct path fails.
3.  Push notification as a wake-up hint, never as the command payload or authority.
The relay stores ciphertext envelopes with recipient, expiry, and bounded metadata. It cannot decrypt application payloads. Remote node compromise is handled through per-node revocation.
17.3 Offline queues
Every capability declares one policy:
* REJECT: fail immediately if target offline.
* QUEUE_UNTIL: queue until a deadline.
* LATEST_ONLY: replace older pending work with the newest keyed invocation.
* REQUIRE_ONLINE_CONFIRMATION: do not queue because context may become unsafe.
Queued work captures the policy decision and context prerequisites. Before dispatch after reconnect, Zero revalidates identity, capability version, expiry, permission, goal state, and context preconditions. An old approval is not reused if the proposed effect changed.
17.4 Reconnection and synchronization
On reconnect, the node sends session resume token, last acknowledged server sequence, last emitted local sequence, capability digest, and clock diagnostics. The runtime:
1.  authenticates the new connection and prevents simultaneous stale sessions;
2.  reconciles capabilities;
3.  deduplicates uploaded events;
4.  sends missed durable messages still within retention;
5.  revalidates queued invocations;
6.  issues current LATEST state snapshots;
7.  marks synchronization complete.
Conflicts never use silent last-writer-wins for permissions, goals, or critical state. Domain-specific merge rules or owner resolution are required.
18 Observability and auditability
18.1 Correlation model
Every input receives a trace_id. Causation links form:
user input -> intent -> policy decision -> goal/task -> invocation
-> attempt -> node result -> event -> state/context change -> notification
The cockpit presents this as a human-readable explanation, while logs preserve structured detail.
18.2 Audit entry
Audit entries include actor/principal, action, target, decision, matched policy IDs/versions, grant, data classes, export destination, timestamps, correlation, result, error, cost, and redacted evidence hashes. Security-relevant entries form a hash chain and are periodically checkpointed in an owner-exportable file.
18.3 Metrics and diagnostics
* Node availability, heartbeat latency, reconnect count, queue depth.
* Event ingest lag, projection lag, duplicate rate.
* Capability success/latency by node and version.
* Goal age, task retries, stuck timers, budget consumption.
* Approval frequency and denial reasons.
* Model cost, latency, cache hit, structured-output failure.
* Database size, WAL/checkpoint health, backup age.
Local metrics default to no cloud export. Diagnostic bundles are generated explicitly and scrub secrets.
19 Failure and retry semantics
Failures are structured by domain: VALIDATION, AUTHENTICATION, AUTHORIZATION, UNAVAILABLE, DEADLINE, CONFLICT, RATE_LIMIT, RESOURCE, DEPENDENCY, EXECUTION, UNKNOWN_EFFECT, and INTERNAL.
Retry policy uses bounded exponential backoff with jitter, maximum attempts, deadline, and retryable codes. Circuit breakers prevent cascading failures. Retries preserve invocation ID but receive unique attempt IDs. Idempotency keys are scoped to target and capability version.
Operation
	Retry rule
	Read/status
	Safe bounded retry
	Idempotent state set/display latest
	Retry and dedupe
	File edit in isolated worktree
	Retry only from checkpoint or reconcile
	Message send/purchase/physical unlock
	Never automatic after uncertain dispatch
	Model request
	Retry only within budget and privacy-equivalent provider
	Goal task
	Retry according to task policy; stop before runaway loops
	

User-visible statuses must distinguish failed, delayed, cancelled, partially complete, and effect unknown.
20 Memory
Memory is curated retained knowledge, not the raw event log. Types include semantic facts, episodic summaries, procedural preferences, project state, and user-authored notes. Each memory has source evidence, creation time, confidence, classification, retention, last use, contradiction links, and deletion status.
Memory pipeline:
source -> consent/classification -> extraction -> candidate memory
-> dedupe/contradiction check -> retain -> retrieve -> cite provenance
-> decay/consolidate/delete
Raw conversations are not automatically permanent. Sensitive memories require explicit category policy. Retrieval filters by purpose and export destination before ranking. Embeddings are local by default; cloud embeddings require export approval. Deleting a source triggers review or deletion of derived memories.
21 Interfaces
21.1 Native macOS cockpit
Use Swift and SwiftUI for the primary shell, adding AppKit only where macOS-specific control or performance requires it. Zero.app is a client of zerod; closing the window does not stop the runtime.
Information architecture:
1.  Today: current context, active focus, time remaining, upcoming commitments, media, high-value suggestions.
2.  Goals: active/pending/blocked goals, task graph, budgets, checkpoints, agent progress, morning review.
3.  Environment: node map, health, capabilities, rooms/devices, queues.
4.  Activity: chronological causal timeline of events, actions, commits, sessions, and notifications.
5.  Memory: searchable facts and summaries with provenance, privacy, edit/delete controls.
6.  Automations: policies, triggers, recent firings, dry-run, disable controls.
7.  Privacy and permissions: grants, pending approvals, exports, secrets status, node revocation.
8.  Settings and diagnostics: integrations, runtime health, backup, cost, developer tools.
The global input is a command surface, not a chat transcript. It accepts natural language and explicit commands, shows the compiled intent, highlights side effects and cost, then provides live structured execution. Conversation history may be a view, not the organizing metaphor.
Key UX requirements:
* One-glance status without opening underlying apps.
* Every card shows freshness and source when ambiguity matters.
* Approvals show exact action, target, data crossing boundaries, and persistence of the grant.
* Why? opens the causal chain.
* Stop cancels a goal or process group, not merely the UI animation.
* Offline nodes and stale data are visually distinct.
* Advanced protocol/audit detail exists but stays behind disclosure.
21.2 Menu bar and notifications
Menu bar shows runtime state, current focus, active goal count, approval count, and quick actions. Notifications are reserved for required approval, meaningful completion/failure, safety stop, or important proactive suggestion. Zero must not become a notification generator.
21.3 CLI surface
zero status [--json]
zero nodes list|show|pair|revoke|ping
zero capabilities list|describe|invoke
zero events tail|query|replay
zero state get|set|watch
zero context show|assert|clear|explain
zero intent parse|run|explain
zero goals create|list|show|pause|resume|cancel|signal
zero approvals list|approve|deny
zero policies list|check|apply|disable
zero memory search|show|forget
zero integrations list|connect|disconnect|sync
zero privacy exports|grants|audit
zero costs today|goal|provider
zero doctor
zero dev simulate-node|inject-event|protocol-trace
All mutating commands support --dry-run; machine output has stable schemas and meaningful exit codes. Destructive commands do not accept a generic --force that bypasses policy.
21.4 Voice and physical interfaces
Voice is a later input/output adapter feeding the same intent pipeline. Wake word, audio retention, transcription destination, and recording indicator are explicit. Physical buttons emit authenticated events and can serve as approval factors only when enrolled for that purpose and resistant enough for the action's risk.
22 First nodes
22.1 ESP32 desk node
Minimum capabilities:
* display.render, display.clear, display.brightness.set;
* input.button event;
* sensor.presence or device-health telemetry if hardware supports it;
* OTA firmware update only after the display path is stable and signed-update verification exists.
Constraints:
* Static bounded buffers; maximum frame and schema complexity negotiated.
* No dynamic arbitrary JSON tree requirement in the final constrained profile.
* Backoff with jitter, watchdog, last-known safe screen, and queue-free telemetry.
* Device-specific key; no cloud or broad personal credentials.
* Latest desired display state is restored within 10 seconds after reconnect on a healthy LAN.
* Firmware version and reset reason are visible in node diagnostics.
The first useful display view shows active project, activity, focus duration, agent state, and runtime connectivity. The first button toggles or confirms a low-risk focus/session action; it does not begin as a destructive-action approval device.
22.2 iPhone remote node
The iPhone app uses Swift/SwiftUI and advertises only capabilities the user enables: notification delivery, shortcut invocation, coarse or precise location, capture/share, and remote command submission. iOS background limits mean presence and heartbeat are opportunistic; push wakes the app but conveys no authority.
Required flows:
* QR-assisted pairing with the home runtime.
* View home-Mac status and active goals remotely.
* Submit a command while the Mac is offline and see queued, expiry, and cancellation.
* Receive approval request and bind biometric confirmation to the exact action hash.
* Reconnect without duplicate execution.
* Remotely revoke the phone from the Mac; locally wipe enrollment from the phone.
22.3 Future Raspberry Pi
The Pi can become an always-on node, relay, integration host, or runtime candidate. It does not automatically become master. Runtime-host migration requires encrypted backup transfer, database integrity checks, epoch/lease fencing, owner confirmation, and rollback. Until that protocol exists, the Pi is a worker/gateway, while the personal Mac remains authoritative.
23 Integrations
Integrations translate external systems into capabilities, events, and state. Each manifest declares authentication type, scopes, polling/webhook behavior, rate limits, data mapping, classifications, export destinations, and revocation behavior.
Initial priorities:
1.  Local Mac: repository status, applications, processes, notifications, focus timer.
2.  Codex/agent execution: task state and bounded local coding jobs.
3.  Git: commits, branches, worktrees, tests; GitHub only when needed.
4.  Spotify or current media: track state and controls under user permission.
5.  Calendar: upcoming personal commitments with minimized content.
6.  Creator metrics and publishing state.
7.  Health/location only after privacy controls and iPhone integration are mature.
An integration outage degrades only its projections and capabilities. It may not stall the core.
24 Technology choices and prior art
24.1 What to reuse and what to own
Area
	Reuse/study
	Zero should own
	LAN discovery
	mDNS/DNS-SD and Bonjour
	pairing UX, node semantics, trust decision
	Live transport
	WebSocket/TLS initially
	envelopes, delivery classes, lifecycle, errors
	Constrained messaging
	MQTT 5 sessions, QoS, retained/latest ideas
	capability and event semantics; permission revalidation
	Rich event bus
	NATS Core/JetStream request-reply and durable stream concepts
	application journal initially; adoption only if operational value emerges
	Persistence
	SQLite transactions, WAL, backup APIs, FTS
	domain schema, projections, migrations, retention
	Secure remote links
	Tailscale/WireGuard, NAT traversal, encrypted relay patterns
	Zero node identity, authorization, queues, E2E command envelope
	Capability security
	object-capability/delegation patterns, macaroons-like caveats
	user permission vocabulary, grants, approval binding
	Event conventions
	CloudEvents field conventions, trace/correlation patterns
	Zero event taxonomy, classification, retention, causation
	Durable workflows
	Temporal event history, replay, activities, timers, idempotency
	smaller local goal engine and personal safety profiles
	Home automation
	Home Assistant entity/device registry and event ideas
	personal context, goals, developer work, unified permission model
	Interoperable devices
	Matter commissioning, identity, data-model concepts
	do not implement Matter; bridge only where useful
	Models
	local runtimes and provider APIs
	policy-aware routing, cost ledger, context minimization
	macOS lifecycle
	launchd, ServiceManagement, XPC
	zerod domain API and capability brokers
	macOS UI
	SwiftUI, AppKit where necessary
	cockpit information architecture and intent experience
	

24.2 Transport decision
Option
	Strength
	Cost/problem
	Decision
	Raw WebSocket
	simple, ubiquitous, bidirectional, debuggable
	Zero must implement reconnect, durable outbox, subscriptions
	Use for v0 desktop/mobile
	MQTT 5
	excellent constrained clients, QoS/session/retain support
	broker/topic semantics can leak into domain model; request-reply is conventional
	Evaluate/use for ESP32 profile
	NATS
	elegant request-reply/pub-sub; JetStream durability; leaf-node model
	another broker and operational surface; embedded footprint/client availability
	Study, defer adoption
	

NATS Core is best-effort/at-most-once, while JetStream adds persistence and stronger delivery modes. That reinforces the need to declare semantics per message rather than assuming a transport makes effects exactly once. Zero should begin with one runtime-owned journal and outbox. Adopt NATS only if multiple always-on processes, fan-out, or leaf topology create measured pressure.
24.3 Platform rationale
* Go core and CLI: good concurrency/networking, static binaries, cross-compilation, low operational burden.
* Swift/SwiftUI: native macOS/iOS UX and platform security/lifecycle access; bridge AppKit selectively.
* SQLite: correct scale and ownership model for a single-host core; WAL supports concurrent readers but stays on local disk.
* XPC: isolates unstable or privileged Mac integrations. XPC helpers should be narrow and close to stateless; launchd/ServiceManagement manages lifecycle.
* C++/ESP-IDF or Arduino: choose ESP-IDF for production protocol/security control; Arduino is acceptable for the first display spike if the protocol boundary remains portable.
25 Repository and monorepo structure
project-zero/
 README.md
 PROJECT_ZERO_SPEC.md
 go.work
 docs/
   adr/
   protocol/
   threat-model/
   runbooks/
 proto/
   schemas/
   fixtures/
   conformance/
 core/
   cmd/zerod/
   runtime/
   identity/
   protocol/
   registry/
   capabilities/
   events/
   state/
   context/
   intents/
   policy/
   goals/
   executors/
   memory/
   integrations/
   audit/
   storage/
 cli/
   cmd/zero/
 apps/
   macos/Zero.xcodeproj
   ios/ZeroMobile.xcodeproj
   shared-swift/
 sdk/
   go/
   swift/
   esp32/
 nodes/
   mac/
   esp32-desk/
   simulator/
   raspberry-pi/
 integrations/
   git/
   codex/
   spotify/
   calendar/
 tests/
   integration/
   protocol/
   simulation/
   hil/
 tools/
   schema-gen/
   fixtures/
   dev-ca/
 deploy/
   launchd/
   packaging/
Generated SDK models come from canonical schemas. Domain logic must not be generated. Cross-language fixtures are committed and versioned.
26 SDK strategy
26.1 Go SDK
First and reference implementation. It includes transport interface, session state machine, generated messages, capability server/client, event publisher, reconnect, idempotency helpers, structured errors, and in-memory test transport. The core uses the public SDK where practical to prevent a privileged private protocol dialect.
26.2 Swift SDK
Native async/await API over Network.framework/WebSocket, Keychain identity, Bonjour discovery, background-aware reconnection, Codable message models, and Combine/Observation adapters for UI. Swift conformance tests replay the same fixtures as Go.
26.3 ESP32 SDK
Small C/C++ library with fixed-size buffers, transport abstraction, CBOR/JSON profile selection, device identity hooks, heartbeat, capability table, bounded retry, watchdog integration, and no heap growth after startup where feasible. Compile-time feature flags remove goals/state features not needed by constrained nodes.
27 API and schema governance
* Canonical schemas live in proto/schemas; examples never define behavior independently.
* IDs are sortable opaque identifiers; clients must not parse embedded meaning.
* Error codes and lifecycle states are registries with reserved ranges.
* Schema changes require compatibility tests against the previous supported release.
* ADRs document transport, identity, storage, policy, and goal-engine changes.
* Protocol conformance is behavioral: negotiation, duplicate delivery, expiry, reconnect, unknown fields, and failure states, not merely JSON validation.
* Semantic versioning applies to protocol and SDKs; repository releases publish a compatibility matrix.
28 Testing strategy
28.1 Unit tests
State machines, policy precedence, schema validation, context conflict resolution, budget enforcement, retries, redaction, migrations, and deterministic goal replay. Property-based tests cover idempotency, ordering gaps, duplicate events, and permission invariants.
28.2 Integration tests
Run real zerod with temporary SQLite and simulated nodes. Test pairing, registration, capability invocation, restart recovery, approvals, outbox, model adapter failure, and encrypted secret references.
28.3 Protocol conformance
Language-neutral golden fixtures and adversarial traces cover:
* unsupported versions and unknown fields;
* malformed/oversized frames;
* duplicate IDs and replay attempts;
* clock skew and expired messages;
* reconnect from every lifecycle state;
* capability upgrade/downgrade;
* loss before/after dispatch and UNKNOWN_EFFECT;
* backpressure and slow consumers;
* revoked key during an active session.
28.4 Simulation and chaos
A virtual clock and node simulator create hundreds of nodes, sleep/wake cycles, packet loss, duplication, reordering, disk-full, process kill, database busy, and provider outage. Goal replay runs after randomized crash points and must reach the same logical state without duplicate effects.
28.5 Hardware in the loop
An ESP32 test jig controls power and Wi-Fi, captures serial output, verifies display checksum/state, presses a button electronically if possible, and flashes known firmware. Tests measure cold boot, key retention, reconnect, queue behavior, malformed input rejection, OTA rollback, and 24-hour soak stability.
28.6 Security and privacy tests
Threat-model abuse cases, secret-scanning, dependency scanning, signed-build checks, authorization matrix tests, prompt-injection corpus, export minimization snapshots, and audit completeness. A CI assertion forbids literal Oracle/work-device identifiers, credentials, or enrollment code outside explicit test-deny fixtures.
29 Roadmap and acceptance criteria
Stages are gates, not dates. A stage is complete only when its acceptance criteria are demonstrated and recorded.
Stage v0 Foundation Mac plus simulator
Scope: Go daemon, SQLite, Unix-socket API, CLI, protocol envelopes, simulator, basic event/state/capability routing, audit.
Acceptance:
* zerod starts through a development launch agent and survives restart.
* CLI lists runtime and simulated node status.
* A simulated node registers, advertises display.render, receives an invocation, and returns a correlated result.
* Events persist and rebuild state after deleting projections.
* Duplicate invocation/event fixtures do not duplicate effects/state.
* Every invocation shows principal, policy decision, target, result, and causal trace.
* Core unit, integration, and protocol tests pass offline.
Stage v0.1 Physical proof ESP32
Scope: paired ESP32 desk display and button, LAN discovery, reconnect.
Acceptance:
* Device pairing verifies fingerprint/code and stores a unique device key.
* Device appears online/offline according to lease semantics.
* zero capabilities invoke desk-display-01 display.render ... updates real hardware.
* Power or Wi-Fi interruption followed by reconnect restores the latest desired screen within 10 seconds.
* Repeated delivery does not produce duplicate button actions.
* Malformed/oversized messages fail safely; 24-hour soak has no unbounded memory growth.
Stage v0.2 Useful personal loop
Scope: project/focus context, Git/Codex status, media, policy automation, menu bar.
Acceptance:
* zero run "work on Project Zero" compiles to a reviewable intent and starts a focus session without requiring a cloud model for known phrasing.
* Mac and desk display show project, elapsed focus, repository status, and agent completion.
* Context dimensions coexist with provenance and can be manually overridden.
* At least three personal automations run for two weeks with fewer than 5% incorrect firings and one-click disable.
* Model use and cost are visible; local deterministic operation still works without internet.
Stage v0.3 Native macOS cockpit
Scope: Today, Goals, Environment, Activity, Automations, Privacy, global input.
Acceptance:
* The app remains responsive while zerod or an integration restarts.
* The user can understand current context, nodes, active goal, and pending approval in under 10 seconds.
* A natural-language action shows compiled intent and side effects before sensitive execution.
* Why? reconstructs a complete causal chain.
* The app can cancel a real running executor and confirm process termination.
* Closing the app leaves the runtime and permitted goals running.
Stage v0.4 Security and unattended goals
Scope: permissions/grants, secret broker, agent sandbox, durable goal engine, backups.
Acceptance:
* All four permission states work with precedence, expiry, target, and scope.
* An agent completes a bounded repository task after a runtime restart without receiving raw credentials.
* A simulated prompt injection cannot cause access outside the declared worktree or export private context.
* Unknown-effect handling prevents automatic retry of a non-idempotent action.
* Encrypted backup restores on a clean profile; an automated restore drill passes.
* An overnight job stops on budget exhaustion and leaves a reviewable partial result.
Stage v0.5 Remote iPhone
Scope: iOS node, secure remote path, relay/queue semantics, biometric approvals.
Acceptance:
* Phone pairs locally, then connects remotely without exposing a public inbound port on the Mac.
* A command submitted while the Mac is offline is visibly queued, can be cancelled, expires correctly, and executes once after reconnection.
* A biometric approval is bound to the exact action and cannot approve a modified payload.
* Relay operators cannot read command payloads.
* Revoking the phone blocks new sessions and invalidates queued commands from it.
Stage v1 Thesis milestone
Scope: coherent Mac, iPhone, ESP32 system; goals; memory; security; polished demonstration and evaluation.
Acceptance:
* Three real node classes pass one shared protocol conformance suite.
* A seven-day reliability run recovers from sleep, network changes, process crashes, and node power loss without database repair or duplicate material effects.
* The owner uses Zero on at least 20 of 30 days and retains at least five genuinely useful automations/capabilities.
* One persistent coding goal runs unattended for at least four hours, survives interruption, and returns tested, reviewable work within scope and budget.
* The privacy dashboard accounts for every cloud/model export in the demonstration period.
* Threat model, protocol, ADRs, test results, hardware design, evaluation, and limitations are thesis-ready.
* The unforgettable demo below succeeds from a clean, documented setup.
Beyond v1
* Raspberry Pi as optional always-on runtime candidate with lease-fenced migration.
* Multiple physical nodes, sensors, lighting, NFC, custom PCBs, and richer ambient displays.
* Voice input with local wake word and explicit audio policy.
* More capable memory consolidation and personal analytics.
* Matter/Home Assistant bridges where they unlock hardware without subsuming Zero's model.
* Local-first synchronization between owner-controlled runtime hosts, only after single-writer transition is proven.
* Public SDK/specification only if it improves the personal system; never at the expense of its purpose.
30 Unforgettable demo narrative
It is late evening. The Mac cockpit shows a normal personal dashboard: tomorrow's first commitment, 52 minutes of focus, the current track, two online nodes, and no pending approvals. The desk display reads PROJECT ZERO — BUILDING.
The owner opens the global Zero bar and writes:
Add resilient ESP32 reconnection to Project Zero. Get it working by morning. You may edit only the Zero repository, run local tests and the hardware simulator, and spend up to $3 on models. Do not push or deploy. Ask me only if scope must expand.
Zero compiles the sentence into a persistent goal. The cockpit shows the desired outcome, path allowlist, prohibited actions, budget, success tests, and review policy. The owner grants a session-scoped overnight profile.
The phone leaves the home network. The Mac sleeps briefly. The ESP32 loses Wi-Fi. The agent process crashes once. Zero's activity view records each failure, resumes from durable checkpoints, and does not repeat already-completed effects. The desk node reconnects and restores its latest display. The owner checks the phone from elsewhere: the goal is running, $0.84 spent, one test failing, no action required.
In the morning the phone says only: Project Zero goal ready for review. The cockpit presents a branch and diff, tests, simulator trace, hardware reconnect evidence, cost, data exports, and one remaining caveat. The owner asks Why did you change the heartbeat logic? Zero traces the answer through the failed test, protocol requirement, agent decision, and commit. Nothing was pushed. No secret reached a model. The work Mac never participated.
The owner cuts Wi-Fi to the ESP32. It reconnects, the display returns within 10 seconds, and the cockpit timeline proves what happened. The physical button marks the review accepted. The display changes to:
PROJECT ZERO
GOAL COMPLETE
MAC + PHONE + DESK
ONE SYSTEM
The memorable point is not that an AI wrote code. It is that a personally owned distributed runtime understood a durable goal, enforced boundaries, coordinated software and hardware across failure, and explained itself.
31 Architecture decisions to record first
1.  ADR 0001: Go modular monolith and SQLite/WAL.
2.  ADR 0002: Zero Protocol semantics over transport-neutral bindings.
3.  ADR 0003: WebSocket/TLS v0 and MQTT evaluation criteria for ESP32.
4.  ADR 0004: local node key identity, pairing, enrollment, and revocation.
5.  ADR 0005: append-only events plus materialized state.
6.  ADR 0006: permission precedence and approval binding.
7.  ADR 0007: durable goals with outbox, checkpoints, and unknown-effect state.
8.  ADR 0008: Keychain-backed secret references and executor credential broker.
9.  ADR 0009: Tailscale/WireGuard substrate for first remote release.
10.  ADR 0010: SwiftUI cockpit as client, zerod as authority.
32 Implementation rules for Codex
When implementing from this specification:
1.  Start with the smallest vertical slice satisfying the current stage; do not prebuild later-stage infrastructure.
2.  Preserve the named domain boundaries even inside one process.
3.  Write or update schemas and behavioral tests before adding a protocol message.
4.  Treat every external input, model output, integration payload, and node advertisement as untrusted.
5.  Route every side effect through capability invocation and policy; no hidden bypasses in UI or integrations.
6.  Propagate principal, trace, causation, classification, and goal/task IDs.
7.  Make retry and idempotency behavior explicit for every capability.
8.  Never add work-Mac access, work credentials, or work context.
9.  Research maintained libraries and standards before implementing infrastructure; document the choice in an ADR.
10.  Prefer a boring dependency over a custom subsystem unless Zero owns meaningful semantics there.
11.  Do not claim completion without automated evidence proportional to risk and, for hardware milestones, real-device evidence.
12.  Keep this file current. A conflicting implementation is a bug unless an ADR explicitly changes the specification.
33 Known risks and mitigations
Risk
	Consequence
	Mitigation
	Scope explosion
	Dead repository
	stage gates, vertical slices, usage metric, defer generic platform work
	UI-first development
	Attractive shell without runtime integrity
	CLI/protocol/runtime acceptance before cockpit polish
	Agent-wrapper drift
	Zero becomes prompt plus tools
	deterministic state/policy/goal machinery and transport-independent tests
	Overbuilt distribution
	High operational burden
	modular monolith, single writer, external secure network
	Underbuilt durability
	Overnight goals duplicate or vanish
	transactional outbox, replay tests, unknown-effect state
	Privacy creep
	Personal surveillance and cloud leakage
	purpose/classification/retention, export dashboard, deletion
	ESP32 constraints ignored
	Protocol unusable on physical nodes
	bounded profile, HIL tests, CBOR after schema stability
	iOS background assumptions
	False online presence
	opportunistic lifecycle, push as wake hint, queues
	Model bills
	Personal system becomes expensive
	routing ladder, cache, hard budgets, cost visibility
	Single Mac availability
	Tasks stop during sleep/outage
	durable resume first; Pi runtime migration later
	Security theater
	Complexity without meaningful protection
	threat-driven controls, small TCB, established crypto/networking
	

34 Open questions for staged resolution
These are deliberately not blockers for v0:
* Exact WebSocket framing library and whether a Connect/gRPC local API improves Swift interoperability.
* MQTT broker/client choice after measuring ESP32 WebSocket memory and reconnect behavior.
* JSON Schema versus Protobuf as canonical schema source after the first cross-language SDK spike.
* Whether macOS App Sandbox constraints favor an app-bundled XPC service plus separately installed LaunchAgent.
* Which local model runtime offers the best privacy/latency tradeoff on the owner's Mac.
* Relay ownership and discovery if Tailscale is unavailable.
* Memory retention defaults for conversations, location, health, and people.
* Physical approval factor requirements for future high-risk hardware actions.
* Formal thesis evaluation metrics beyond reliability, latency, cost, and longitudinal use.
Each question becomes an ADR only when its stage approaches and evidence is available.
35 Reference sources
* Apple, *Bonjour* and networking guidance: https://developer.apple.com/bonjour/ and https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api
* Apple, *XPC* and daemon/service architecture: https://developer.apple.com/documentation/XPC and https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html
* OASIS, *MQTT Version 5.0*: https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html
* NATS documentation, Core, JetStream, WebSocket, and leaf-node concepts: https://docs.nats.io/
* SQLite, *Write-Ahead Logging*: https://www.sqlite.org/wal.html
* Tailscale, *How Tailscale works* and WireGuard concepts: https://tailscale.com/blog/how-tailscale-works and https://tailscale.com/docs/concepts/wireguard
* Temporal, workflow execution and activities: https://docs.temporal.io/workflow-execution and https://docs.temporal.io/activities
* Home Assistant developer architecture: https://developers.home-assistant.io/docs/architecture/core/
* CloudEvents specification: https://cloudevents.io/
* Connectivity Standards Alliance, Matter: https://csa-iot.org/all-solutions/matter/
36 Definition of success
Project Zero succeeds when it is trusted enough, useful enough, and understandable enough to remain running; when the owner reaches for it instead of a collection of disconnected apps; when new hardware and software make the same environment more capable; when an unattended goal can survive the night without escaping its authority; and when the system's history can show exactly what happened.
The thesis is the milestone. Continued personal use is the proof.
Project Zero  •
