# Project Zero — Design Contract

Non-negotiable rules every future implementation must obey.

Tell Codex/OpenCode: *Implement Feature X. Follow `PROJECT_ZERO_UI_REFINEMENT_SPEC.md` and treat this contract as non-negotiable.*

```text
WINDOWS
- Content reflows; never visually scales.
- Every app declares min/preferred dimensions.
- Resize must update continuously.
- Focus must be visually discernible.

TYPOGRAPHY
- Human UI uses system sans.
- Machine/system metadata uses mono.
- Normal UI text must remain comfortably legible.
- Backend terminology stays behind developer disclosure.

STATUS
- Green = healthy/active.
- Amber = attention/stale/partial.
- Red = blocked/offline/failure.
- State must never be communicated by colour alone.

DATA HONESTY
- Never display simulated live state as real state.
- Unknown != offline.
- Partial/lower-bound values must say so.

AI
- Conversation belongs to Zero.
- Providers execute turns.
- Provider switches preserve the same Zero thread.
- Context reconstruction must report degradation honestly.

PRIVACY
- Outbound provider context passes through Airlock policy.
- Security-critical enforcement must not depend solely on an LLM.

DESKTOP
- Applications look like applications.
- Files look like files.
- Wallpaper must never destroy label legibility.

PROGRESSIVE DISCLOSURE
- Human explanation first.
- Technical detail second.
- Raw evidence third.
```
