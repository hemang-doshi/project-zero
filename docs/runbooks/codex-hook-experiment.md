# Codex hook compatibility experiment

This is an optional metadata-only probe, not a production task observer.
It has not demonstrated real desktop lifecycle delivery. Codex remains
UNAVAILABLE in the product until that evidence exists.

Use the documented Codex hook installation/trust workflow to register
`tools/codex-status-hook.py` for UserPromptSubmit, Stop and Interrupt in this
project only. The command is the absolute Python executable followed by the
absolute script path. Do not disable hook trust or replace existing hooks.
The approved experiment is configured in .codex/hooks.json. It remains skipped
until the owner reviews and trusts the exact definitions through Codex /hooks.
No trust setting or bypass flag was changed.

The probe accepts only the exact registered Project Zero root, caps input at
64 KiB, discards messages, transcripts and tool outputs, and writes at most
about 1 MiB of task/turn IDs and event timestamps into .runtime/codex-hook/.
It returns empty JSON and never requests a continuation or alters approval.

Acceptance experiment: owner trusts the project hook; run a new ordinary task
in the desktop UI; verify observed start/stop IDs; then test interruption and
reconnect. Stop means a turn stopped, not that the requested coding objective
succeeded. Do not display success or run completion automation from Stop alone.
Missing events must be marked unknown, never inferred from elapsed time.

Official contract: https://developers.openai.com/codex/hooks
