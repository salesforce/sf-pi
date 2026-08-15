<!-- SPDX-License-Identifier: Apache-2.0 -->

# E2E and live-proof harnesses

These opt-in harnesses exercise public extension seams outside the normal Pi
host. They are not part of default CI. Every live target must be explicit, and
all Salesforce mutations belong only in isolated non-production fixtures.

## Harness inventory

<!-- GENERATED:e2e-harnesses:start -->

This inventory is generated from `scripts/e2e/harnesses.json` and checked against `package.json` plus the runnable harness files.

| Harness                                                                                                                                                                             | Run                                                                                                                                | Target                                                    | Posture            | Artifacts                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| [Data 360 v2 action sweep](./data360-v2-action-sweep.ts)<br>Exercises every current data360_* family and the sweep-owned DLO lifecycle through the real v2 registry and dispatcher. | `npm run e2e:data360-v2 -- --target-org <alias> [--live-read --max-live-read 5] [--mutation-lifecycle dlo --mutate --run-id <id>]` | Explicit non-production org                               | `bounded-mutation` | JSON and Markdown reports in a temporary or caller-selected directory    |
| [Data 360 STDM compatibility smoke](./d360-stdm-e2e.ts)<br>Exercises retained low-level metadata, readiness, safety, and bounded SQL modules.                                       | `npm run e2e:d360-stdm -- <alias>`                                                                                                 | Explicit non-production org                               | `read-only`        | Console proof only                                                       |
| [Agent Platform tracing smoke](./d360-agent-platform-tracing-e2e.ts)<br>Reads tracing metadata and bounded spans, then reconstructs a trace tree locally.                           | `npm run e2e:d360-tracing -- <alias> [--require-data]`                                                                             | Explicit non-production org                               | `read-only`        | Console proof only                                                       |
| [SF Apex lifecycle harness](./sf-apex-harness-e2e.ts)<br>Exercises native discovery, traces, logs, Anonymous Apex, tests, and coverage against a deployed fixture.                  | `npm run e2e:sf-apex-harness -- --org <alias> --harness-cwd <project> [--flow <FlowApiName>]`                                      | Explicit dedicated non-production org and harness project | `bounded-mutation` | Session-scoped Apex source, log, test, and coverage artifacts            |
| [SF Browser navigation hardening](./sf-browser-pack-harden.ts)<br>Verifies curated destinations and structured routes through a live headless browser.                              | `npm run e2e:sf-browser-harden -- --org <alias> [--surface all] [--mutate]`                                                        | Explicit non-production org                               | `bounded-mutation` | Browser Evidence screenshots plus Markdown and HTML reports              |
| [SF Herdr disposable-pane smoke](./sf-herdr-live-smoke.ts)<br>Splits a fresh pane, runs a harmless marker, verifies output, and closes only after success.                          | `npm run e2e:sf-herdr`                                                                                                             | Disposable Herdr session with SF_HERDR_LIVE_SMOKE=1       | `bounded-mutation` | Console proof; failed panes remain open for inspection                   |
| [SF LWC local lifecycle harness](./sf-lwc-e2e.ts)<br>Builds a temporary SFDX fixture and exercises scan, inspect, diagnostics, planning, and Jest execution.                        | `npm run e2e:sf-lwc`                                                                                                               | Generated local workspace; no org                         | `read-only`        | Temporary project plus LWC diagnostic and Jest artifacts                 |
| [SF SOQL lifecycle harness](./sf-soql-e2e.ts)<br>Exercises schema, validation, bounded query, SOSL, file, history, and export behavior.                                             | `npm run e2e:sf-soql -- --org <alias> [--harness-data]`                                                                            | Explicit non-production org                               | `bounded-mutation` | Temporary query files plus session-scoped query and export artifacts     |
| [Instruction behavior regression](./instruction-behavior/run.ts)<br>Runs opt-in model-routing scenarios while blocking every non-local tool before execution.                       | `npm run e2e:instruction-behavior -- --model <model> [--scenario <id> --limit 1]`                                                  | Explicit model or configured default                      | `model-only`       | JSON and Markdown reports under .pi/state/sf-brain/instruction-behavior/ |

<!-- GENERATED:e2e-harnesses:end -->

## Safety classifications

- **`read-only`** — reads an org or generated local fixture without intentionally
  creating durable target-system state.
- **`plan-only`** — resolves or validates intended operations without executing
  them.
- **`bounded-mutation`** — can create temporary records, flags, panes, browser
  drafts, or other explicitly owned state and documents its cleanup behavior.
- **`model-only`** — calls a selected model while the probe blocks every
  non-local tool before execution.

A harness with optional mutation is classified by its most permissive path, not
its default invocation. Review the source header and `--help`/usage output before
running it. Keep generated reports, screenshots, org identifiers, and local
paths out of public commits.

The Data 360 v2 DLO lifecycle additionally requires both
`SF_PI_D360_V2_SWEEP_MUTATION_TARGET_ORG=<alias>` and
`D360_V2_SWEEP_ALLOW_DESTRUCTIVE=<alias>` to exactly match `--target-org`.

## Adding or changing a harness

1. Add one `e2e:*` script in `package.json` for the runnable entrypoint.
2. Add the matching target, posture, arguments, and artifact record to
   `scripts/e2e/harnesses.json`.
3. Run `npm run generate-catalog` and review this generated inventory.
4. Add a focused Behavior Proof when argument parsing, planning, or cleanup
   behavior changes.

Catalog generation fails when a runnable top-level harness, nested `run.ts`, or
`e2e:*` package script is missing from the manifest.
