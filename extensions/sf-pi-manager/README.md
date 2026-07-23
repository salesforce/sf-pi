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
  ├─ on("session_start")         → update footer status + record due updates as pending
  ├─ on("agent_start")           → abort any overlapping automatic update
  ├─ on("agent_settled")         → run one consented pending update plan
  └─ on("session_shutdown")      → cancel stale work + clear footer status

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
       ├─ auto-update → show/toggle/run native Auto Update
       ├─ announcements → list / dismiss / reset maintainer notes + update nudge
       ├─ skills    → detect & wire Claude Code / Codex / Cursor skill dirs
       ├─ doctor    → diagnose and repair startup / skill-source issues
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

### 5. Privacy defaults

`session_start` calls
[`assertTelemetryDefault()`](../../lib/common/privacy/assert-default.ts) which
idempotently writes `enableInstallTelemetry: false` to pi's global
`settings.json` **only when the key is currently unset**. The pi setting
controls the anonymous install/update version ping to
`https://pi.dev/api/report-install`; turning it off does not affect the
latest-version probe (`PI_SKIP_VERSION_CHECK`) or any LLM provider
traffic.

Decision matrix on every `session_start`:

| pi `enableInstallTelemetry` | Action                                                  |
| --------------------------- | ------------------------------------------------------- |
| `undefined` (missing)       | write `false`, record assertion, emit one-time notice   |
| `false`                     | no-op (refresh assertion record silently if missing)    |
| `true`                      | no-op, clear stale assertion (user explicitly opted in) |

State lives at `<globalAgentDir>/sf-pi/privacy/telemetry-default.json` and
distinguishes "sf-pi default" from "user override" so the sf-welcome
splash can label the row correctly. `/sf-pi telemetry on|off|status`
manages the setting without touching the user's shell rc files.

### 6. Native Auto Update is opt-in and agent-settled

The SF Pi Manager settings panel exposes a single machine-scoped toggle for
Native Auto Update. When the daily cadence is due, `session_start` records the
work as pending but performs no update. The next `agent_settled` boundary
rechecks opt-in and idle state, writes a sanitized Human-Only plan row, and runs
eligible targets independently under an atomic machine lock.

The Pi runtime remains on the audited `>=0.81.1 <0.82.0` line because Pi does
not expose a bounded self-update target. Global npm Pi packages receive a
read-only compatibility preflight; only an outdated, unpinned package whose
latest release declares support for the active Pi and Node runtimes is updated
through Pi's native command:

```bash
pi update --extension <source> --no-approve
sf update stable
```

This includes an outdated unpinned `npm:@ogulcancelik/pi-herdr` installation.
Pinned, local, git, project-scoped, incompatible, and unverifiable packages are
left untouched. A package failure does not hide the independent Salesforce CLI
step. `PI_OFFLINE` skips network targets, while `PI_SKIP_VERSION_CHECK` from
packages such as `pi-updater` no longer breaks the flow because Auto Update
never invokes Pi's self-update path.

A new agent turn aborts the active command and defers remaining automatic work.
Disabling Auto Update cancels pending work; reload and shutdown abort stale
work. The coordinator never runs automatically in headless sessions and never
restarts Pi. Bounded, redacted target results are cached under
`<globalAgentDir>/sf-pi/auto-update/status.json` so SF Welcome can render status
without running commands.

### 7. Doctor repairs are non-destructive

`/sf-pi doctor` scans local settings and skill roots for startup issues such
as duplicate skill names, stale `settings.skills[]` entries, unwired external
skill folders, and duplicate sf-pi package entries. `/sf-pi doctor runtime`
adds read-only runtime preflight details for Pi/Node/npm path and version
mismatches. `doctor fix` only applies safe repairs after confirmation: startup
mode is switched to quiet/header, stale skill paths are pruned, available
external roots are linked, and duplicate `sf-*` skills in pi-owned roots are
moved to `~/.pi/agent/skills-quarantine/` instead of being deleted.

## Behavior Matrix

