---
id: "0006"
status: accepted
date: 2026-05-09
---

# ADR 0006: Extension Consistency Baseline

## Context

Thirteen bundled extensions had each grown their own conventions for filenames,
shared helper locations, manifest metadata, taxonomy, and command-surface
construction. The drift was small per file but added up — agents and humans
arriving at any given extension had to spend cycles relearning which
convention applied. The patterns this ADR pins were already endorsed in pieces
across [`AGENTS.md`](../../AGENTS.md), [`lib/common/README.md`](../../lib/common/README.md),
and [ADR 0005](./0005-standard-command-panels.md), but adoption was uneven.

This ADR records the baseline so new and migrating extensions land against a
single set of rules and the lints below keep them from drifting again.

## Decisions

### 1. Shared "manager surface" lives in `lib/common`

`extension-toggle.ts`, `sf-pi-package-state.ts`, and `sf-pi-settings.ts` now
live in `lib/common/`. They were previously inside `extensions/sf-pi-manager/lib/`
even though 11 of 13 bundled extensions imported `extension-toggle`. By the
"two consumers ⇒ promote" rule in [`lib/common/README.md`](../../lib/common/README.md)
they belonged in the shared module. The move also restores the dependency
direction: nothing in `lib/common` reaches into an extension folder.

### 2. Single shared `buildExecFn`

`lib/common/exec-adapter.ts` now accepts an optional `defaultCwd` so any
extension that needs to anchor `pi.exec()` calls at `ctx.cwd` can do so
without re-implementing the adapter. The shared `ExecFn` type
(`lib/common/sf-environment/detect.ts`) gained an optional `cwd` option to
match. `sf-feedback`'s local copy was deleted.

### 3. Canonical panel filenames

ADR 0005 didn't pin filenames; three names emerged. We now reserve:

| Filename                   | Purpose                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `lib/command-panel.ts`     | An explicit grouped status/action panel built on `lib/common/command-panel.ts`; no-args navigation follows ADR 0051. |
| `lib/config-panel.ts`      | The `ConfigPanelFactory` invoked by sf-pi-manager when `manifest.configurable === true`. Required for that surface.  |
| `lib/preferences-panel.ts` | A separate mutable user-preferences UI when distinct from `config-panel.ts` (e.g. opened by `/sf-<id> settings`).    |

The deprecated names `lib/panel.ts` and `lib/settings-panel.ts` are rejected by
`npm run check:commands`. Most extensions never need an explicit panel; keep one
local only for a specialized workflow that the Manager detail route cannot
express cleanly.

### 4. Manifest documentation routing is required

The catalog generator requires `docs.intentGroup`, a factual `docs.summary`,
and non-empty `docs.primaryFiles`. The intent group drives generated user
discovery, the summary supplies longer generated context, and primary files
route agents without duplicating a recursive inventory.

### 5. Manifest `maturity` field

`manifest.maturity` is a new optional field with allowed values
`"stable" | "beta" | "experimental"`. It defaults to `"stable"` when omitted
and surfaces in `catalog/index.json` and the agent-orientation table so
agents and users can prefer stable extensions and spot in-flight work.

### 6. Six categories, each carrying real signal

The previous taxonomy (`ui` / `provider` / `core`) put 9 of 13 extensions in
the `core` bucket. We split it into six:

| Category     | Members                                                        |
| ------------ | -------------------------------------------------------------- |
| `manager`    | `sf-pi-manager`                                                |
| `provider`   | `sf-llm-gateway`                                               |
| `agent-tool` | `sf-data360`, `sf-slack`                                       |
| `safety`     | `sf-guardrail`                                                 |
| `assistive`  | `sf-brain`, `sf-lsp`, `sf-agentscript`, `sf-feedback`          |
| `ui`         | `sf-welcome`, `sf-devbar`, `sf-skills-hud`, `sf-ohana-spinner` |

`catalog/types.ts > ExtensionCategory` is the source of truth. The catalog
generator and the scaffold both validate against it.

### 7. Command-action catalog helper

