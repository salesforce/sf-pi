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
│   └── workflows/              ← CI, security scanners, release-please, sync, metrics
├── AGENTS.md                   ← Repo rules for agents and contributors
├── ARCHITECTURE.md             ← Repo structure and conventions (this file)
├── CONTRIBUTING.md             ← Human-friendly contributor workflow
├── README.md                   ← User-facing quick start
├── ROADMAP.md                  ← What's next, milestones, non-goals
├── CHANGELOG.md                ← Release history (managed by release-please)
├── extensions/                 ← All extensions live here (self-contained)
│   ├── sf-agentscript/
│   ├── sf-apex/
│   ├── sf-brain/
│   ├── sf-browser/
│   ├── sf-code-analyzer/
│   ├── sf-data-explorer/
│   ├── sf-data360/
│   ├── sf-devbar/
│   ├── sf-docs/
│   ├── sf-feedback/
│   ├── sf-guardrail/
│   ├── sf-herdr/
│   ├── sf-llm-gateway/
│   ├── sf-lsp/
│   ├── sf-lwc/
│   ├── sf-ohana-spinner/
│   ├── sf-pi-manager/
│   ├── sf-skills/
│   ├── sf-slack/
│   ├── sf-soql/
│   ├── sf-tldraw/
│   ├── sf-welcome/
├── lib/
│   └── common/                 ← Shared helpers (see lib/common/README.md)
├── catalog/                    ← Generated registry + hand-written types
│   ├── types.ts                ← Hand-maintained type definitions
│   ├── registry.ts             ← GENERATED from manifest.json files
│   └── index.json              ← GENERATED machine-readable index
├── docs/
│   ├── .vitepress/             ← VitePress config/theme + generated sidebar for GitHub Pages docs
│   ├── extensions.md           ← GENERATED bundled-extension site inventory
│   ├── extensions/              ← GENERATED one page per bundled extension
│   ├── commands.md             ← GENERATED per-extension command reference
│   ├── agent-orientation.md    ← GENERATED agent navigation map
│   ├── contributing.md         ← contributor site entry point
│   └── adr/                    ← ADR records + GENERATED lifecycle index
├── scripts/                    ← catalog/docs/SPDX/validate helpers; see ARCHITECTURE.md
├── themes/                     ← TUI themes (sf-dark.json, …)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

<!-- GENERATED:folder-layout:end -->

## Important scripts

The generated tree above intentionally stays compact. These scripts are the
ones agents and maintainers most often need:

| Script                                    | Purpose                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `scripts/generate-catalog.mjs`            | Regenerates catalog/docs pages, routed indexes, contributor inventories, and declared marker blocks.                 |
| `scripts/check-staged-catalog.mjs`        | Exports the Git index to a temporary root and checks its generated catalog without mutating local state.             |
| `scripts/check-command-contracts.mjs`     | Checks safe slash-command wrapping and reserved command-panel filenames.                                             |
| `scripts/docs-health.mjs`                 | Checks factual doc drift, manual-evidence freshness, and the tracked public-text corpus.                             |
| `scripts/check-external-links.mjs`        | Generates the scheduled report-only external-link artifact; never runs in normal PR validation.                      |
| `scripts/check-architecture.mjs`          | Checks source-size advisories and shared state-store placement separately from docs health.                          |
| `scripts/instruction-surface-report.mjs`  | Writes sanitized SF Pi instruction-size JSON and Markdown through the exact Pi runtime.                              |
| `scripts/e2e/instruction-behavior/run.ts` | Runs the opt-in model routing regression with local reads allowed and every non-local tool blocked before execution. |
| `scripts/add-spdx-headers.mjs`            | Adds or checks SPDX headers for source scripts. Pre-commit auto-adds missing headers; CI uses the check path.        |
| `scripts/check-llm-artifacts.sh`          | CI guard for unresolved conflict markers, prompt-template tokens, and LLM TODO markers.                              |
| `scripts/scaffold.mjs`                    | Creates a new extension folder and refreshes generated catalog/docs.                                                 |
| `scripts/validate.sh`                     | Local validation across generated drift, docs health/build, formatting/types, structural checks, and tests.          |
| `scripts/preview-pi-salesforce.mjs`       | Local visual preview for the animated `sf-welcome` Pi + SALESFORCE header.                                           |
| `scripts/preview-sf-logo.mjs`             | Local visual preview for the compact Salesforce wordmark.                                                            |
| `scripts/render-splash-header.mjs`        | Renders splash-header frames for review / screenshots.                                                               |

