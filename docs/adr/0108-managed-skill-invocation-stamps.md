---
id: "0108"
status: accepted
date: "2026-08-21"
---

# Managed skill invocation stamps use an effective tree

## Context

The official `forcedotcom/sf-skills` library is cloned once and wired into
`settings.skills[]`. Pi then injects every skill description into
`<available_skills>`, which dominated first-turn context in measured sessions.
Pi already honors `disable-model-invocation` in `SKILL.md`: the skill stays
loaded for `/skill:name` but drops out of the system prompt.

Stamping that flag in the managed git clone would break
`/sf-skills defaults update` (`git pull --ff-only`). ADR 0017 also forbids
automatic Funnel mutation of user `SKILL.md` files as the _wiring_ mechanism.

## Decision

Wave 1 keeps **global-only** invocation stamps:

1. The managed clone stays pristine.
2. Pi is wired to `~/.pi/agent/sf-skills/effective/skills`.
3. User intent lives in `sfPi.skillInvocation` (global settings).
4. `/sf-skills toggle` and `/sf-skills defaults update` restamp the effective
   `SKILL.md` files from that sidecar plus any author-owned
   `disable-model-invocation: true` in the clone.
5. Default for managed-library skills is `manual-only`.

Funnel wiring (`settings.skills[]`) is unchanged and still governed by
ADR 0017. This ADR only covers prompt visibility for the managed library.

## Consequences

- Updating the clone from upstream remains valid because the clone is
  pristine. Update fetches the branch tip at depth 1 and resets to it, so it
  also works after upstream rewrites history; it refuses when tracked files in
  the clone were edited by hand (originally `git pull --ff-only`, changed for
  issue #920).
- Toggles survive updates because the sidecar is restamped after each pull.
- `/skill:name` still works for hidden skills.
- Wave 1 stamps apply to every cwd. Per-project effective trees are future work.
