<!-- SPDX-License-Identifier: Apache-2.0 -->

# lib/common — Shared helpers

This folder holds code that **multiple** extensions depend on. Anything that
can reasonably live inside a single extension should stay there; only promote
to `lib/common` when a second (or third) extension needs the same behavior
and the contract is stable.

See [`../AGENTS.md`](../../AGENTS.md) for the repo-wide rules. Per-extension
code lives in `extensions/<id>/lib/`.

## Module map

| Module                                        | Owners (what uses it)                                              | What it provides                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `command-actions.ts`                          | command-bearing extensions (incremental adoption)                  | One catalog → panel rows + completions + help + README table                                 |
| `command-panel.ts`                            | command-bearing extensions                                         | Shared grouped status/actions panel built on Pi's native `ctx.ui.custom()`                   |
| `info-panel.ts`                               | command-bearing extensions                                         | In-TUI info popup with RPC notification and console fallback                                 |
| `human-only-command-output.ts`                | `sf-feedback`, `sf-llm-gateway`                                    | Mode-safe command reports via UI/entries/print without adding model context                  |
| `secure-credential-prompt.ts`                 | `sf-docs`, `sf-slack`, `sf-llm-gateway`                            | Session-bound fixed-mask TUI credential entry while Pi owns persistence/logout               |
| `auth-only-provider.ts`                       | `sf-docs`, `sf-slack`                                              | Complete no-model Pi Provider wrapper for API-key/OAuth-compatible authentication            |
| `extension-toggle.ts`                         | every command-bearing extension                                    | Shared "Disable / Enable this extension" action row + `performToggleExtension`               |
| `sf-pi-package-resolution.ts`                 | `sf-pi-package-state.ts`, `sf-pi-extension-state.ts`               | Shared sf-pi package-source matching and extension filter interpretation                     |
| `sf-pi-package-root.ts`                       | catalog-state helpers, `sf-data-explorer`                          | Pi-package-manager-backed sf-pi package root lookup with dev-run fallback                    |
| `sf-pi-package-state.ts`                      | `extension-toggle.ts`, `sf-pi-manager`                             | Read/write sf-pi's package filter list in pi `settings.json`                                 |
| `sf-pi-settings.ts`                           | `sf-pi-package-state.ts`, `sf-pi-manager`, `sf-llm-gateway`        | Tiny tolerant JSON read/write for global + project pi `settings.json`                        |
| `pi-auth-status.ts`                           | `sf-slack`, `sf-docs`                                              | Status-only Pi auth-store inspection for config panels without exposing token values         |
| `ui-glyphs.ts`                                | command-bearing extensions                                         | Semantic UI glyphs for panels/popups with ASCII fallback (rides `glyph-policy`)              |
| `pi-compat.ts`                                | all extensions                                                     | Feature-detecting shims for pi APIs that may not exist on older pi runtimes                  |
| `pi-paths.ts`                                 | all extensions that touch settings                                 | Global + project `settings.json` paths, pi home dir resolution                               |
| `state-store.ts`                              | extensions that persist per-user/project state                     | Shared `createStateStore<T>()`: scoped paths, atomic write, schema versioning, safe defaults |
| `exec-adapter.ts`                             | `sf-environment` consumers                                         | Adapter from `pi.exec()` to the `ExecFn` type used by `sf-environment/detect.ts`             |
| `sf-conn/index.ts`                            | every Salesforce-org API consumer                                  | Salesforce Connection Module Interface: target, version, connection, request, and query      |
| `sf-conn/connection.ts`                       | `sf-conn/index.ts` implementation                                  | Lazy cached `@salesforce/core` Org lookup with bounded targeted refresh                      |
| `sf-conn/request.ts`                          | `sf-conn/index.ts` implementation                                  | Bounded HTTP-as-data transport with one authentication refresh and total deadline            |
| `sf-conn/path.ts`                             | `sf-conn/index.ts` implementation                                  | Safe version-owned resource path and query-string construction                               |
| `sf-rest/path.ts`                             | migration-only consumers                                           | Legacy REST path helper; deleted after Salesforce Connection Module migration                |
| `sf-rest/target-org.ts`                       | migration-only consumers                                           | Legacy target/version helper; deleted after Salesforce Connection Module migration           |
| `glyph-policy.ts`                             | `sf-welcome`, `sf-devbar`                                          | Decides emoji vs ASCII glyphs based on terminal + user prefs + env vars                      |
| `display/types.ts`                            | `sf-pi-manager`, `sf-lsp`, `sf-agentscript-…`                      | `SfPiDisplayProfile` union + shared display types                                            |
| `display/settings.ts`                         | `sf-pi-manager`                                                    | Read/write the shared `sfPi.display.profile` setting (project > global)                      |
| `display/diagnostics.ts`                      | `sf-lsp`, `sf-agentscript`                                         | `details.sfPiDiagnostics` contract for LSP-style tool results                                |
| `doctor/diagnostics.ts`                       | `sf-pi-manager`, `sf-welcome`                                      | Read-only diagnostics powering `/sf-pi doctor` (side-effect free)                            |
| `doctor/fixes.ts`                             | `sf-pi-manager`                                                    | Safe-repair operations for `/sf-pi doctor fix startup`/`skills` (gated by HITL)              |
| `doctor/types.ts`                             | `sf-pi-manager`, `sf-welcome`                                      | Shared diagnostic + fix-target shapes                                                        |
| `monthly-usage/store.ts`                      | `sf-llm-gateway` (producer); `sf-welcome`, `sf-devbar` (consumers) | Decoupled monthly-usage state store with refresher registration                              |
| `slack-status/store.ts`                       | `sf-slack` (producer); `sf-welcome`, `sf-devbar` (consumers)       | Decoupled Slack auth/readiness status store                                                  |
| `sf-lsp-health/index.ts`                      | `sf-lsp` (producer); `sf-welcome` (consumer)                       | In-process LSP availability + activity registry; powers the one-line Welcome readiness row   |
| `sf-lsp-health/types.ts`                      | `sf-lsp`, `sf-welcome`                                             | Supported-language labels and shared registry types                                          |
| `herdr.ts`                                    | `sf-herdr`, `sf-code-analyzer`                                     | Small shared Herdr intent/workflow vocabulary and cross-extension handoff shape              |
| `herdr-runtime.ts`                            | `sf-herdr`, `sf-welcome`                                           | Current split-tool names and environment/tool readiness calculation                          |
| `skill-sources/skill-sources.ts`              | `sf-pi-manager`, `sf-welcome`                                      | Detects + wires Claude Code / Codex / Cursor skill roots for `/sf-pi skills`                 |
| `sf-pi-extension-state.ts`                    | `sf-welcome`, `sf-devbar`, diagnostics                             | Shared bundled-extension enablement checks from Pi package filters                           |
| `catalog-state/announcements-manifest.ts`     | `sf-welcome`, `sf-pi-manager`                                      | Load + validate `catalog/announcements.json`                                                 |
| `catalog-state/announcements-state.ts`        | `sf-welcome`, `sf-pi-manager`                                      | Per-user announcements dismissal/ack state file                                              |
| `catalog-state/announcements-orchestrator.ts` | `sf-welcome`, `sf-pi-manager`                                      | Compose bundled + remote + update-nudge feed into a render-ready payload                     |
| `catalog-state/announcements-remote.ts`       | `announcements-orchestrator`                                       | Optional network fetch for the remote announcements feed                                     |
| `catalog-state/announcements-update.ts`       | `announcements-orchestrator`                                       | Synthesize the "new sf-pi version available" nudge from CHANGELOG diff                       |
| `catalog-state/announcements-filter.ts`       | `announcements-orchestrator`                                       | Pure merge / filter / sort rules (severity, expiry, version gates)                           |
| `catalog-state/recommendations-manifest.ts`   | `sf-welcome`, `sf-pi-manager`                                      | Load + validate `catalog/recommendations.json` and resolve bundles                           |
| `catalog-state/recommendations-state.ts`      | `sf-welcome`, `sf-pi-manager`                                      | Per-user recommendation decisions + ack state file                                           |
| `catalog-state/whats-new.ts`                  | `sf-welcome`, orchestrator                                         | Parse the pi-coding-agent CHANGELOG into the splash-ready bullet payload                     |
| `sf-environment/detect.ts`                    | shared runtime                                                     | Detection plus configured/resolved/SDK-fallback Connection API provenance                    |
| `sf-environment/shared-runtime.ts`            | `sf-welcome`, `sf-devbar`, others                                  | Cache-first snapshots plus serialized deep refresh for explicit user actions                 |
| `sf-environment/display-fallback.ts`          | `sf-devbar`, future compact org status surfaces                    | Shared Org Status Fallback Boundary / stale display selection                                |
| `sf-environment/persisted-cache.ts`           | shared runtime                                                     | Disk persistence for the last-known snapshot                                                 |
| `sf-environment/format-agent-context.ts`      | `sf-slack`, `sf-devbar`                                            | Shared `<sf_environment>` context-block formatter                                            |
| `sf-environment/types.ts`                     | all SF-aware extensions                                            | `SfEnvironment` snapshot shape, including optional Connection API provenance                 |
| `test-fixtures.ts`                            | tests across extensions                                            | Shared factories for Pi context stubs + common fixtures                                      |
| `tests/`                                      | —                                                                  | Tests for the shared modules themselves                                                      |