`npm run lint` covers formatting, generated-data/catalog drift, docs, source-architecture, SPDX, and shared-policy checks, plus ESLint. `npm run validate` covers generated checks, docs and source-architecture health, the VitePress build, formatting/types, structural checks, and tests without rewriting generated artifacts. `npm run validate:ci` adds the remaining CI-facing lint/artifact guard and reasserts docs health.

## Where does X live? (agent quick-reference)

When an agent (or human) needs to change something, start here:

| I want to change...                             | Look in                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Extension metadata (name/category/commands)     | `extensions/<id>/manifest.json` — then `npm run generate-catalog`               |
| Extension entry point / lifecycle hooks         | `extensions/<id>/index.ts`                                                      |
| Extension implementation modules                | `extensions/<id>/lib/*.ts`                                                      |
| Extension config panel (when `configurable`)    | `extensions/<id>/lib/config-panel.ts` — must export `createConfigPanel`         |
| Extension tests                                 | `extensions/<id>/tests/*.test.ts` (vitest)                                      |
| Manifest/runtime registration attestation       | `scripts/runtime-surface/`, `scripts/tests/runtime-surface-attestation.test.ts` |
| Extension human-facing docs                     | `extensions/<id>/README.md`                                                     |
| Extension-specific agent rules                  | Manifest `docs.editingRules` → `extensions/<id>/AGENTS.md`                      |
| Extension agent operating guide                 | Manifest `docs.agentGuide` → `extensions/<id>/AGENT_GUIDE.md`                   |
| Extension domain glossary                       | Manifest `docs.contextGlossary` → `extensions/<id>/CONTEXT.md`                  |
| Extension reference index                       | Manifest `docs.referenceRoots[].index` for `docs/` or `references/`             |
| Extension-specific roadmap                      | `extensions/<id>/ROADMAP.md` (optional, see below)                              |
| Slash command handlers                          | `extensions/<id>/index.ts` — most handle their own commands                     |
| Shared Pi-runtime shims                         | `lib/common/pi-compat.ts`, `lib/common/pi-paths.ts`                             |
| Shared SF environment detection                 | `lib/common/sf-environment/`                                                    |
| Shared glyph/ASCII policy                       | `lib/common/glyph-policy.ts`                                                    |
| Shared display profile + diagnostics contract   | `lib/common/display/`                                                           |
| Generated registry (for runtime extension load) | `catalog/registry.ts` — **generated, do not edit**                              |
| Generated machine-readable index                | `catalog/index.json` — **generated, do not edit**                               |
| Generated docs-site extension inventory         | `docs/extensions.md` — **generated, do not edit**                               |
| Generated per-extension docs-site pages         | `docs/extensions/*.md` — **generated, do not edit**                             |
| Generated docs-site extension sidebar           | `docs/.vitepress/generated-extension-sidebar.ts` — **generated, do not edit**   |
| Generated command reference                     | `docs/commands.md` — **generated, do not edit**                                 |
| Generated agent orientation                     | `docs/agent-orientation.md` — **generated, do not edit**                        |
| Generated ADR lifecycle index                   | `docs/adr/README.md` — **generated, do not edit**                               |
| VitePress documentation site                    | `docs/.vitepress/`, `docs/index.md`, and curated docs pages                     |
| Contributor site entry point                    | `docs/contributing.md`                                                          |
| Generated folder layout                         | Inside `ARCHITECTURE.md` between `GENERATED:folder-layout` markers              |
| Generated contributor script inventory          | Inside `CONTRIBUTING.md` from `package.json`                                    |
| Generated shared-module inventory               | Inside `lib/common/README.md` from `lib/common/`                                |
| Generated E2E harness inventory                 | Inside `scripts/e2e/README.md` from package scripts and its harness manifest    |
| Generated troubleshooting index                 | Inside `docs/troubleshooting.md` generated marker block                         |
| Generated extension file maps                   | Inside `extensions/*/README.md` between `GENERATED:file-structure` markers      |
| Hand-maintained registry types                  | `catalog/types.ts`                                                              |
| Recommended external extensions (curated list)  | `catalog/recommendations.json` — hand-maintained, validated by generator        |
| Recommended-extension runtime code              | `extensions/sf-pi-manager/lib/recommendations*.ts`                              |
| Recommended-extension user state                | `<globalAgentDir>/state/sf-pi/recommendations.json` — machine-written           |
| CI / release automation                         | `.github/workflows/`                                                            |
| Repo rules for contributors / agents            | `AGENTS.md`, `CONTRIBUTING.md`                                                  |
| Repo conventions and structure                  | this file                                                                       |

`catalog/index.json` also carries a `srcLoc` field per extension — use it
to gauge the size of an extension before diving in.

## Key Concepts

### Extensions are self-contained folders

Each extension lives in `extensions/<id>/` with everything co-located:

