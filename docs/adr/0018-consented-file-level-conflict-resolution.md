# ADR 0018: Consented file-level conflict resolution

## Status

Accepted — amends [ADR-0017](./0017-skill-funnel-additive-project-scope.md) and remains in force while [ADR-0082](./0082-sf-skills-native-parity-before-delegation.md) validates whether Pi's native resource overrides can replace any conflict behavior.

## Context

[ADR-0017](./0017-skill-funnel-additive-project-scope.md) established Compiled
Skill Resolution: the Skill Funnel resolves conflicts by rewiring native
`settings.skills[]` and never touches skill files. That works for **Resolvable
Conflicts** (every copy lives in a settings-wired source — exclude the losers).
It cannot work for **Report-Only Conflicts**, where a colliding copy lives in an
auto-discovered default root (`~/.pi/agent/skills`, `.pi/skills`,
`.agents/skills`). Pi always loads those roots, so the only way to stop the
duplicate from loading is a filesystem change.

Previously the funnel could only _report_ such conflicts. In practice that left
users stuck: the conflict kept appearing in Pi's startup `[Skill conflicts]`
output with no way to clear it from the tool. "Just showing it isn't enough."

## Decision

Add an explicit, **consent-gated** file-level resolution path to the Conflicts
tab, separate from the automatic settings path. Pressing `r` on a conflict
keeps the chosen winner and prompts for what to do with the losing copies:

1. **Disable in place** (default) — rename the loser's `SKILL.md` →
   `SKILL.md.disabled` (or the loose `<name>.md` → `<name>.md.disabled`) so Pi
   stops discovering it. Reversible by renaming back.
2. **Move to quarantine** — move the skill unit to
   `<globalAgentDir>/skills-quarantine/<timestamp>/`. Reversible by moving back.
3. **Delete permanently** — remove the skill unit. Irreversible; requires a
   second confirm dialog.
4. **Cancel** — no change.

Rules:

- This path runs **only** on an explicit per-conflict user choice surfaced in
  the funnel, never automatically and never as part of Compiled Skill
  Resolution. The automatic settings path remains strictly file-safe.
- It operates on the "skill unit": the directory for a `SKILL.md`, or the file
  itself for a loose root-level `.md` (never the root directory).
- Delete is gated behind a second confirmation. The other actions are
  reversible, so a single selection is sufficient.

## Consequences

- The funnel can now fully clear Report-Only Conflicts; after resolution Pi no
  longer prints them at startup.
- ADR-0017's "never mutate files" guarantee now means "never mutate files
  _automatically_"; the explicit consent path is the documented exception.
- The logic lives in `extensions/sf-skills/lib/conflict-actions.ts` (pure fs
  helpers, unit-tested) and is invoked from the funnel command handler, which
  owns the confirm dialogs. It generalizes the doctor's existing
  quarantine-on-`renameSync` repair rather than introducing a new mechanism.
- These skill roots are outside the SF Guardrail's hard-blocked paths, so the
  filesystem operations are permitted; Delete's own double-confirm is the
  safeguard.
