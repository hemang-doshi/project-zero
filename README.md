# Project Zero

**Project Zero is a local-first personal runtime for explicit, explainable automation.** A local daemon owns committed state; the CLI and desktop clients display that state and submit typed actions. Optional integrations and an ESP32 desk node are bounded clients of the runtime.

This repository is released under the [MIT License](LICENSE). The current source snapshot identifies the runtime as **0.2.0, build 0.2.0-8**. The Electron package has its own package version (**1.0.0**). These version tracks are intentionally distinct. This is a source release; signed installers and hardware acceptance are not implied.

## Components

- `core/` — Go runtime, local API, state storage, identity and policy.
- `cli/` — `zero` command-line client.
- `apps/desktop/` — Electron, React and TypeScript desktop cockpit.
- `apps/macos/` — native macOS menu app, observer and audio helper.
- `nodes/` — ESP32 desk-node firmware and simulator.
- `proto/` — versioned JSON schemas and public test fixtures.
- `sdk/` and `integrations/` — Go client SDK and integrations.

## Security model

Zero is designed to run on an owner-controlled machine. Local state is managed by `zerod`; mutating requests pass through typed runtime actions and policy checks. Runtime identity uses the macOS Keychain on supported macOS builds. The local API uses an owner-only Unix socket. The optional node listener binds to loopback by default; LAN exposure requires explicit configuration and enrolled client certificates.

Zero is not a hosted service, a multi-tenant server, or a security boundary against an attacker who controls the user account or machine. Review [SECURITY.md](SECURITY.md) before exposing a listener or pairing a device. Never commit enrollment material, private keys, Wi-Fi credentials, runtime databases, signing identities, or recovery backups.

## Requirements

- Go 1.25 or newer.
- Node.js 22 or newer and npm for the Electron app.
- macOS 14 or newer and Xcode Command Line Tools for native apps and Keychain-backed identity.
- Python 3 for repository helper scripts and tests.
- ESP-IDF 5.5.2 for firmware builds; see [firmware development](docs/firmware.md).

The production runtime identity path requires macOS and CGO. Other platforms can build parts of the Go code, but do not provide the production Keychain identity backend.

## Build and run the local runtime

```sh
go mod download
make build
mkdir -p "$HOME/ProjectZero-dev"
bin/zerod --data "$HOME/ProjectZero-dev" --local-only
```

In another terminal:

```sh
bin/zero --socket "$HOME/ProjectZero-dev/zero.sock" status
bin/zero --socket "$HOME/ProjectZero-dev/zero.sock" doctor
```

This uses a separate development data directory. Do not point a development daemon at a production database. The local-only mode does not start the node listener.

## Electron desktop app

```sh
cd apps/desktop
npm ci
npm run dev
```

The Electron client connects to the local runtime socket under `~/Library/Application Support/ProjectZero/zero.sock`. Start a compatible local runtime separately. The repository does not include a signed or notarized installer; `npm run build` creates an unsigned development build. Packaging and signing depend on an owner-managed Apple Developer identity and are not performed by public CI.

## Native macOS apps

```sh
swift test --package-path apps/macos
swift build --package-path apps/macos
```

For the native development workflow, see [development and release](docs/development.md). Installing or replacing a runtime on a personal Mac is a separate, explicit operation.

## Development checks

```sh
make test
python3 tools/release-gen.py --check
python3 tools/schema-gen.py --check
cd apps/desktop
npm ci
npm test
npm run typecheck
npm run lint
```

The firmware host fixtures and ESP-IDF build are separate: `bash tools/test-firmware.sh`. A successful host build does not establish physical hardware acceptance. See [firmware development](docs/firmware.md).

## Versions

`core/release/manifest.json` is the source for the runtime product version, build identifier, wire protocols, render schemas and database version. Run `python3 tools/release-gen.py --check` to verify generated language bindings. Do not infer wire compatibility from the product version. Electron's npm package version is managed independently in `apps/desktop/package.json`.

Release notes and known limitations are in [CHANGELOG.md](CHANGELOG.md). For architecture, see [docs/architecture.md](docs/architecture.md).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first. Security issues should be reported privately using GitHub's **Report a vulnerability** feature.
