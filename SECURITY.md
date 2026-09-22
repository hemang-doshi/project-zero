# Security Policy

## Supported versions

Security fixes are made against the latest source on the default branch. Older snapshots may not receive fixes.

## Report a vulnerability

Please use GitHub's **Report a vulnerability** feature for this repository. It creates a private report visible to maintainers. Do not open a public issue for an unpatched vulnerability.

Include the affected revision, component, impact, and a minimal reproduction. Do not include real credentials, private keys, personal runtime databases, pairing material, or recovery images. The maintainer will acknowledge a report as soon as practical and coordinate a fix and disclosure timeline with the reporter.

## Operational boundaries

- Treat the owner account and local machine as trusted; this project does not protect against an attacker controlling either.
- Keep the API on its Unix socket or loopback unless LAN access is deliberately enabled. LAN mode requires enrolled client certificates.
- Use isolated development data. Never test with production databases or device identities.
- Keep secrets in a platform credential store or an untracked, owner-only file. Do not add secrets to fixtures, logs, screenshots, issues, or pull requests.
