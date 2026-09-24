# Installed Zero release

Production app: `~/Applications/Zero.app`. Data: `~/Library/Application Support/ProjectZero`. The `zero` symlink resolves the bundled CLI. `dev.projectzero.zerod` runs the daemon independently of the menu; `dev.projectzero.menu` opens the interface at login. Explicit development sockets remain isolated.

## Diagnose

Run `zero version`, `zero doctor`, and `zero integrations list`. Confirm matching product/build versions, expected data/socket, VALID audit chain and ONLINE desk. Codex UNAVAILABLE is the recorded supported-interface blocker, not a socket configuration error. Spotify's `audio_capture` field distinguishes active, paused and unavailable audio capture. The waveform requires Spotify playing and macOS audio-capture approval; metadata/artwork do not require that capture permission.

## Upgrade / recovery

Preview with `zero upgrade --dry-run`. A source release must be built and signed with the existing Project Zero Local Release identity. From the repository: `python3 tools/build-macos.py`, then `python3 tools/install-release.py upgrade --source .runtime/v02-build/Zero.app --dry-run`, then the same command without `--dry-run`.

The installer checks Keychain access before stopping the service, saves a consistent SQLite backup and previous app/config, installs and health checks. Review any Keychain prompt locally. Never send passwords or replace the signing identity as a workaround.

`zero rollback --dry-run` shows the retained previous snapshot. A real rollback restores that snapshot's app and database, so later session/history changes will not be in the restored database. Preserve a current consistent backup before deliberate rollback. Automated failed-health recovery is tested; full physical rollback acceptance remains pending. The initial legacy snapshot predates the installed app bundle and requires the legacy recovery procedure, not the newer app rollback shortcut.

Do not erase ESP32 flash or provisioning to repair a runtime issue. Application-only firmware updates use offset 0x10000 and preserve NVS/keys. The private verified full-flash backup is in production `recovery/zero-before-v02.bin`; the original AuxDeck reference remains under the repository's private `.runtime/recovery`. Follow hardware-recovery.md. Never commit these backups.

Notifications: use the menu's manual setup reminder to verify OS delivery. The user confirmed delivery on 2026-09-09. That check does not fire or change the 45-minute focus automation. No scheduled AI checks are required.
