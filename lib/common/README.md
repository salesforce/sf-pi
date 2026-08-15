<!-- SPDX-License-Identifier: Apache-2.0 -->

# lib/common — Shared helpers

This folder holds code that **multiple** extensions depend on. Anything that
can reasonably live inside a single extension should stay there; only promote
to `lib/common` when a second (or third) extension needs the same behavior
and the contract is stable.

See [`../AGENTS.md`](../../AGENTS.md) for the repo-wide rules. Per-extension
code lives in `extensions/<id>/lib/`.

## Stable shared interfaces

This is a selected interface guide, not a hand-maintained complete file map:

| Interface                     | Contract                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| `sf-conn/index.ts`            | Salesforce target, API version, authentication, request, and query boundary |
| `sf-environment/`             | Cache-first Salesforce environment detection and display state              |
| `state-store.ts`              | Versioned, atomic per-user/project SF Pi state                              |
| `sf-pi-settings.ts`           | Tolerant global/project Pi settings access                                  |
| `sf-pi-package-state.ts`      | SF Pi package-filter enablement updates                                     |
| `command-actions.ts`          | Shared command metadata for panels, completion, and help                    |
| `manager-deep-link.ts`        | Manager-first extension navigation                                          |
| `display/`                    | Shared result details, diagnostics, profiles, and width-safe rendering      |
| `doctor/`                     | Read-only diagnostics and explicitly confirmed repairs                      |
| `secure-credential-prompt.ts` | Fixed-mask credential entry while Pi owns persistence/logout                |
| `privacy/`                    | Telemetry-default assertion and state                                       |
| `session/`                    | Active-branch session projection helpers                                    |

## Complete top-level inventory

<!-- GENERATED:common-modules:start -->

This complete top-level inventory is generated from `lib/common/`. Directory counts include nested TypeScript files.

| Path                           | Kind      | Production TypeScript | Test TypeScript |
| ------------------------------ | --------- | --------------------: | --------------: |
| `auth-only-provider.ts`        | module    |                     1 |               0 |
| `auto-update/`                 | directory |                     2 |               0 |
| `boot-timing.ts`               | module    |                     1 |               0 |
| `browser-runtime-status/`      | directory |                     1 |               0 |
| `catalog-state/`               | directory |                     9 |               0 |
| `code-analyzer-status/`        | directory |                     1 |               0 |
| `color-policy.ts`              | module    |                     1 |               0 |
| `command-actions.ts`           | module    |                     1 |               0 |
| `command-panel.ts`             | module    |                     1 |               0 |
| `display/`                     | directory |                     4 |               5 |
| `doctor/`                      | directory |                     5 |               2 |
| `exec-adapter.ts`              | module    |                     1 |               0 |
| `extension-toggle.ts`          | module    |                     1 |               0 |
| `glyph-policy.ts`              | module    |                     1 |               0 |
| `herdr-runtime.ts`             | module    |                     1 |               0 |
| `herdr.ts`                     | module    |                     1 |               0 |
| `human-only-command-output.ts` | module    |                     1 |               0 |
| `info-panel.ts`                | module    |                     1 |               0 |
| `manager-actions.ts`           | module    |                     1 |               0 |
| `manager-deep-link.ts`         | module    |                     1 |               0 |
| `monthly-usage/`               | directory |                     2 |               0 |
| `npm-release-age-policy.ts`    | module    |                     1 |               0 |
| `pi-auth-status.ts`            | module    |                     1 |               0 |
| `pi-compat.ts`                 | module    |                     1 |               0 |
| `pi-paths.ts`                  | module    |                     1 |               0 |
| `privacy/`                     | directory |                     2 |               2 |
| `redaction.ts`                 | module    |                     1 |               0 |
| `runtime-floor.ts`             | module    |                     1 |               0 |
| `safe-command-handler.ts`      | module    |                     1 |               0 |
| `secure-credential-prompt.ts`  | module    |                     1 |               0 |
| `session/`                     | directory |                     2 |               0 |
| `sf-browser-snapshot-state.ts` | module    |                     1 |               0 |
| `sf-conn/`                     | directory |                     5 |               0 |
| `sf-environment/`              | directory |                     6 |               4 |
| `sf-lsp-health/`               | directory |                     2 |               1 |
| `sf-pi-extension-state.ts`     | module    |                     1 |               0 |
| `sf-pi-package-resolution.ts`  | module    |                     1 |               0 |
| `sf-pi-package-root.ts`        | module    |                     1 |               0 |
| `sf-pi-package-state.ts`       | module    |                     1 |               0 |
| `sf-pi-settings.ts`            | module    |                     1 |               0 |
| `skill-detection/`             | directory |                     2 |               0 |
| `skill-sources/`               | directory |                     2 |               0 |
| `slack-status/`                | directory |                     1 |               0 |
| `state-store.ts`               | module    |                     1 |               0 |
| `test-fixtures.ts`             | module    |                     1 |               0 |
| `tests/`                       | directory |                     0 |              39 |
| `tldraw-status/`               | directory |                     1 |               0 |
| `ui-glyphs.ts`                 | module    |                     1 |               0 |

