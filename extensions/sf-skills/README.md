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
Pi remains the only skill loader for _wiring_. The Funnel still compiles load
decisions into native `settings.skills[]` and does not rename user `SKILL.md`
files. Managed-library _invocation_ is separate: `/sf-skills toggle` stamps
`disable-model-invocation` on a global `effective/` copy so unused skills stay
out of the system prompt while `/skill:name` keeps working.

It also provides an optional active-context HUD, the managed public Salesforce
skill-library installer (`forcedotcom/sf-skills`), explicit invocation counters,
and stale-entry/orphan cleanup. On the first agent turn, it checks only
agent-invocable managed skills in the current system prompt and emits one
human-only warning when their declared `metadata.mcpTools` servers are not
configured. The compact row identifies each affected skill, declared service and
tools, and its effective `SKILL.md` source. Expanding the row shows declared
versions and explains `/mcp setup` and `/sf-skills toggle`. The check is local and
advisory: it does not connect servers, mutate skill settings, or block the turn. A
retired `forcedotcom/afv-library` checkout
is detected and warned; `/sf-skills defaults install` switches wiring to the new
library without deleting the old clone.

## Commands

| Command                                         | Purpose                                         |
| ----------------------------------------------- | ----------------------------------------------- |
| `/sf-skills`                                    | Open SF Skills in the Manager                   |
| `/sf-skills funnel`                             | Open the interactive Skill Funnel               |
| `/sf-skills toggle`                             | Stamp packs or individual skills; Origin column |
| `/sf-skills summary`                            | Print effective skill/source state              |
| `/sf-skills defaults install [project\|global]` | Install and wire the managed default library    |
| `/sf-skills defaults update`                    | Pull the clone and restamp the effective tree   |
| `/sf-skills metrics`                            | Show explicit skill invocation counts           |
| `/sf-skills prune [--apply]`                    | Report or remove stale wiring and owned orphans |

Project scope is additive: it can add skills but cannot subtract a globally
loaded skill. Conflicts involving Pi's auto-discovered default roots are
report-only because SF Skills does not move user files.

## Configuration

**SF Pi Manager → SF Skills → Settings** stores:

- `sfPi.skills.hudVisibility`: `auto` or `hidden`;
- `sfPi.skills.defaultInstallScope`: `project` (default) or `global`.
- `sfPi.skillInvocation`: global default/pack/skill visibility for the managed library.

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

**Toggles vanished after update:** `/sf-skills defaults update` restamps the
effective tree from `sfPi.skillInvocation`. The clone is never the preference
store. If flags are missing, check that settings key and rerun `/sf-skills toggle`.

**A skill-readiness warning appears:** One or more agent-invocable managed skills
declare an MCP server that is not configured. The compact row shows the source
skill, service, and tool names; expand it for version details and guided command
explanations. Run `/mcp setup` to review and configure MCP sources, or
`/sf-skills toggle` to make the affected skills manual-only. Disabled and
manual-only skills do not trigger this warning.

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
