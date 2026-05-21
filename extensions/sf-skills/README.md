# SF Skills — Code Walkthrough

## What It Does

`sf-skills` is the single sf-pi extension for everything skills-related:

1. **Pinned HUD** in the top-right that shows skills currently _in context_
   (still visible to the LLM). Historical _earlier in session_ usage stays
   available in `/sf-skills summary` and the panel, but no longer keeps the
   floating HUD visible.
2. **Tabbed datatable** — `/sf-skills` panel → "Open skills table".
   Three tabs:
   - **Active** — every skill `pi.getCommands()` reports right now,
     with a Wired column (`G`, `P`, `G+P`, `—`), SF / external class,
     source label, usage count.
   - **Discover** — Active rows + on-disk candidates not yet wired.
     `enable` queues a `settings.skills[]` add.
   - **Stats** — top-N persistent usage counters.
3. **Sources detection** — extends the existing `/sf-pi skills` overlay
   to probe project-scope `<cwd>/.claude/skills`, `<cwd>/.codex/skills`,
   `<cwd>/.cursor/skills` in addition to the global roots, and writes
   to `<cwd>/.pi/settings.json` when wiring at project scope.
4. **forcedotcom/afv-library installer** — `/sf-skills defaults
install [project|global]` clones the curated skill collection into
   a managed dir we own (`<globalAgentDir>/sf-skills/afv-library/` or
   `<cwd>/.pi/sf-skills/afv-library/`), drops a `.sf-skills-managed`
   sentinel, and wires `<that>/skills` into `settings.skills[]`.
   `update` does a fast-forward `git pull --ff-only` (sentinel-gated).
   `link` wires user-owned checkouts; `unlink --delete` is sentinel-gated.
5. **Persistent usage counters** — explicit `/skill:<name>`
   invocations bump global + project counters
   (`<globalAgentDir>/sf-pi/sf-skills/usage.json` and
   `<cwd>/.pi/sf-skills-usage.json`). The Stats tab and
   `/sf-skills metrics` read from them.
6. **Prune** — `/sf-skills prune` reports stale settings entries
   (paths in `skills[]` that no longer exist) and orphan managed
   clones (sentinel-marked dirs no longer referenced from settings).
   `--apply` removes both. Dry-run by default.

## One Rule

Every enable / disable is a native pi `settings.skills[]` add or
remove. We never rename `SKILL.md` files. We never edit frontmatter.
Auto-discovered and bundled skills appear in the table as read-only
with a hint.

## Runtime Flow

```text
Extension loads
  ├─ session_start
  │   ├─ mount hidden HUD overlay
  │   └─ rebuild in-context / earlier-in-session state from branch + active context
  ├─ message_end / session_tree / session_compact
  │   └─ re-scan and refresh HUD
  ├─ before_agent_start
  │   └─ if event.prompt has a /skill:<name> block → bump counters
  ├─ /sf-skills
  │   ├─ no args, hasUI → status & controls panel
  │   ├─ summary | help → text output
  │   ├─ table          → tabbed datatable overlay
  │   ├─ metrics        → top-N usage text
  │   ├─ defaults …     → install/update/link/unlink/status
  │   └─ prune [--apply] → stale + orphan cleanup
  └─ session_shutdown
      └─ dismiss HUD overlay
```

## Key Architecture Decisions

### 1. Native pi semantics, no shadow state

Pi has no per-skill enable/disable hook beyond `settings.skills[]`. We
honor that. The managed afv-library clone lives **outside** pi's
auto-discovery roots (`~/.pi/agent/sf-skills/...`, not
`~/.pi/agent/skills/...`) so the only thing that loads it is the
settings entry. Disable = remove the entry. No `.off` renames.

### 2. Two scopes, two settings files

Toggling at "global" writes to `~/.pi/agent/settings.json`. Toggling
at "project" writes to `<cwd>/.pi/settings.json`. Pi merges both
additively. There is no project-overrides-global escape hatch — the
constraint is honest: per-project toggle requires the source to be
installed at project scope.

### 3. Auto-collapse / auto-expand on disable

When a parent-dir entry covers a whole source root, the settings file
keeps a single line. The first per-skill disable expands to per-file
`SKILL.md` paths so pi loads everything except the disabled ones.
Re-enabling everything collapses back to the single parent-dir entry.
Implemented inside `updateSkillSources` callers — automatic and
transparent.

### 4. Sentinel-gated mutation

We never `git pull` or `rm -rf` a checkout we don't own. The
`.sf-skills-managed` sentinel marks dirs we created. `defaults update`
refuses to pull without it; `prune --apply` and
`defaults unlink --delete` refuse to delete without it. Linked
user-owned checkouts only ever change settings entries.

