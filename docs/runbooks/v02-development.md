# v0.2 development preview

This is an independent development runtime. The physical desk node stays on
v0.1 for its soak. Do not install the development binary over bin/zerod or
flash the new firmware while that evidence is being collected.

## Build

```sh
go build -o .runtime/v02-build/zerod ./core/cmd/zerod
go build -o .runtime/v02-build/zero ./cli/cmd/zero
python3 tools/build-macos.py
```

The Swift package has no external package dependencies. macOS 14+ is required.
App bundles are ad-hoc signed for local development, not notarized releases.
A rebuild can require macOS to reapprove automation access.

## Run in isolation

```sh
.runtime/v02-build/zerod --local-only --data .runtime/v02-dev \
  --mac-observer "$PWD/.runtime/v02-build/Zero Observer.app/Contents/MacOS/ZeroMacObserve"
```

The current checkout already has a one-shot development LaunchAgent loaded as
`dev.projectzero.v02-development`; do not launch a second daemon on its socket.
Stop it with `launchctl bootout gui/$(id -u)/dev.projectzero.v02-development`.
This does not stop the v0.1 daemon or soak collector.

```sh
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock projects add \
  project-zero 'Project Zero' "$PWD" Zero
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock run 'work on Project Zero'
open .runtime/v02-build/Zero.app --args --socket "$PWD/.runtime/v02-dev/zero.sock"
```

Project Zero has already been registered in the current development database.
Register other repositories only through an explicit projects add command.
Use `session end` before switching focus projects. Legacy `session start NAME`
still works without registration for compatibility; registered projects are
required for repository observation.

## Integrations and rules

Connect Git, then enable git-refresh to refresh every 15 seconds during focus.
The current development profile has Git, git-refresh and focus-break enabled.
Fresh profiles start disconnected with rules disabled.

Connect Spotify in the menu panel to request read-only local application
access. Approve the macOS automation prompt locally if desired; no password or
credential should be sent to Zero. Denial leaves Spotify unavailable and focus
operational. Zero does not launch Spotify or control playback.

Enable focus-break for reminders at each 45 accumulated active minutes.
Use Allow macOS reminders to permit banners; without permission, reminders
remain visible in the panel and as a menu-bar indicator. Turning off the rule
cancels pending deliveries. A crash after a delivery claim leaves DELIVERING,
which represents an uncertain outcome and is not automatically retried.
Closing the menu app leaves runtime state and pending reminders intact.

`policies history`, `policies review ID correct|incorrect|unreviewed`, and
`policies report` expose firings and reviewed error rates. Reports use UTC days;
a null rate means no reviewed firings, not zero incorrect firings.

## Explain and override

```sh
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock context show
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock context assert attention meeting
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock context explain
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock context clear attention
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock intent parse 'work on Zero'
.runtime/v02-build/zero --socket .runtime/v02-dev/zero.sock costs today
```

New resources carry representation version 0.2 on the existing owner Unix
HTTP route family /v0.1/. Existing command envelope and node protocol remain
0.1. New fields are additive. Extended display fields are sent only after the
node advertises render_schema 0.2; older nodes retain focus-only payloads.

## Deliberately unavailable

Codex task observation, its completion automation, and optional model parsing
are not connected. No model calls are performed; account costs are unknown.
The metadata-only hook probe has unit tests but no proven desktop delivery;
see codex-hook-experiment.md. The full 14-day evaluation has not started.
The combined desk firmware is built, not flashed or physically accepted.

## Verification

```sh
make test
go vet ./...
swift test --package-path apps/macos
ZERO_TEST_SOCKET="$PWD/.runtime/v02-dev/zero.sock" swift test --package-path apps/macos
make firmware-test
```

The native live-socket test intentionally skips unless ZERO_TEST_SOCKET is
set. Core Go tests use offline module resolution after dependency installation.
