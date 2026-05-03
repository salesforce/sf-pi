# Architecture

This document describes the structure and conventions of the sf-pi extension
suite. Read this first when onboarding, adding extensions, or troubleshooting.

## Folder Layout

> Generated from `extensions/*/manifest.json`. Run `npm run generate-catalog`
> to refresh. The canonical extension list lives in
> [`catalog/index.json`](./catalog/index.json).

<!-- GENERATED:folder-layout:start -->

```
sf-pi/
├── .github/
│   └── workflows/              ← CI, release-please, sync-agentforce-sdk
├── AGENTS.md                   ← Repo rules for agents and contributors
├── ARCHITECTURE.md             ← Repo structure and conventions (this file)
├── CONTRIBUTING.md             ← Human-friendly contributor workflow
├── README.md                   ← User-facing quick start
├── ROADMAP.md                  ← What's next, milestones, non-goals
├── CHANGELOG.md                ← Release history (managed by release-please)
├── extensions/                 ← All extensions live here (self-contained)
│   ├── sf-agentscript-assist/
│   ├── sf-brain/
│   ├── sf-devbar/
│   ├── sf-guardrail/
│   ├── sf-llm-gateway-internal/
│   ├── sf-lsp/
│   ├── sf-ohana-spinner/
│   ├── sf-pi-manager/
│   ├── sf-skills-hud/
│   ├── sf-slack/
│   ├── sf-welcome/
├── lib/
│   └── common/                 ← Shared helpers (see lib/common/README.md)
├── catalog/                    ← Generated registry + hand-written types
│   ├── types.ts                ← Hand-maintained type definitions
│   ├── registry.ts             ← GENERATED from manifest.json files
│   └── index.json              ← GENERATED machine-readable index
├── docs/
│   └── commands.md             ← GENERATED per-extension command reference
├── scripts/
│   ├── generate-catalog.mjs    ← Reads manifests, writes registry + index + docs
│   ├── scaffold.mjs            ← Scaffolds a new extension
│   └── validate.sh             ← Full validation (generate + format + check + test)
├── themes/                     ← TUI themes (sf-dark.json, …)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

<!-- GENERATED:folder-layout:end -->

## Where does X live? (agent quick-reference)

When an agent (or human) needs to change something, start here:

| I want to change...                             | Look in                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Extension metadata (name/category/commands)     | `extensions/<id>/manifest.json` — then `npm run generate-catalog`        |
| Extension entry point / lifecycle hooks         | `extensions/<id>/index.ts`                                               |
| Extension implementation modules                | `extensions/<id>/lib/*.ts`                                               |
| Extension config panel (when `configurable`)    | `extensions/<id>/lib/config-panel.ts` — must export `createConfigPanel`  |
| Extension tests                                 | `extensions/<id>/tests/*.test.ts` (vitest)                               |
| Extension human-facing docs                     | `extensions/<id>/README.md`                                              |
| Extension-specific agent rules                  | `extensions/<id>/AGENTS.md` (optional, see below)                        |
| Extension-specific roadmap                      | `extensions/<id>/ROADMAP.md` (optional, see below)                       |
| Slash command handlers                          | `extensions/<id>/index.ts` — most handle their own commands              |
| Shared Pi-runtime shims                         | `lib/common/pi-compat.ts`, `lib/common/pi-paths.ts`                      |
| Shared SF environment detection                 | `lib/common/sf-environment/`                                             |
| Shared glyph/ASCII policy                       | `lib/common/glyph-policy.ts`                                             |
| Shared display profile + diagnostics contract   | `lib/common/display/`                                                    |
| Generated registry (for runtime extension load) | `catalog/registry.ts` — **generated, do not edit**                       |
| Generated machine-readable index                | `catalog/index.json` — **generated, do not edit**                        |
| Generated command reference                     | `docs/commands.md` — **generated, do not edit**                          |
| Generated bundled-extension table               | Inside `README.md` between `GENERATED:bundled-extensions` markers        |
| Generated command-reference block               | Inside `README.md` between `GENERATED:command-reference` markers         |
| Generated folder layout                         | Inside `ARCHITECTURE.md` between `GENERATED:folder-layout` markers       |
| Generated troubleshooting index                 | Inside `README.md` between `GENERATED:troubleshooting-index` markers     |
| Hand-maintained registry types                  | `catalog/types.ts`                                                       |
| Recommended external extensions (curated list)  | `catalog/recommendations.json` — hand-maintained, validated by generator |
| Recommended-extension runtime code              | `extensions/sf-pi-manager/lib/recommendations*.ts`                       |
| Recommended-extension user state                | `<globalAgentDir>/state/sf-pi/recommendations.json` — machine-written    |
| CI / release automation                         | `.github/workflows/`                                                     |
| Repo rules for contributors / agents            | `AGENTS.md`, `CONTRIBUTING.md`                                           |
| Repo conventions and structure                  | this file                                                                |

`catalog/index.json` also carries a `srcLoc` field per extension — use it
to gauge the size of an extension before diving in.

## Key Concepts

### Extensions are self-contained folders

Each extension lives in `extensions/<id>/` with everything co-located:

- `index.ts` — Pi entry point (exports `default function(pi: ExtensionAPI)`)
- `manifest.json` — Metadata that drives the catalog generator
- `README.md` — Architecture and usage documentation
- `lib/` — Implementation modules (imported by index.ts)
- `tests/` — Co-located tests (vitest)

This means you can `ls extensions/<id>/` and see everything related to that
extension without navigating multiple top-level directories.

### Per-extension `AGENTS.md` and `ROADMAP.md`

A few extensions carry their own `AGENTS.md` with editing rules specific
to that extension, and/or a `ROADMAP.md` for phased work. These are
**optional** and only worth adding when the extension has non-obvious
rules or multi-phase plans.

Current examples:

- `extensions/sf-slack/AGENTS.md` — HITL rules, file map for 9 tools
- `extensions/sf-llm-gateway-internal/AGENTS.md` — dual-provider rules
- `extensions/sf-skills-hud/ROADMAP.md` — Phase 2 work

When editing an extension that has one, read it **before** `index.ts`.

### manifest.json is the source of truth

Repo-level source-of-truth order:

1. `extensions/<id>/manifest.json`
2. generated `catalog/index.json` and `catalog/registry.ts`
3. per-extension `README.md`
4. root `README.md` summary

Each extension declares its identity in `manifest.json`:

```json
{
  "id": "sf-ohana-spinner",
  "name": "SF Ohana Spinner",
  "description": "Salesforce-themed rainbow spinner during LLM thinking",
  "category": "ui",
  "defaultEnabled": true
}
```

The catalog generator reads these files and produces:

- `catalog/registry.ts` — TypeScript registry used at runtime
- `catalog/index.json` — Machine-readable index for agents and search
- the bundled-extension table in `README.md`

**Never edit generated files manually.** Run `npm run generate-catalog`.

### Manifest schema

| Field            | Type                               | Required | Description                                                                       |
| ---------------- | ---------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `id`             | string                             | ✅       | Unique slug, must match directory name                                            |
| `name`           | string                             | ✅       | Human-readable display name                                                       |
| `description`    | string                             | ✅       | One-line description                                                              |
| `category`       | `"ui"` \| `"provider"` \| `"core"` | ✅       | Category for grouping                                                             |
| `defaultEnabled` | boolean                            | ✅       | Enabled on first install?                                                         |
| `alwaysActive`   | boolean                            |          | Cannot be disabled                                                                |
| `configurable`   | boolean                            |          | Has a config panel (requires `lib/config-panel.ts` exporting `createConfigPanel`) |
| `commands`       | string[]                           |          | Slash commands shown in the manager detail page                                   |
| `providers`      | string[]                           |          | Providers/auth integrations shown in manager details                              |
| `tools`          | string[]                           |          | Tool names shown in the manager detail page                                       |
| `events`         | string[]                           |          | Pi runtime hooks shown in the manager detail page                                 |

### Enable/disable mechanism

sf-pi uses Pi's native [package filtering](https://github.com/mariozechner/pi-coding-agent/blob/main/docs/packages.md#package-filtering).
When you disable an extension, the manager writes an exclusion pattern to
`settings.json`:

```json
{
  "source": "git:github.com/salesforce/sf-pi",
  "extensions": ["extensions/*/index.ts", "!extensions/sf-ohana-spinner/index.ts"]
}
```

Disabled extensions have zero runtime cost — Pi doesn't load them at all.

### catalog/index.json — machine-readable index

Agents and scripts can read `catalog/index.json` to discover extensions:

```json
[
  {
    "id": "sf-ohana-spinner",
    "name": "SF Ohana Spinner",
    "category": "ui",
    "configurable": false,
    "entry": "extensions/sf-ohana-spinner/index.ts",
    "hasReadme": true,
    "hasTests": true
  }
]
```

This is greppable, parseable, and doesn't require TypeScript.

## How to Add a New Extension

### Quick way (scaffolding)

```bash
npm run scaffold -- --id sf-my-extension --category ui --name "My Extension"
```

This creates the full directory structure with boilerplate and regenerates
the catalog.

After scaffolding, update the new extension's `README.md` and comments so both
agents and humans can follow the behavior without reading every file.

### Manual way

1. Create `extensions/<id>/` with `index.ts` and `manifest.json`
2. Run `npm run generate-catalog` to regenerate the registry
3. Run `npm run check` to verify types
4. Run `npm test` to verify tests

### Checklist for a new extension

- [ ] `manifest.json` has all required fields
- [ ] `manifest.json` `id` matches the directory name
- [ ] `index.ts` exports a default function accepting `ExtensionAPI`
- [ ] `README.md` exists with behavior matrix and file structure
- [ ] `tests/` has at least a smoke test (module export check)
- [ ] `npm run generate-catalog` succeeds
- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] `README.md` generated bundled-extension section still looks correct after `npm run generate-catalog`
- [ ] `AGENTS.md` / `CONTRIBUTING.md` guidance still matches the repo if structure or workflow changed

## Conventions

### Naming

- Extension IDs use kebab-case prefixed with `sf-`: `sf-ohana-spinner`
- The directory name must match the manifest `id`
- The entry point is always `index.ts`

### Behavior contracts

Every `index.ts` starts with a block comment documenting:

- What the extension does
- When it activates / stays silent
- A behavior matrix (event → result table)

### Split by responsibility

When a file starts to grow, split it by concrete responsibilities such as:

- settings I/O
- status formatting
- session scanning
- package/filter parsing
- command routing helpers

Prefer small repo-specific modules over generic utility layers.

### Config panels

If an extension has `"configurable": true` in its manifest, it must export
`createConfigPanel` from `lib/config-panel.ts` matching the `ConfigPanelFactory`
type signature.

### Tool output and display contract

Use the shared display helpers in `lib/common/display/` for new or refactored
agent-facing tools.

- Keep `content` concise and model-relevant. This is what the LLM sees.
- Put renderer/state data in `details`, preferably under a stable extension key
  such as `details.sfPi` or `details.sfPiDiagnostics`.
- Diagnostics appended by file-feedback extensions should use the shared
  `details.sfPiDiagnostics` contract from `lib/common/display/diagnostics.ts`
  while preserving the existing human/model-facing text in `content`.
- Large text outputs must be truncated and, when useful, saved to a temp file
  with the path included in both `content` and `details`.
- `renderCall` should be a one-line summary of intent and key arguments.
- `renderResult` should support compact collapsed output plus richer expanded
  output through Pi's `expanded` option.
- Renderers must be width-safe. Use `visibleWidth`, `truncateToWidth`, or the
  wrappers in `lib/common/display/render.ts` instead of raw string length.
- If a tool can stream partial updates, render `isPartial` as an explicit
  pending/running state instead of falling through to a final-result layout.
- Prefer the shared display profiles (`compact`, `balanced`, `verbose`) when an
  extension needs a default verbosity but still allow tool-specific overrides.

### Testing

- Every extension has at least a smoke test in `tests/`
- Pure helpers should have thorough unit tests
- Event handlers and TUI components are tested via manual QA
- Tests co-locate with their extension (`extensions/<id>/tests/`)
- Run all tests: `npm test`
- Run specific tests: `npx vitest run extensions/sf-ohana-spinner/tests/`

## Development Workflow

```bash
# Install dependencies
npm install

# Install locally for development
pi install .

# Scaffold a new extension
npm run scaffold -- --id sf-my-ext --category ui

# Regenerate catalog after editing manifest.json
npm run generate-catalog

# Format check
npm run format:check

# Type check
npm run check

# Run tests
npm test

# Full validation (generate + format + check + test)
npm run validate
```