`lib/common/command-actions.ts` defines `SfPiCommandAction` (a structural
superset of `CommandPanelAction`) plus four helpers — `getCompletionsFromActions`,
`resolveAction`, `formatHelpFromActions`, and `formatReadmeTableFromActions`.
Together they let an extension declare its action metadata once and reuse it
for the panel, `getArgumentCompletions()`, `/help`, and the README.

Adoption is **incremental**. Existing extensions are not migrated as part of
this ADR. New extensions and the next two extensions touched should adopt
the shared catalog so we accumulate real callers before deciding whether to
backfill the rest.

### 8. Tool registration convention

Prefer one registration file per independently defined tool. Family registries
may keep tools together when they share one schema and dispatcher. Registration
helpers export stable tool-name constants when other modules need those names.

`npm run test:runtime-surface` executes real extension factories in controlled
scenarios and compares commands, providers, tools, and events with manifests in
both directions. Conditional tool availability requires extension-local
positive and negative scenarios rather than source-string matching.

### 9. Scaffold contract

`scripts/scaffold.mjs` must reflect every rule above. The executable-standards
program closes the current template drift with this contract:

- require an explicit id, category, and user intent group
- generate a Manager-first slash command wrapped by the shared safe command
  handler
- accept the six current categories and eight browse-page intent groups
- write `manifest.maturity: "experimental"` plus
  `docs.{intentGroup,summary,primaryFiles}`
- generate an agent-tool starter file with the canonical exported tool-name
  constant and registration function
- generate a lean human README and a smoke-test starting point
- print next-step instructions that match the generated conventions

## Consequences

- `check-command-contracts.mjs` protects safe command wrapping and reserved
  filenames; the Manager-first Behavior Proof invokes real primary command
  handlers; catalog generation validates manifest documentation routing; and
  runtime-surface attestation protects registration parity.
- `lib/common/extension-toggle.ts` and friends are stable and explicitly
  documented in [`lib/common/README.md`](../../lib/common/README.md).
- The agent-orientation table now has a `Maturity` column and richer
  per-extension summaries pulled from each manifest's `docs.summary`.
- Adoption of `lib/common/command-actions.ts` is opt-in. We re-evaluate
  backfill in a follow-up ADR after two more extensions have used it in
  anger.

## Follow-ups landed after the original ADR

### State-persistence decision tree (was Wave 2 #10)

`lib/common/state-store.ts` is the shared helper for the Q4 case in the
decision tree (per-user persisted JSON state). It provides atomic writes
(tmp file + rename), schema versioning with an optional `migrate` hook,
tolerant reads with safe defaults, and an optional `mode` for files that
hold tokens. Documented in [`AGENTS.md`](../../AGENTS.md) and
[`lib/common/README.md`](../../lib/common/README.md). The architecture check
refuses any `state-store.ts` outside `lib/common/` that does not delegate to the
shared helper.

Migrations included:

- `extensions/sf-welcome/lib/state-store.ts` (delegates to the helper;
  legacy file path preserved via `pathOverride`)
- `lib/common/catalog-state/announcements-state.ts`
- `lib/common/catalog-state/recommendations-state.ts`

Not migrated (intentional):

- `extensions/sf-llm-gateway/lib/config.ts` saved-config writer
  has bespoke `chmod 0o600`, project-or-global path discovery, and
  per-field validation. The migration risk outweighs the atomic-write
  win until the file needs other surgery.

### `/sf-pi doctor` aggregation

`lib/common/doctor/registry.ts` defines a small registry that lets every
extension contribute an `ExtensionDoctorReport`. `/sf-pi doctor` runs the
built-in runtime diagnostics (pi/node/skills/packages) and then aggregates
every registered provider with a 5-second timeout each. Slow or failed
providers are flagged inline as `timeout` / `error` instead of blocking
the rest of the report.

Providers registered:

- `sf-llm-gateway` — reuses the existing
  `fetchGatewayDoctorReport` (URL signature, `/v1/models`, `/health/readiness`).
- `sf-agentscript` — reuses `probeDoctor` (official SDK package + dialect probe).
- `sf-lsp` — reuses `doctorLsp` per language (Apex/LWC/Agent Script).
- `sf-data360` — small org-connectivity check + a single `/ssot/data-spaces`
  probe (full `d360_probe` stays available to the agent for deep diagnostics).
