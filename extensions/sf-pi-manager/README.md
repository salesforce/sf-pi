# sf-pi-manager — Code Walkthrough

This document explains the design and runtime flow of the sf-pi extension
manager. Read this before making changes.

## What It Does

Provides the `/sf-pi` command for browsing, inspecting, enabling, and
disabling bundled extensions at runtime. Uses Pi's native package filtering in
`settings.json` to control which extensions are loaded.

## Runtime Flow

```
Extension loads
  ├─ registerCommand("sf-pi")
  ├─ on("session_start")         → update footer status
  └─ on("session_shutdown")      → clear footer status

/sf-pi command
  ├─ parseCommandArgs()           → determine subcommand + scope
  └─ switch (subcommand)
       ├─ overlay   → TUI overlay (or list fallback)
       ├─ list      → show extension states
       ├─ enable    → remove exclusion pattern, reload
       ├─ disable   → add exclusion pattern, reload
       ├─ enable-all / disable-all
       ├─ status    → detailed summary
       ├─ display   → show/set compact|balanced|verbose display profile
       ├─ /sf-pi announcements → list / dismiss / reset maintainer notes + update nudge
       ├─ skills    → detect & wire Claude Code / Codex / Cursor skill dirs
       └─ help      → command reference
```

## Key Architecture Decisions

### 1. Package filtering via Pi's native spec

Pi supports package filtering in `settings.json` through object-form entries
with an `extensions` array. Exclusion patterns like
`!extensions/sf-ohana-spinner/index.ts` prevent the extension from loading.
When all extensions are enabled, we simplify back to a clean string entry.

### 2. Package source detection

The manager needs to find its own package entry in settings.json to modify the
filter patterns. Since users can install via git URL, npm name, or local path,
the detection logic recognizes multiple forms:

- Name-based: source contains "sf-pi" or "jag-pi-extensions"
- Path-based: resolves to the package root (handles symlinks from `pi install .`)

### 3. Registry as source of truth

`catalog/registry.ts` is the single source of truth for extension metadata.
The manager reads it to populate the TUI overlay, validate command targets,
and compute enabled/disabled state.

### 4. Reload after changes

Extension enable/disable requires a full reload (`ctx.reload()`) because Pi
reads the package filter at startup time. The manager notifies the user before
triggering the reload.

## Behavior Matrix

| Trigger               | Condition                 | Result                               |
| --------------------- | ------------------------- | ------------------------------------ |
| /sf-pi (no args)      | has UI                    | Open TUI overlay                     |
| /sf-pi (no args)      | no UI                     | Fall back to list                    |
| /sf-pi list           | package in settings       | Show extension states                |
| /sf-pi list           | package NOT in settings   | Show states (all enabled assumed)    |
| /sf-pi enable \<id\>  | valid, currently disabled | Remove exclusion, reload             |
| /sf-pi enable \<id\>  | valid, already enabled    | Notify "already enabled"             |
| /sf-pi enable \<id\>  | alwaysActive              | Notify "cannot toggle"               |
| /sf-pi disable \<id\> | valid, currently enabled  | Add exclusion, reload                |
| /sf-pi disable-all    | —                         | Exclude all non-alwaysActive, reload |
| /sf-pi enable-all     | —                         | Remove all exclusions, reload        |
| /sf-pi display        | no profile                | Show effective display profile       |
| /sf-pi display <name> | compact/balanced/verbose  | Save shared display profile          |
| TUI list → Enter      | —                         | Open extension detail/config view    |
| TUI list → Esc        | changes pending           | Apply exclusions, reload if needed   |
| TUI detail → Esc      | —                         | Return to extension list             |
| session_start         | —                         | Update footer status                 |
| session_shutdown      | —                         | Clear footer status                  |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-pi-manager/
  lib/
    announcements.ts        ← implementation module
    config-panel.ts         ← implementation module
    extension-details.ts    ← implementation module
    overlay.ts              ← implementation module
    package-state.ts        ← implementation module
    recommendations-install.ts← implementation module
    recommendations-overlay.ts← implementation module
    recommendations.ts      ← implementation module
    render.ts               ← implementation module
    settings.ts             ← implementation module
    skill-sources-command.ts← implementation module
    skill-sources-overlay.ts← implementation module
  tests/
    announcements-command.test.ts← unit / smoke test
    command-parsing.test.ts ← unit / smoke test
    extension-details.test.ts← unit / smoke test
    extension-state.test.ts ← unit / smoke test
    package-detection.test.ts← unit / smoke test
    package-state.test.ts   ← unit / smoke test
    recommendations-command.test.ts← unit / smoke test
    recommendations-install.test.ts← unit / smoke test
    recommendations-manifest.test.ts← unit / smoke test
    recommendations-state.test.ts← unit / smoke test
    skill-sources.test.ts   ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Section Guide

