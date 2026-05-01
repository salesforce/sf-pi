<!-- SPDX-License-Identifier: Apache-2.0 -->

# lib/common — Shared helpers

This folder holds code that **multiple** extensions depend on. Anything that
can reasonably live inside a single extension should stay there; only promote
to `lib/common` when a second (or third) extension needs the same behavior
and the contract is stable.

See [`../AGENTS.md`](../../AGENTS.md) for the repo-wide rules. Per-extension
code lives in `extensions/<id>/lib/`.

## Module map

| Module                                      | Owners (what uses it)                                                       | What it provides                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pi-compat.ts`                              | all extensions                                                              | Feature-detecting shims for pi APIs that may not exist on older pi runtimes      |
| `pi-paths.ts`                               | all extensions that touch settings                                          | Global + project `settings.json` paths, pi home dir resolution                   |
| `exec-adapter.ts`                           | `sf-environment` consumers                                                  | Adapter from `pi.exec()` to the `ExecFn` type used by `sf-environment/detect.ts` |
| `glyph-policy.ts`                           | `sf-welcome`, `sf-devbar`                                                   | Decides emoji vs ASCII glyphs based on terminal + user prefs + env vars          |
| `display/types.ts`                          | `sf-pi-manager`, `sf-lsp`, `sf-agentscript-…`                               | `SfPiDisplayProfile` union + shared display types                                |
| `display/settings.ts`                       | `sf-pi-manager`                                                             | Read/write the shared `sfPi.display.profile` setting (project > global)          |
| `display/diagnostics.ts`                    | `sf-lsp`, `sf-agentscript-assist`                                           | `details.sfPiDiagnostics` contract for LSP-style tool results                    |
| `monthly-usage/store.ts`                    | `sf-llm-gateway-internal` (producer); `sf-welcome`, `sf-devbar` (consumers) | Decoupled monthly-usage state store with refresher registration                  |
| `catalog-state/announcements-manifest.ts`   | `sf-welcome`, `sf-pi-manager`                                               | Load + validate `catalog/announcements.json`                                     |
| `catalog-state/announcements-state.ts`      | `sf-welcome`, `sf-pi-manager`                                               | Per-user announcements dismissal/ack state file                                  |
| `catalog-state/recommendations-manifest.ts` | `sf-welcome`, `sf-pi-manager`                                               | Load + validate `catalog/recommendations.json` and resolve bundles               |
| `catalog-state/recommendations-state.ts`    | `sf-welcome`, `sf-pi-manager`                                               | Per-user recommendation decisions + ack state file                               |
| `sf-environment/detect.ts`                  | shared runtime                                                              | Pure detection logic — runs SF CLI, parses config, returns a snapshot            |
| `sf-environment/shared-runtime.ts`          | `sf-welcome`, `sf-devbar`, others                                           | In-memory + persisted cache so startup runs SF CLI **once** per session          |
| `sf-environment/persisted-cache.ts`         | shared runtime                                                              | Disk persistence for the last-known snapshot                                     |
| `sf-environment/format-agent-context.ts`    | `sf-slack`, `sf-devbar`                                                     | Shared `[Salesforce Environment]` context-block formatter                        |
| `sf-environment/types.ts`                   | all SF-aware extensions                                                     | `SfEnvironment` snapshot shape                                                   |
| `test-fixtures.ts`                          | tests across extensions                                                     | Shared factories for Pi context stubs + common fixtures                          |
| `tests/`                                    | —                                                                           | Tests for the shared modules themselves                                          |

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
- **Every module has a SPDX header and a block comment** explaining _why_
  it's shared and _what contract_ it guarantees.
- **Pure where possible.** Side-effectful code (timers, fetches, process
  mutations) belongs in an extension unless it's a deliberate shared
  store (monthly-usage) or cache (sf-environment).
- **Tests co-locate in `lib/common/tests/`** (there is no per-module
  `tests/` folder inside `lib/common`).

## Related docs

- [`../../AGENTS.md`](../../AGENTS.md) — repo-wide agent rules
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — repo conventions
- [`../../docs/commands.md`](../../docs/commands.md) — generated command reference
