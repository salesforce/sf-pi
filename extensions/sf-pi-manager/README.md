# SF Pi Manager

## What It Does

SF Pi Manager is the package home base. `/sf-pi` lets users browse extensions,
open human-facing detail pages, edit low-risk settings, run diagnostics, manage
recommended packages and external skill roots, and enable or disable bundled
extensions through Pi's native package filters.

The Manager is always active. Extension state changes update `settings.json` and
reload Pi because package filters are evaluated at startup.

## Commands

Common commands are:

```text
/sf-pi
/sf-pi doctor
/sf-pi status
/sf-pi open <extension-id>
/sf-pi enable <extension-id> [global|project]
/sf-pi disable <extension-id> [global|project]
/sf-pi display <compact|balanced|verbose>
/sf-pi announcements
/sf-pi recommended
/sf-pi auto-update status
/sf-pi help
```

The Manager detail page is the primary no-args destination for bundled extension
commands. Explicit subcommands remain direct and scriptable.

## Configuration

Manager-owned settings include package filters, shared display profile, privacy
preference controls, announcements/recommendations state, doctor repairs, and
opt-in Native Auto Update. Project settings override global settings where a
surface supports both scopes.

SF Pi sets Pi's anonymous install/update telemetry preference to `false` only
when the user has never chosen a value. Explicit `true` or `false` choices are
preserved and `/sf-pi telemetry` reports whether the value is an SF Pi default or
user override.

Native Auto Update is off by default. When enabled, due work waits for an
interactive `agent_settled` boundary, uses an atomic machine lock, and handles
eligible package and Salesforce CLI targets independently. It never updates the
Pi Runtime itself. Package automation is limited to outdated, unpinned global
npm packages whose metadata declares compatibility with the active Pi and Node
versions.

## Safety and Data Boundaries

- Only SF Pi Manager writes the package-filter enable/disable state.
- Native Auto Update is opt-in, interactive-only, abortable, output-redacted,
  and bounded to eligible unpinned npm packages plus the Salesforce CLI step.
- Pinned, local, Git, project-scoped, incompatible, and unverifiable packages
  are skipped rather than rewritten.
- `/sf-pi doctor fix` performs only named safe repairs after confirmation and
  quarantines duplicate skills instead of deleting them.
- Extensions marked `alwaysActive` cannot be disabled through the standard
  toggle path.

## Troubleshooting

**The Manager cannot find SF Pi in settings:** Install with `pi install .` from
the repository or `pi install git:github.com/salesforce/sf-pi` so Pi records the
package source.

**A toggle does not take effect:** Allow the requested reload, or restart Pi if
the active runtime cannot reload package filters.

**A newer stable Pi version is outside the audited window:** Run
`/sf-pi doctor runtime`. Supported 0.x versions can load in forward-compatibility
mode; do not downgrade without a concrete failure.

**Auto Update skipped a package:** Run `/sf-pi auto-update status`. Pinned,
project, local, Git, current, incompatible, and unverifiable installations are
intentionally outside the automatic path.

**Auto Update waits for `agent_settled`:** This is expected. A new turn, reload,
shutdown, or settings change cancels or defers the pending automatic work.

**Project changes do not stick:** Project settings live under
`<cwd>/.pi/settings.json` and win over global settings. Pass the intended scope
explicitly when changing extension state.

**Recommended items or skill roots look stale:** Announcements, recommendations,
and skill-source decisions are revision/state based. Use their Manager pages and
`/sf-pi doctor` before editing state files manually.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-pi-manager/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
