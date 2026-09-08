# v0.2 prerequisite checkpoint

Status: gate 1 BLOCKED; dependent product implementation has not started.

## Completed

- Approved design and execution checklist saved on build/v0.2.
- Existing Go race and Python baseline suite passes (`make test`, exit 0).
  Existing macOS LC_DYSYMTAB linker warnings remain.
- Repaired the PATH-visible standalone `codex` command: `codex --version`
  returns `codex-cli 0.153.4`.
- Generated 304 non-experimental protocol schema files from that executable.
  Binary and schema bundle hashes recorded in v02-codex-toolchain.json.
- Live zerod binaries/data and ESP32 firmware were not changed or restarted.
  Soak remains running; latest inspection reported zero serial errors and only
  its known initial setup reset. Full 24 hours have not elapsed.

## Exact desktop-observation blocker

Both the app-bundled and repaired standalone executables fail:

```
codex app-server daemon version
codex app-server proxy
```

The supported default control socket
`~/.codex/app-server-control/app-server-control.sock` does not exist.
Read-only lsof inspection of the running local Codex process showed connected
unnamed Unix sockets and no TCP listener or named attachable Unix listener.
There is no supported attachment endpoint available in this installation that
has been demonstrated to expose the desktop-owned task lifecycle.

No desktop task was resumed, no replacement server was started, no remote
control was enabled, and no conversation/database/UI scraping was performed.
A new server would not establish observation of the existing task-owning
service. Real completion/reconnect/deduplication therefore remains unproven.

Unblocking requires a supported endpoint on the desktop task-owning service,
or an explicit design change to the observation mechanism or delivery gate.
Do not interpret a separate server's notLoaded/idle state as task completion.
Independent v0.2 subsystems remain planned, not implemented, under the approved
sequence's prerequisite gate.

## Standalone toolchain repair and restoration

The npm wrapper installed at version 0.153.4, but its native optional dependency
failed repeatedly during TLS download. No TLS verification was disabled.
A verified working binary was copied from the installed desktop application to
`~/Library/Application Support/ProjectZero/toolchains/codex-0.153.4/codex`.
`/opt/homebrew/bin/codex` now links to that pinned copy. This does not modify
app resources, credentials, or the running desktop process.

Private installation receipt: .runtime/v02-toolchain/install.json.
To return command resolution to the npm package after its native dependency is
repaired, replace only the /opt/homebrew/bin/codex symlink with target
`../lib/node_modules/@openai/codex/bin/codex.js`. The older /usr/local/bin/codex
installation was left untouched; the functioning Homebrew command takes PATH
precedence in the verified shell. App updates do not alter the pinned copy.
