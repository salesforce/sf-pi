# SF Skills — Code Walkthrough

## What It Does

`sf-skills` is the single sf-pi home for skill governance. It presents the
**Skill Funnel**: the full on-disk catalog of skills narrows through a series
of gates down to the set Pi actually loads.

```
Catalog → Sources (Source Gate) → Global → Project (Skill Gate) → Effective (conflicts resolved)
```

1. **Funnel view** — `/sf-skills` → "Open skill funnel". Five tabs over one
   resolved **Skill Catalog**:
   - **Catalog** — every skill found across every source (including gated-off
     roots and conflict losers), tagged with where it sits in the funnel.
   - **Sources** — the **Source Gate**: which roots Pi may see
     (Claude/Codex/Cursor/custom/managed/auto-default). `a` adds a custom path.
   - **Global / Project** — the **Skill Gate**: toggle individual skills at each
     scope. `g` toggles global, `p` toggles project. `m` moves a skill (or, on
     the Sources tab, a whole source) from global to the current project; `M`
     moves every global skill to this project (local-first **Skill Rescope** —
     it drops the global wiring, so multi-skill moves confirm first).
   - **Conflicts** — pick a winner (`w`) for resolvable name collisions.
2. **Passive HUD** in the top-right showing skills currently _in context_.
   Unchanged behavior; it is one optional surface, not the extension's identity.
3. **Source detection + Source Registry** — probes the global and project
   Claude/Codex/Cursor roots and remembers user-added custom paths + gate state
   so a seen-but-empty custom source survives reload.
4. **forcedotcom/afv-library installer** — `/sf-skills defaults install` clones
   the curated skill collection **once** into the global managed dir (shared,
   no per-project duplication) and wires it into the **current project** by
   default (local-first). `defaults install global` is the explicit opt-in to
   enable it everywhere. Sentinel-gated update/unlink.
5. **Usage counters** — explicit `/skill:<name>` invocations bump persistent
   global + project counters shown as the `USED` column and `/sf-skills metrics`.
6. **Prune** — `/sf-skills prune` reports stale settings entries + orphan
   managed clones; `--apply` removes them.

## One Rule — Compiled Skill Resolution

Every enable, disable, source-gate, and conflict-winner decision compiles down
to native pi `settings.skills[]` entries (global or project). We never rename
`SKILL.md` files, never edit frontmatter, and never run a shadow loader. Pi
stays the single skill loader; sf-skills owns only the policy. See
[ADR-0017](../../docs/adr/0017-skill-funnel-additive-project-scope.md).

Two honest limits fall out of staying native (ADR-0017):

- **Project scope is additive-only.** The project Skill Gate can add skills on
  top of global but cannot disable a globally-enabled skill. Such rows render
  `locked` with a hint.
- **Conflicts touching an auto-discovered default are report-only.** A copy in
  `~/.pi/agent/skills`, `.pi/skills`, or `.agents/skills` always wins; we can
  report it but cannot flip it without moving files.

## Architecture

The funnel is built from three pure, fixture-tested modules plus one I/O bridge:

| Module              | Responsibility                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/gather.ts`     | **The only impure module.** Calls `loadSkills`, `pi.getCommands()`, reads settings + Source Registry, scans roots, loads usage — assembles a `SkillCatalogInput`. Runs **only** on `/sf-skills` open.   |
| `lib/catalog.ts`    | Pure `buildSkillCatalog(input)` → the resolved **Skill Catalog**: every copy tagged `seen` / `enabledGlobal` / `enabledProject` / `effective` / `conflictRole`, plus conflicts and source rollups.      |
| `lib/resolution.ts` | Pure **Resolution Policy**: compiles a funnel decision into `settings.skills[]` add/remove ops (expand-minus-one for disables, exclusion for conflict winners), surfacing the ADR-0017 `blocked` cases. |
| `lib/funnel-view/`  | The TUI: `model.ts` folds the catalog into per-tab rows + staging (pure, tested); `index.ts` is the Focusable overlay.                                                                                  |

Shared primitives live in `lib/common/skill-sources/` (consumed by `/sf-pi`
too): `source-registry.ts` (persisted sources + gate), `skill-sources.ts`
(detection + `settings.skills[]` writer).

### Boot contract

`session_start` and every recurring hook do **zero** catalog work — the HUD
uses only in-memory `pi.getCommands()` + branch state. `loadSkills` and disk
scans happen only on explicit `/sf-skills` open. This is enforced by
`tests/boot-path.test.ts`, which spies on the Pi loader and fails if any
lifecycle hook triggers a catalog build. First paint stays cache-first.

## Runtime Flow

```text
Extension loads
  ├─ session_start / message_end / session_tree / session_compact
  │   └─ rebuild HUD from in-memory branch + context (NO catalog work)
  ├─ before_agent_start
  │   └─ /skill:<name> in prompt → bump usage counters
  ├─ /sf-skills
  │   ├─ no args, hasUI → SF Pi Manager detail page
  │   ├─ funnel        → gather → buildSkillCatalog → Funnel view overlay
  │   │                  → stage actions → resolution → settings write → reload
  │   ├─ summary | metrics | help → text output
  │   ├─ defaults …    → afv-library Managed Source install/update/link/unlink
  │   └─ prune [--apply] → stale + orphan cleanup
  └─ session_shutdown
      └─ dismiss HUD overlay
