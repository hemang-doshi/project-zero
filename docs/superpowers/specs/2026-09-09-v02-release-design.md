# v0.2 release amendment

The owner approved docs/superpowers/plans/2026-09-09-v02-release.md. It supersedes soak and 14-day release gates, authorizes production cutover after bounded tests, and retains full supported Codex outcome requirements. No scheduled model monitoring. Existing personal-device and explicit-project boundaries remain.

## Owner-approved artwork amendment
The owner requested album artwork and removal of repeated branding during physical review. The 128x160 view now uses one project header, explicit focus label, prominent timer, separate Spotify card with a 32x32 thumbnail and explicit playback label, and compact Git/Codex/connectivity. This supersedes the prior no-artwork-download exception. The local Spotify scripting interface supplies the artwork URL; only HTTPS i.scdn.co/image/ URLs are accepted, redirects are refused, downloads are capped at 512 KiB and 2 seconds, decoded source dimensions at 4096, and transmitted pixels at exactly 2048 bytes RGB565. One-thumbnail local cache and 60-second failure cooldown prevent polling downloads. Stored assets are deduplicated by hash. Nodes must advertise artwork=rgb565-32. No account API, playback controls or model calls.

User amendment: tighten track/artist spacing and add a compact real Spotify bass trace beside the artist. Reuse Times Gate process-tap and spring approach, with actual 40–200 Hz filtering. Audio is transient, no PCM storage/transmission; permission denial must not disrupt other features. Separate coalescing audio queue from durable commands.
