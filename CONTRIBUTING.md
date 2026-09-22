# Contributing

Thanks for helping improve Project Zero. For a substantial change, open an issue or draft pull request first so the intended behavior and affected runtime boundary are clear.

## Local setup

Install Go 1.25+, Python 3, Node.js 22+ for Electron work, and Xcode Command Line Tools for native macOS work. ESP-IDF 5.5.2 is needed only for firmware builds. See the root README and `docs/` for build instructions.

## Before opening a pull request

- Keep changes focused and preserve the existing architecture and data-safety rules.
- Add or update regression coverage for changed behavior.
- Run the relevant checks from the README and include the results and platform in the PR description.
- Do not include `.runtime`, `bin`, build output, personal configuration, credentials, pairing material, device backups, or generated files.
- Update user-facing documentation and version/schema metadata when behavior or compatibility changes.

Do not flash a device, install a LaunchAgent, use production data, or change credentials as part of a contribution check. Ask maintainers before proposing changes that affect provisioning, identity storage, network exposure, authorization, migrations, or release signing.

## Pull requests

Describe the problem, behavior change, compatibility impact, and verification. Link related issues. Keep unrelated formatting or refactoring out of the diff. By submitting a contribution, you agree that it is offered under the repository's MIT License.
