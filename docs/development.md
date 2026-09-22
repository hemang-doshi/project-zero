# Development and Release

## Local development data

Use a new directory for development. Do not reuse a production database, socket, signing identity, or enrolled node identity.

```sh
go mod download
make build
mkdir -p "$HOME/ProjectZero-dev"
bin/zerod --data "$HOME/ProjectZero-dev" --local-only
```

In a second terminal, inspect the isolated runtime:

```sh
bin/zero --socket "$HOME/ProjectZero-dev/zero.sock" status
bin/zero --socket "$HOME/ProjectZero-dev/zero.sock" doctor
```

Stop the foreground daemon with Ctrl-C. The local-only mode has no network listener.

## Desktop clients

Electron development requires Node.js 22+:

```sh
cd apps/desktop
npm ci
npm run dev
```

Native macOS builds and tests require macOS 14+ and Xcode Command Line Tools:

```sh
swift test --package-path apps/macos
swift build --package-path apps/macos
```

## Checks

Use the commands in the root README. Firmware source tests use the pinned ESP-IDF release and do not flash hardware. Hardware provisioning and flashing are deliberately not part of CI.

## Version and release process

1. Update `core/release/manifest.json` for runtime product/build, wire, render-schema, or database changes. Regenerate bindings with `python3 tools/release-gen.py` and schema output with `python3 tools/schema-gen.py` as needed.
2. Update `CHANGELOG.md`; keep Electron's package version in `apps/desktop/package.json` independently versioned.
3. Run relevant local checks and review the exact staged files for secrets, local paths, binary build output, and private operational data.
4. Merge through a pull request after GitHub Actions pass.
5. Create an annotated `vX.Y.Z` tag only for a reviewed release commit. Public CI does not sign or notarize macOS apps. Signing identities and credentials must remain in owner-managed secret storage and must never be committed.

A source tag does not certify hardware acceptance. Record hardware evidence separately and make the release notes precise about what was and was not physically verified.