- `index.ts` — Pi entry point (exports `default function(pi: ExtensionAPI)`)
- `manifest.json` — Metadata that drives the catalog generator
- `README.md` — current human behavior and usage documentation
- `lib/` — Implementation modules (imported by index.ts)
- `tests/` — Co-located tests (vitest)

This means you can `ls extensions/<id>/` and see everything related to that
extension without navigating multiple top-level directories.

### Per-extension `AGENTS.md` and `ROADMAP.md`

Extension `AGENTS.md` files contain non-obvious editing invariants. An extension
`ROADMAP.md` is rarer: it exists only while concrete unresolved outcomes have a
current owner and observable completion condition. It contains no shipped
ledger or speculative feature inventory and is deleted when its active backlog
is empty.

Read `AGENTS.md` before editing its extension. Read a roadmap only when the task
concerns one of its active outcomes.

### Behavior and manifest authority

Runtime code and Behavior Proofs define implemented behavior. The extension
manifest declares the attested public routing and documentation contract;
generated catalogs project that contract. The extension README owns human
behavior and usage guidance.

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
- `catalog/index.json` — machine-readable index for agents and search
- generated extension browse/detail pages, command and agent-orientation pages,
  sidebars, routed indexes, and contributor-facing structural inventories

**Never edit generated files manually.** Run `npm run generate-catalog`.

### Manifest contract

The hand-maintained `ExtensionManifest` type in [`catalog/types.ts`](./catalog/types.ts)
defines the complete schema. The catalog generator validates every discovered
manifest before writing output, including:

- identity, display name, description, category, maturity, and default state;
- declared commands, providers, tools, events, and configurability;
- required `docs.intentGroup`, `docs.summary`, and a maximum of eight
  `docs.primaryFiles` read-first entrypoints;
- explicit editing-rules, operating-guide, and context-glossary roles when the
  corresponding files exist;
- routed `docs.referenceRoots` coverage for Markdown under extension `docs/` or
  `references/`, including generator provenance for generated-current roots;
- an operating guide for every tool-owning extension.

Do not maintain a second field-by-field schema table in prose. Update the type,
generator validation, fixtures, and affected manifests together.

### Enable/disable mechanism

sf-pi uses Pi's native [package filtering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md#package-filtering).
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
npm run scaffold -- --id sf-my-extension --category ui --intent "Personalize pi" --name "My Extension"
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
- [ ] `README.md` explains current human behavior and contains the generated file structure
- [ ] `tests/` has at least a smoke test (module export check)
- [ ] `npm run generate-catalog` succeeds
- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] generated extension detail page looks correct after `npm run generate-catalog`
- [ ] `AGENTS.md` / `CONTRIBUTING.md` guidance still matches the repo if structure or workflow changed

## Conventions

### Naming

- Extension IDs use kebab-case prefixed with `sf-`: `sf-ohana-spinner`
- The directory name must match the manifest `id`
- The entry point is always `index.ts`

### Behavior contracts

Keep public registration and lifecycle behavior easy to locate from `index.ts`.
Document non-obvious activation, silence, ordering, and recovery contracts in
focused comments, role-specific docs, and Behavior Proofs. Do not require a
repeated event-by-event matrix when the public seam and tests already make the
behavior clear.

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

### Slash-command navigation and discoverability

ADR 0051 supersedes ADR 0005's original no-args navigation rule. Every bundled
extension's primary interactive no-args command opens that extension's detail
page in the SF Pi Manager.

- The Manager-first Behavior Proof invokes every command-bearing extension's
  real factory and primary command handler and verifies the matching detail
  route.
- Explicit subcommands remain direct and scriptable. Full-screen workflows use
  an explicit subcommand or Manager action rather than replacing no-args
  navigation.
- Headless/print/RPC no-args behavior returns concise text status/help.
- Every selectable action and subcommand completion has a short description.
  Reuse one action catalog for parsing, completion, help, Manager actions, and
  README command tables where the grammar is simple.
- Use Pi-native `SelectList`, `SettingsList`, `DynamicBorder`, and related TUI
  primitives for explicit interactive actions. Avoid new bespoke overlay
  routers unless the workflow genuinely requires custom rendering.
- Keep package-level enable/disable centralized in `sf-pi-manager`.

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
- Event handlers and TUI paths use public-seam Behavior Proofs where feasible; manual visual QA is final evidence only for visible behavior
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
npm run scaffold -- --id sf-my-ext --category ui --intent "Personalize pi"

# Regenerate catalog after editing manifest.json
npm run generate-catalog

# Format check
npm run format:check

# Type check
npm run check

# Run tests
npm test

# Full validation (generated checks + docs/build + formatting/types + structural checks + tests)
npm run validate
```
