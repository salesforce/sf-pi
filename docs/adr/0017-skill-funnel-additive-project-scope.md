# ADR 0017: Skill Funnel governs through native settings; project scope is additive-only

## Status

Accepted — amended by [ADR-0018](./0018-consented-file-level-conflict-resolution.md), which adds an
explicit, consent-gated file-mutation path for conflicts that this ADR's
settings-only resolution cannot fix (Report-Only Conflicts). The "never mutate
files" rule below remains true for the _automatic_ Compiled Skill Resolution
path; ADR-0018 carves out only an explicit, user-chosen exception.

## Context

The SF Skills Bundled Extension is being rewritten from a HUD-first surface into
a **Skill Funnel** governance manager: the full on-disk catalog narrows through
a **Source Gate** (which roots Pi sees), a **Skill Gate** evaluated independently
at global and project scope, and **Skill Conflict Resolution** for skills that
share a name across roots.

The Pi Runtime skill loader has a fixed shape we chose not to fight:

- The only user-facing wiring knob is `settings.skills[]`, merged additively
  across global and project. There is no native per-skill disable.
- Skills load in a fixed order — auto-discovered defaults (`~/.pi/agent/skills`,
  `.pi/skills`, the `.agents/skills` roots) first, then settings paths — and the
  **first occurrence of a name wins**. Order is not user-controllable across
  scopes.

We considered three postures: a thin read-only view over the loader, a curated
mirror directory that becomes the effective set (a second loader, symlink/copy
farm), and a hybrid that owns the policy but compiles every decision down to
native `settings.skills[]`.

## Decision

The funnel is realized through **Compiled Skill Resolution**: every enable,
disable, and conflict-winner decision compiles to native `settings.skills[]`
entries (global or project). SF Skills owns the policy; Pi stays the single
loader. We do not rename `SKILL.md` files, edit frontmatter, maintain a shadow
enabled-set the loader ignores, or run a mirror directory as the effective set.

Two constraints follow directly and are accepted rather than worked around:

1. **Project scope is additive-only.** Because Pi merges global and project
   settings additively, the project **Skill Gate** can add skills on top of
   global but cannot subtract a skill already enabled globally. Turning a skill
   off for one project is not expressible natively, and we refuse to rewrite
   global settings (which would disable it everywhere). Practical guidance:
   enable at the narrowest scope you may need to vary — global means
   "everywhere, always."

2. **Conflict resolution is by exclusion, and only within wired sources.** A
   winner is enforced by keeping its file wired and excluding the losing copies
   so the collision disappears. When a colliding copy lives in an
   auto-discovered default root, that copy always wins; such collisions are
   **Report-Only Conflicts** that SF Skills explains but cannot flip without
   moving files.

## Consequences

- The Funnel view shows a globally-enabled skill as locked-on in project scope
  with a hint to disable it at global scope or enable narrowly instead.
- Future architecture reviews should not re-propose a project-override or
  per-skill-disable mechanism; it would require either a second loader (curated
  mirror) or mutating user files, both rejected here.
- If the Pi Runtime later adds a native per-skill disable or precedence knob,
  this ADR should be revisited — the additive-only and exclusion-only limits are
  loader limitations, not product preferences.
