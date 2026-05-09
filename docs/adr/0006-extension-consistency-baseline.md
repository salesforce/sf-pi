# ADR 0006: Extension Consistency Baseline

## Status

Accepted

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

| Filename                   | Purpose                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `lib/command-panel.ts`     | The no-args slash-command status & actions panel built on `lib/common/command-panel.ts`.                            |
| `lib/config-panel.ts`      | The `ConfigPanelFactory` invoked by sf-pi-manager when `manifest.configurable === true`. Required for that surface. |
| `lib/preferences-panel.ts` | A separate mutable user-preferences UI when distinct from `config-panel.ts` (e.g. opened by `/sf-<id> settings`).   |

The deprecated names `lib/panel.ts` and `lib/settings-panel.ts` are rejected
by `npm run check:panels`. Most extensions never need a separate file at all
— inline the panel inside `index.ts` until it grows past ~50 lines.

### 4. Manifest `docs.summary` + `docs.primaryFiles` are required

The `docs` block on the manifest already flowed into
[`docs/agent-orientation.md`](../agent-orientation.md), but only two
extensions populated it — agents landing in the other 11 were stuck with the
one-line `description`. The catalog generator (`scripts/generate-catalog.mjs`)
now refuses to run if a manifest omits a non-empty `docs.summary` and a
non-empty `docs.primaryFiles`.

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
| `provider`   | `sf-llm-gateway-internal`                                      |
| `agent-tool` | `sf-data360`, `sf-slack`                                       |
| `safety`     | `sf-guardrail`                                                 |
| `assistive`  | `sf-brain`, `sf-lsp`, `sf-agentscript-assist`, `sf-feedback`   |
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

Extensions that contribute LLM tools follow this layout:

1. One file per tool, named `lib/<tool-name>-tool.ts`.
2. The file exports a `register<PascalCase>Tool(pi)` function.
3. The file declares `export const <NAME>_TOOL_NAME = "<tool>";` so panels
   and config UIs reference the name without a magic string.

The `npm run docs:health:check` lint now verifies that every entry in
`manifest.tools` resolves to a `pi.registerTool(...)` call **and** an exact
string-literal match somewhere in the extension. Catches manifest typos and
tools registered with the wrong name.

### 9. Updated scaffold

`scripts/scaffold.mjs` reflects every rule above:

- imports `extension-toggle` from `lib/common/`
- accepts the six new categories (rejects the old three)
- writes `manifest.maturity: "experimental"` and `docs.{summary,primaryFiles}` so the generator accepts the new extension on first run
- drops a sample `lib/example-tool.ts` for `agent-tool` extensions
- prints next-step instructions that match the new conventions

## Consequences

- Three lints now block drift: `check-panel-consistency.mjs` (filenames +
  panel imports), `generate-catalog.mjs` (categories, maturity, docs block),
  and `docs-health.mjs` (tool-registration shape).
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
[`lib/common/README.md`](../../lib/common/README.md). The lint in
`docs-health.mjs` refuses any `state-store.ts` outside `lib/common/`
that does not delegate to the shared helper.

Migrations included:

- `extensions/sf-welcome/lib/state-store.ts` (delegates to the helper;
  legacy file path preserved via `pathOverride`)
- `lib/common/catalog-state/announcements-state.ts`
- `lib/common/catalog-state/recommendations-state.ts`

Not migrated (intentional):

- `extensions/sf-llm-gateway-internal/lib/config.ts` saved-config writer
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

- `sf-llm-gateway-internal` — reuses the existing
  `fetchGatewayDoctorReport` (URL signature, `/v1/models`, `/health/readiness`).
- `sf-agentscript-assist` — reuses `probeDoctor` (vendored SDK + dialect probe).
- `sf-lsp` — reuses `doctorLsp` per language (Apex/LWC/Agent Script).
- `sf-data360` — small org-connectivity check + a single `/ssot/data-spaces`
  probe (full `d360_probe` stays available to the agent for deep diagnostics).
- `sf-slack` — token presence + identity + scope readiness from cached state.
- `sf-guardrail` — config source + active feature tiers + headless-allow
  env state.

Each extension's standalone `/sf-X doctor` command keeps working
unchanged — the adapter file (`lib/extension-doctor.ts` or
`lib/doctor.ts > runExtensionDoctor`) is a parallel entry point only.

## Out of scope (Wave 3 in the original plan)

These remain explicitly deferred:

- Splitting the two large extensions (`sf-slack`, `sf-llm-gateway-internal`)
  by file size.
- Adopting `lib/common/display/` for every LLM tool result.