## State-persistence decision tree

ADR 0006 pins one rule for "where do I put state X?". Walk top-down, stop at first match:

```
Q1. Is the state tied to the current conversation/session?
    YES → use pi.appendEntry<T>(customType, data)
          (auto-replays on resume/fork/reload; no disk plumbing required)
          Examples: send audit, allow-for-this-session, kernel injection, prefs

Q2. Is the state read by 2+ extensions in the same process?
    YES → register a shared store under lib/common/<topic>/store.ts
          Producer pushes via setState; consumers subscribe via onChange.
          Examples: sf-environment, monthly-usage, slack-status, sf-lsp-health

Q3. Is the state a user-facing pi setting they'd hand-edit?
    YES → mutate pi settings.json via lib/common/sf-pi-settings.ts helpers
          Project > global precedence; never write opaque blobs there.
          Examples: package filter list, provider/model config, default thinking level

Q4. Otherwise (per-user/project persisted state, sf-pi only) →
    use the shared lib/common/state-store.ts helper.
    Global file path: <globalAgentDir>/sf-pi/<namespace>/<filename>.json
    Project file path: <cwd>/.pi/<namespace>/<filename>.json
    Always: schemaVersion, atomic write (tmp + rename), safe defaults on parse error.
    Pass `mode: 0o600` for files that hold a token or other secret.
```

The `npm run docs:health:check` lint refuses any `state-store.ts` inside an
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
