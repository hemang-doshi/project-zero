# GitHub repository settings

The public repository uses `main` as its default branch. GitHub Actions has read-only repository contents permissions by default; the CodeQL job receives `security-events: write` only for publishing its analysis. Actions are pinned to full commit SHAs and Dependabot checks the Go module, npm lockfile and workflow dependencies weekly.

Repository security settings are enabled for secret scanning and push protection, private vulnerability reporting, dependency alerts and automated security fixes. Branch rules require passing CI checks and prevent force pushes or branch deletion. CI does not hold signing, device, or production credentials and never flashes physical hardware.

Do not add deployment keys, signing certificates, provider tokens, production database copies, enrolled-device identities, or Wi-Fi credentials to GitHub Actions secrets. This source release does not require deployment credentials.