| Trigger                | Condition                  | Result                                 |
| ---------------------- | -------------------------- | -------------------------------------- |
| /sf-pi (no args)       | has UI                     | Open TUI overlay                       |
| /sf-pi (no args)       | no UI                      | Fall back to list                      |
| /sf-pi list            | package in settings        | Show extension states                  |
| /sf-pi list            | package NOT in settings    | Show states (all enabled assumed)      |
| /sf-pi enable \<id\>   | valid, currently disabled  | Remove exclusion, reload               |
| /sf-pi enable \<id\>   | valid, already enabled     | Notify "already enabled"               |
| /sf-pi enable \<id\>   | alwaysActive               | Notify "cannot toggle"                 |
| /sf-pi disable \<id\>  | valid, currently enabled   | Add exclusion, reload                  |
| /sf-pi disable-all     | —                          | Exclude all non-alwaysActive, reload   |
| /sf-pi enable-all      | —                          | Remove all exclusions, reload          |
| /sf-pi display         | no profile                 | Show effective display profile         |
| /sf-pi display <name>  | compact/balanced/verbose   | Save shared display profile            |
| /sf-pi auto-update     | no arg / `status`          | Show Native Auto Update status         |
| /sf-pi auto-update on  | —                          | Enable daily native Auto Update        |
| /sf-pi auto-update off | —                          | Disable daily native Auto Update       |
| /sf-pi auto-update run | —                          | Run native update sequence now         |
| /sf-pi doctor          | —                          | Show setup diagnostics                 |
| /sf-pi doctor runtime  | —                          | Show Pi/Node/npm runtime preflight     |
| /sf-pi doctor fix      | user confirms              | Apply safe repairs and reload          |
| /sf-pi telemetry       | no arg / `status`          | Show pi anonymous-telemetry posture    |
| /sf-pi telemetry off   | —                          | Write `enableInstallTelemetry: false`  |
| /sf-pi telemetry on    | —                          | Write `enableInstallTelemetry: true`   |
| TUI list → Enter       | —                          | Open user-first extension detail view  |
| TUI list → Esc         | changes pending            | Apply exclusions, reload if needed     |
| TUI detail → Esc       | —                          | Return to extension list               |
| session_start          | cadence due + interactive  | Record Auto Update as pending          |
| agent_start            | update running             | Abort and defer remaining work         |
| agent_settled          | pending + consented + idle | Run one bounded update plan            |
| session_shutdown       | —                          | Cancel stale work; clear footer status |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-pi-manager/
  lib/
    announcements.ts        ← implementation module
    auto-update-command.ts  ← implementation module
    auto-update-coordinator.ts← implementation module
    auto-update-package-plan.ts← implementation module
    auto-update-runner.ts   ← implementation module
    auto-update-transcript.ts← implementation module
    config-panel.ts         ← implementation module
    doctor-command.ts       ← implementation module
    extension-aliases.ts    ← implementation module
    extension-details.ts    ← implementation module
    overlay.ts              ← implementation module
    recommendations-install.ts← implementation module
    recommendations-overlay.ts← implementation module
    recommendations.ts      ← implementation module
    render.ts               ← implementation module
    skill-sources-command.ts← implementation module
    telemetry-command.ts    ← implementation module
  tests/
    announcements-command.test.ts← unit / smoke test
    auto-update-command.test.ts← unit / smoke test
    auto-update-coordinator.test.ts← unit / smoke test
    auto-update-package-plan.test.ts← unit / smoke test
    auto-update-real-pi.test.ts← unit / smoke test
    auto-update-runtime-orchestration.test.ts← unit / smoke test
    auto-update-transcript.test.ts← unit / smoke test
    catalog-event-attestation.test.ts← unit / smoke test
    command-parsing.test.ts ← unit / smoke test
    config-panel.test.ts    ← unit / smoke test
    doctor-command.test.ts  ← unit / smoke test
    extension-aliases.test.ts← unit / smoke test
    extension-details.test.ts← unit / smoke test
    extension-state.test.ts ← unit / smoke test
    mode-behavior.test.ts   ← unit / smoke test
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
11. **Settings I/O** — `../../lib/common/sf-pi-settings.ts` (shared)
12. **Package entry discovery** — `../../lib/common/sf-pi-package-state.ts` (shared)
13. **Extension state read/write** — `../../lib/common/sf-pi-package-state.ts` (shared)
14. **TUI Overlay** — `SfPiOverlayComponent` with list/detail/settings navigation; detail pages stay user-first and omit developer file/capability metadata
15. **Recommended extensions** — manifest/state in `recommendations*.ts`
16. **External skill roots** — `/sf-pi skills` in `skill-sources*.ts`

## Testing Strategy

Tests cover exported pure helpers (package detection, extension state,
project/global precedence, command parsing, detail metadata helpers,
user-first detail rendering, recommendation state/install helpers, announcement
commands, and external skill-root settings writes). The full command handlers
are tested via manual QA.

To run: `npm test`

Exported helpers are marked with `// Exported for unit tests.` in the source.

## Troubleshooting

**`/sf-pi` says "package not found in settings":**
Run `pi install .` from the repo root, or `pi install git:github.com/salesforce/sf-pi`,
so pi registers the package in `settings.json`. The manager finds itself
via name-based (`sf-pi` / `jag-pi-extensions`) or path-based detection
— a symlink from `pi install .` resolves to the repo root.

**`pi --version` is outside SF Pi's audited runtime window:**
Run `/sf-pi doctor runtime`. SF Pi supports `>=0.81.1 <0.82.0` and recommends
exact Pi 0.81.1. The report shows active
`pi`, `node`, and `npm` executables, package/version mismatches, release-age
policy, and a bounded exact-version fallback. Do not run a latest-version Pi
update until the secure native credential-prompt milestone lands.

**Disabling an extension through the manager doesn't take effect:**
Pi reads the package filter at startup. After a disable, the manager
calls `ctx.reload()` to pick up the new exclusion pattern. If your pi
runtime doesn't support `reload`, close and reopen the session.

**`/sf-pi enable-all` still leaves some extensions disabled:**
Extensions marked `alwaysActive: true` in their manifest cannot be
toggled through the manager — they're always on. `enable-all` removes
all exclusion patterns; disabled extensions that still appear are the
always-active ones (like `sf-pi-manager` itself).

**Auto Update is on but Herdr was not updated:**
Run `/sf-pi auto-update status`. Automatic package updates are deliberately
limited to outdated, unpinned global npm packages whose latest metadata declares
compatibility with the active Pi and Node runtimes. A pinned, project-scoped,
local, git, already-current, incompatible, or unverifiable Herdr installation is
left untouched. Use Pi's explicit package command when you intentionally want to
change one of those constraints.

**Auto Update says it is waiting for `agent_settled`:**
This is expected. Startup records due work without mutating the machine. The
coordinator runs after the next fully settled agent turn, rechecks opt-in and
idle state, and cancels or defers if a new turn, reload, or shutdown overlaps.
`/sf-pi auto-update run` remains the explicit immediate action.

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