1. **Behavior contract** — commands, how enable/disable works
2. **Imports**
3. **Constants** — command name, status key
4. **Package root detection** — `__dirname` resolution, version read
5. **Types** — command args, overlay result, extension state
6. **Entry point** — command registration + session_start hook
7. **Command routing** — `parseCommandArgs`, `handleCommand`
8. **Command handlers** — overlay, list, toggle, display, recommendations, announcements, skills, status, help
9. **Footer status** — active extension count display plus recommendation / announcement nudges
10. **Extension state helpers** — `buildExtensionStates`, footer summary
11. **Settings I/O** — `lib/settings.ts`
12. **Package entry discovery** — `lib/package-state.ts`
13. **Extension state read/write** — `lib/package-state.ts`
14. **TUI Overlay** — `SfPiOverlayComponent` with list/detail navigation
15. **Recommended extensions** — manifest/state in `recommendations*.ts`
16. **External skill roots** — `/sf-pi skills` in `skill-sources*.ts`

## Testing Strategy

Tests cover exported pure helpers (package detection, extension state,
project/global precedence, command parsing, detail metadata helpers,
recommendation state/install helpers, announcement commands, and external
skill-root settings writes). The TUI overlays and full command handlers are
tested via manual QA.

To run: `npm test`

Exported helpers are marked with `// Exported for unit tests.` in the source.

## Troubleshooting

**`/sf-pi` says "package not found in settings":**
Run `pi install .` from the repo root, or `pi install git:github.com/salesforce/sf-pi`,
so pi registers the package in `settings.json`. The manager finds itself
via name-based (`sf-pi` / `jag-pi-extensions`) or path-based detection
— a symlink from `pi install .` resolves to the repo root.

**Disabling an extension through the manager doesn't take effect:**
Pi reads the package filter at startup. After a disable, the manager
calls `ctx.reload()` to pick up the new exclusion pattern. If your pi
runtime doesn't support `reload`, close and reopen the session.

**`/sf-pi enable-all` still leaves some extensions disabled:**
Extensions marked `alwaysActive: true` in their manifest cannot be
toggled through the manager — they're always on. `enable-all` removes
all exclusion patterns; disabled extensions that still appear are the
always-active ones (like `sf-pi-manager` itself).

**Project-scoped changes aren't sticking:**
The manager writes to `<cwd>/.pi/settings.json` for project scope and
`~/.pi/agent/settings.json` for global. Project wins over global. Use
`/sf-pi disable <id> project` or `/sf-pi enable <id> global` explicitly
if the default scope confuses you.

**Display profile change doesn't affect any output:**
`/sf-pi display <profile>` saves `sfPi.display.profile` in settings
(project > global). Not every extension reads it yet — sf-slack and
LSP-style extensions honor it via the shared
`lib/common/display/settings.ts`. If an extension-specific preference
(e.g. `/sf-slack settings`) is set to an explicit value, it wins.

**`/sf-pi recommended` shows no items or the opposite — too many:**
The list is driven by `catalog/recommendations.json`. Decisions are
sticky across sessions: once an item is installed or declined it won't
reappear. The one-time nudge fires only when the manifest's `revision`
differs from your acknowledged revision **and** at least one
default-bundle item is still pending. Opt out entirely with
`SF_PI_RECOMMENDATIONS=off`.

**`/sf-pi skills` says "No external skill directories detected":**
The command probes three fixed roots on disk — `~/.claude/skills`,
`~/.codex/skills`, and `~/.cursor/skills`. If none of those exist, the
command has nothing to offer. You can still reference arbitrary paths
by editing `~/.pi/agent/settings.json → skills[]` directly; pi loads
whatever you list there as long as each path resolves to a directory.

**`/sf-pi skills` added a root but pi still doesn't load the skills:**
The writer updates `~/.pi/agent/settings.json` and calls `ctx.reload()`.
If a skill inside the linked root is malformed (missing `description`
frontmatter, invalid `name`), pi drops that skill with a warning but
keeps loading the rest. Check `pi` startup output for skill-validation
messages, or run `/sf-welcome` to see the loaded-skills count.
