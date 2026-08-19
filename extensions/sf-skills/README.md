# SF Skills

## What It Does

SF Skills is SF Pi's home for skill discovery and scope. Its Skill Funnel shows
how on-disk skills become the set Pi actually loads:

```text
Catalog → Sources → Global → Project → Effective
```

The interactive view inventories every discovered copy, gates source roots,
controls global/project wiring, identifies additive-scope limits, resolves
eligible name conflicts, and reports auto-discovered copies it cannot override.
Pi remains the only skill loader; SF Skills compiles decisions into native
`settings.skills[]` entries and never renames or edits `SKILL.md` files.

It also provides an optional active-context HUD, the managed public Salesforce
skill-library installer (`forcedotcom/sf-skills`), explicit invocation counters,
and stale-entry/orphan cleanup. A retired `forcedotcom/afv-library` checkout is
detected and warned; `/sf-skills defaults install` switches wiring to the new
library without deleting the old clone.

## Commands

| Command                                         | Purpose                                         |
| ----------------------------------------------- | ----------------------------------------------- |
| `/sf-skills`                                    | Open SF Skills in the Manager                   |
| `/sf-skills funnel`                             | Open the interactive Skill Funnel               |
| `/sf-skills summary`                            | Print effective skill/source state              |
| `/sf-skills defaults install [project\|global]` | Install and wire the managed default library    |
| `/sf-skills defaults update`                    | Update a sentinel-managed library               |
| `/sf-skills metrics`                            | Show explicit skill invocation counts           |
| `/sf-skills prune [--apply]`                    | Report or remove stale wiring and owned orphans |

Project scope is additive: it can add skills but cannot subtract a globally
loaded skill. Conflicts involving Pi's auto-discovered default roots are
report-only because SF Skills does not move user files.

## Configuration

**SF Pi Manager → SF Skills → Settings** stores:

- `sfPi.skills.hudVisibility`: `auto` or `hidden`;
- `sfPi.skills.defaultInstallScope`: `project` (default) or `global`.

The full Skill Funnel remains an action surface because applying staged changes
can update native settings and reload Pi. Catalog loading and disk scans happen
only when the user opens the funnel; startup uses lightweight in-memory context.

## Troubleshooting

**Skills appear duplicated:** Use the Conflicts tab to consolidate duplicate
global/project wiring into one scope.

**A project skill is locked:** Pi merges global and project skills additively.
Disable it globally, then wire it only where needed.

**A conflict is report-only:** One copy lives in an auto-discovered default root.
Move or remove that file manually if the default winner is wrong.

**A custom source vanished:** Re-add it after the path exists. Empty custom
sources are remembered only after successful registration.

**The funnel is slow to open:** Opening it intentionally runs skill loading and
per-root scans; that work stays off the startup path.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-skills/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