<!-- GENERATED:common-modules:end -->

## State-persistence decision tree

ADR 0006 pins one rule for "where do I put state X?". Walk top-down, stop at first match:

```
Q1. Is the state tied to the current conversation/session?
    YES → use pi.appendEntry<T>(customType, data)
          (auto-replays on resume/fork/reload; no disk plumbing required)
          Examples: send audit, allow-for-this-session, current-run pointers

Q2. Is the state read by 2+ extensions in the same process?
    YES → register a shared store under lib/common/<topic>/store.ts
          Producer pushes via setState; consumers subscribe via onChange.
          Examples: sf-environment, monthly-usage, slack-status, sf-lsp-health

Q3. Is the state a user-facing pi setting they'd hand-edit?
    YES → mutate pi settings.json via lib/common/sf-pi-settings.ts helpers
          Project > global precedence; never write opaque blobs there.
          Examples: package filter list, display profile, extension preferences

Q4. Otherwise (per-user/project persisted state, sf-pi only) →
    use the shared lib/common/state-store.ts helper.
    Global file path: <globalAgentDir>/sf-pi/<namespace>/<filename>.json
    Project file path: <cwd>/.pi/<namespace>/<filename>.json
    Always: schemaVersion, atomic write (tmp + rename), safe defaults on parse error.
    Pass `mode: 0o600` for files that hold a token or other secret.
```

The `npm run check:architecture` lint refuses any `state-store.ts` inside an
extension that does not delegate to `lib/common/state-store.ts`. Existing
Q4 callers (`extensions/sf-welcome/lib/state-store.ts`,
`lib/common/catalog-state/announcements-state.ts`,
`lib/common/catalog-state/recommendations-state.ts`) keep their on-disk
locations via `pathOverride` so existing dismissals and decisions survive.

## When to add code here

Add a module to `lib/common` **only** when all of these hold:

1. Two or more extensions genuinely need the same behavior.
2. The contract is stable enough that renaming or shape changes will be
   rare. If it's still churning, keep it inside one extension until the
   second caller shows up.
3. The module is **small and focused**. "Generic utility bags" are a
   non-goal (see root `AGENTS.md`).
4. It does **not** couple two extensions that should otherwise stay
   independent. Cross-extension contracts go through an explicit shared
   store (see `monthly-usage/store.ts` for the pattern: producer registers
   a refresher, consumers read through the store and never import the
   producer).

## When to keep code inside an extension

Keep code in `extensions/<id>/lib/` when:

- Only that one extension uses it.
- The behavior is specific to that extension's UI, events, or tool shape.
- Moving it would force the shared module to know about extension-specific
  types.

## Conventions

- **No circular imports between `lib/common` and `extensions/`.** Shared
  code must not import from any `extensions/*`. Extensions import from
  `lib/common`, not the other way.
- **Every module has an SPDX header.** Add comments for non-obvious shared
  contracts and rationale, not obvious syntax.
- **Pure where possible.** Side-effectful code (timers, fetches, process
  mutations) belongs in an extension unless it's a deliberate shared
  store (monthly-usage) or cache (sf-environment).
- **Tests co-locate in `lib/common/tests/`** (there is no per-module
  `tests/` folder inside `lib/common`).

## Related docs

- [`../../AGENTS.md`](../../AGENTS.md) — repo-wide agent rules
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — repo conventions
- [`../../docs/commands.md`](../../docs/commands.md) — generated command reference