```

## Settings

SF Skills has a Manager Settings page for low-risk preferences stored under `sfPi.skills`:

- **HUD visibility** (`hudVisibility`) — `auto` shows the passive HUD when skills are in active context; `hidden` suppresses the floating HUD while keeping `/sf-skills summary` and the Skill Funnel available.
- **Default install scope** (`defaultInstallScope`) — `project` (default) or `global` for `/sf-skills defaults install/update` when the command omits an explicit scope.

The full Skill Funnel remains an action page because it edits native `settings.skills[]` and may reload Pi after applying staged changes.

## Behavior Matrix

| Event / Trigger              | Result                                                              |
| ---------------------------- | ------------------------------------------------------------------- |
| `session_start` (UI)         | Mount passive HUD; rebuild in-memory state (no catalog work)        |
| `message_end` / `session_*`  | Refresh HUD from in-memory branch/context                           |
| `before_agent_start`         | Bump usage counters on `/skill:<name>`                              |
| `/sf-skills` (no args, UI)   | Open SF Skills in the SF Pi Manager                                 |
| `/sf-skills funnel`          | Gather catalog, open the five-tab Funnel view, apply staged changes |
| `/sf-skills summary`         | HUD summary text                                                    |
| `/sf-skills metrics`         | Top-N usage counters (global + project)                             |
| `/sf-skills defaults …`      | Manage the afv-library Managed Source                               |
| `/sf-skills prune [--apply]` | Stale settings entries + orphan managed clones                      |
| `session_shutdown`           | Dismiss HUD overlay                                                 |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-skills/
  lib/
    funnel-view/
      index.ts              ← implementation module
      layout.ts             ← implementation module
      model.ts              ← implementation module
      types.ts              ← implementation module
      viewport.ts           ← implementation module
    catalog.ts              ← implementation module
    config-panel.ts         ← implementation module
    conflict-actions.ts     ← implementation module
    defaults.ts             ← implementation module
    gather.ts               ← implementation module
    hud-component.ts        ← implementation module
    prune.ts                ← implementation module
    resolution.ts           ← implementation module
    settings-coverage.ts    ← implementation module
    settings.ts             ← implementation module
    skill-state.ts          ← implementation module
    skills-command.ts       ← implementation module
    usage-store.ts          ← implementation module
  tests/
    boot-path.test.ts       ← unit / smoke test
    catalog.test.ts         ← unit / smoke test
    config-panel.test.ts    ← unit / smoke test
    conflict-actions.test.ts← unit / smoke test
    defaults.test.ts        ← unit / smoke test
    funnel-layout.test.ts   ← unit / smoke test
    funnel-model.test.ts    ← unit / smoke test
    gather.test.ts          ← unit / smoke test
    hud-visibility.test.ts  ← unit / smoke test
    prune.test.ts           ← unit / smoke test
    reload-safety.test.ts   ← unit / smoke test
    resolution.test.ts      ← unit / smoke test
    settings-coverage.test.ts← unit / smoke test
    settings.test.ts        ← unit / smoke test
    skill-state.test.ts     ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    source-registry.test.ts ← unit / smoke test
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

- `catalog.test.ts` — pure funnel-tag derivation + conflict classification (no mocks)
- `resolution.test.ts` — compiled add/remove ops, expand-minus-one, ADR-0017 blocks
- `gather.test.ts` — input assembly with injected loader/commands + temp dirs
- `funnel-model.test.ts` — funnel counts, per-tab folds, staging reducer
- `source-registry.test.ts` — persisted sources + gate round-trip, per scope
- `boot-path.test.ts` — guards that no lifecycle hook builds the catalog
- HUD state, usage counters, prune, defaults — carried over

## Troubleshooting

**My skills look duplicated — a wall of conflicts, and some show "Unknown source":**
A source (often `afv-library`) is wired in **both** global and project scope, so
every skill collides with its other-scope copy. On the **Conflicts** tab press
`c` (_consolidate_) and pick a scope to keep — it removes the other scope's
wiring for all duplicates in one shot. The "Unknown source" label was a
mis-attribution of the managed afv-library clone (now labelled `afv-library`);
disabling those no longer makes them vanish.

**Can I disable a globally-enabled skill for just one project?**
No — pi merges global + project `settings.skills[]` additively, so the project
Skill Gate can only add, never subtract a globally-enabled skill. The Project
tab shows such rows as `locked`. Disable it at global scope, or enable it
narrowly at project scope instead (ADR-0017).

**A conflict shows REPORT-ONLY and `w` does nothing:**
One of the colliding copies lives in an auto-discovered default root
(`~/.pi/agent/skills`, `.pi/skills`, `.agents/skills`), which always wins. The
only fix is to move or remove that file — sf-skills never moves files.

**I added a custom path but it vanished after reload:**
Custom paths are remembered in the Source Registry even with zero enabled
skills. If it vanished, the path didn't resolve to an existing directory when
it was added — re-add it via the Sources tab (`a`) once the directory exists.

**The funnel feels slow to open:**
Opening `/sf-skills` runs `loadSkills` + per-root disk scans on purpose — that
work is deliberately kept off the boot path and only happens on explicit
intent. It does not affect pi startup time.