- `sf-slack` — token presence + identity + scope readiness from cached state.
- `sf-guardrail` — config source + active feature tiers + headless-allow
  env state.

Each extension's standalone `/sf-X doctor` command keeps working
unchanged — the adapter file (`lib/extension-doctor.ts` or
`lib/doctor.ts > runExtensionDoctor`) is a parallel entry point only.

## Closing follow-ups

### Cross-extension imports eliminated

The last remaining cross-extension import (sf-pi-manager pulling
`buildAnnouncementsSync` from sf-welcome) was closed by moving the
announcements pipeline to `lib/common/catalog-state/`:

- `extensions/sf-welcome/lib/announcements.ts` →
  `lib/common/catalog-state/announcements-orchestrator.ts`
- `extensions/sf-welcome/lib/announcements-{filter,update,remote}.ts` →
  `lib/common/catalog-state/announcements-{filter,update,remote}.ts`
- `extensions/sf-welcome/lib/whats-new.ts` →
  `lib/common/catalog-state/whats-new.ts` (refactored to take
  `lastSeenPiVersion` as an explicit parameter so it no longer reaches
  into sf-welcome's state-store)

`grep -rn "from \"\.\./sf-" extensions/ --include="*.ts"` now returns no
production matches.

### `lib/common/command-actions.ts` adopted

The shared action-catalog helper is now used by `sf-data360` and
`sf-feedback`. Both pull `getCompletionsFromActions`, `resolveAction`,
and `formatHelpFromActions` from `lib/common`, so a single
`SF_*_ACTIONS` array drives the panel rows, the slash-command
completions, and the auto-generated `/help` text. Future extensions can
adopt the same shape; existing extensions migrate when they're next
touched for a real change.

### File-size growth advisory lint

`scripts/check-architecture.mjs` emits informational warnings for extension
`.ts` files at or above 800 LOC and stronger warnings at or above 1500 LOC. The
lint never fails CI; it makes growth visible during review without turning a
line threshold into an automatic refactor requirement.

## Wave 3 follow-ups landed

### sf-llm-gateway transport layout

The gateway provider keeps only provider-neutral protocol adapters under
`lib/transport-internal/` for Chat Completions, Responses, and Messages.
Authenticated model discovery and neutral metadata parsing live under
`models-internal/`, while Pi owns credential persistence, model caching,
refresh coordination, retry policy, and thinking selection.

Deployment-routing policy and model-specific payload behavior were removed by
ADR 0100. The extension README is the source of truth for the current file map.

### sf-slack send-tool split

`send-tool.ts` (985 → 592 LOC) extracts the recipient-routing surface
to `send-tool-recipient.ts` (403 LOC) — `routeRecipient`,
DM-fallback search, candidate scoring, and the resolution failure
formatters. The substring-based safety-invariants test reads both
files concatenated so existing assertions still cover the whole
slack_send surface.

`api.ts` (805) and `types.ts` (826) stay where they are. Both are
barely over the 800 advisory threshold and splitting them forces
updates across every consumer for low payoff. The advisory lint
surfaces them for organic touch.

### `lib/common/display/` adoption

All three Data 360 tools and the slack `slack_time_range` tool now
emit `details.sfPi` matching `SfPiToolResultEnvelope` from
`lib/common/display/types.ts`:

- `sf-data360/lib/truncation.ts` exports a new `buildD360Envelope`
  helper. `api-tool.ts`, `metadata-tool.ts`, and `probe-tool.ts` use
  it on every success and main error path.
- `sf-slack/lib/time-range-tool.ts` builds the envelope inline
  (it never truncates, so the existing `buildSlackTextResult` does
  not apply).

Every other slack tool was already wrapped through
`buildSlackTextResult` in `extensions/sf-slack/lib/truncation.ts`,
so the envelope is now consistent across all 12 LLM tools shipped
by sf-pi.

## Status

ADR 0006 is complete. Source-size findings remain advisory and surface through
the architecture check when files are next touched.
