# Codex boundary recheck

Status: BLOCKED for full desktop turn outcomes. The approved bounded investigation ended after reproducing the same interface incompatibility; no model requests were made.

Installed CLI: 0.153.4. `codex app-server daemon version` fails because the supported app-server-control socket does not exist. Read-only socket inspection of the running app-bundled codex process finds connected unnamed Unix sockets, no named attachment socket and no TCP listener. Daemon help offers bootstrap/start/restart for a managed server, not adoption of an already-running desktop-owned service. Starting that separate server would not prove observation of the desktop-owned task.

Generated protocol includes thread/loaded/list, thread/read, thread/status/changed and turn/completed. Their existence does not provide an attachment transport. No task was resumed, no private history/database was queried and no remote-control configuration was changed. Hooks still cannot establish a terminal success/failure outcome.

Required upstream contract: a supported authenticated attachment endpoint for the actual desktop-owned service, with lifecycle subscriptions and reconnect/read semantics. No further scheduled probes. Revisit only when that contract or installation changes.

Optional parsing remains disabled: the pinned ThreadStart contract supports configuration overrides and additional dynamic tools, but an enforced complete no-tools/no-context boundary has not been proven. An empty dynamic tool list does not prove built-in tools are disabled. No credentials copied and no export/model request performed. This is an unverified capability gate, not a claim that every Codex version lacks such a mode.