### 5. Detection lifted to lib/common/skill-detection/

The HUD's skill detection logic moved to
`lib/common/skill-detection/` so the datatable surfaces and any
future consumer share one source of truth. Behavior unchanged from
the previous sf-skills-hud implementation.

## Behavior Matrix

| Event / Trigger               | Condition                                     | Result                                                         |
| ----------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| `session_start`               | UI available                                  | Mount passive HUD overlay and rebuild state                    |
| `session_start`               | no UI                                         | Stay silent (commands still register)                          |
| `message_end`                 | skill block or `read(SKILL.md)` now visible   | Refresh HUD contents                                           |
| `session_tree`                | branch changed                                | Recompute in-context vs earlier-in-session skills              |
| `session_compact`             | compaction completed                          | Recompute in-context vs earlier-in-session skills              |
| `before_agent_start`          | `event.prompt` contains `/skill:<name>` block | Bump global + project usage counters for `<name>`              |
| `/sf-skills`                  | UI available, no args                         | Open status & controls panel                                   |
| `/sf-skills`                  | no UI, no args                                | Print HUD summary (text)                                       |
| `/sf-skills summary`          | any                                           | Print HUD summary (text)                                       |
| `/sf-skills table`            | UI available                                  | Open the tabbed datatable overlay                              |
| `/sf-skills metrics`          | any                                           | Print top-N usage counters (global + project)                  |
| `/sf-skills defaults install` | scope=global (default) or `--project`         | Clone afv-library, write sentinel, wire into settings.skills[] |
| `/sf-skills defaults update`  | sentinel present                              | `git pull --ff-only` on the managed clone                      |
| `/sf-skills defaults link`    | path exists with a `skills/` subdir           | Wire user-owned checkout into settings.skills[]                |
| `/sf-skills defaults unlink`  | any                                           | Remove from settings; `--delete` only on sentinel-marked dirs  |
| `/sf-skills prune`            | any                                           | Dry-run report of stale entries + orphan managed clones        |
| `/sf-skills prune --apply`    | any                                           | Remove stale entries + delete sentinel-marked orphan dirs      |
| `session_shutdown`            | reason !== "reload"                           | Dismiss HUD overlay and clear state                            |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-skills/
  lib/
    table-overlay/
      index.ts              ← implementation module
      types.ts              ← implementation module
      viewport.ts           ← implementation module
    classify.ts             ← implementation module
    defaults.ts             ← implementation module
    hud-component.ts        ← implementation module
    prune.ts                ← implementation module
    settings-coverage.ts    ← implementation module
    skill-state.ts          ← implementation module
    skills-command.ts       ← implementation module
    source-labels.ts        ← implementation module
    table-data.ts           ← implementation module
    usage-store.ts          ← implementation module
  tests/
    defaults.test.ts        ← unit / smoke test
    hud-visibility.test.ts  ← unit / smoke test
    prune.test.ts           ← unit / smoke test
    settings-coverage.test.ts← unit / smoke test
    skill-state.test.ts     ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    source-labels.test.ts   ← unit / smoke test
    table-data.test.ts      ← unit / smoke test
    usage-store.test.ts     ← unit / smoke test
    viewport.test.ts        ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  ROADMAP.md                ← extension-specific phased roadmap
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run: `npm test`

The test suite covers:

- HUD state reconstruction (in-context vs. earlier-in-session, compaction-aware)
- Settings detection across global + project scope
- Defaults install/update/link/unlink with an injected fake spawn
- Datatable row builders + classification
- Usage counter store (global, project, merge, reset)
- Prune planner + applier (sentinel-gated)

## Troubleshooting

**HUD never appears even though I know a skill was used:**
The HUD only treats two signals as "used": an explicit
`/skill:name` invocation, or an assistant `read` tool call that
opens a discovered `SKILL.md`. Indirect mentions intentionally
don't trigger it.

**A skill moved from In context to Earlier in session mid-session:**
Expected after compaction or significant context growth. The floating HUD hides
when no skills remain in active context. Use `/sf-skills` → "Show summary" or
run `/sf-skills summary` to review earlier session usage.

**Can I disable a globally-installed skill for one project only?**
Not directly. Toggle scope follows install scope — install
afv-library at project scope (`/sf-skills defaults install --project`)
to flip skills per-project.

**`/sf-skills defaults update` refuses to run:**
The clone is missing the `.sf-skills-managed` sentinel — it's a
user-owned tree we won't `git pull`. Use `unlink` + `install` to
hand it back to us, or pull the upstream repo manually.

**Prune wants to delete a clone I edited:**
Only sentinel-marked dirs are deletable. If you've been editing the
clone, `unlink --delete` will refuse because the sentinel is missing
or the dir is referenced elsewhere — your changes are safe.
