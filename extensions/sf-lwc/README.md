# SF LWC — Code Walkthrough

## What It Does

SF LWC is a lean, local-native **LWC Lifecycle Extension** for pi. It helps the
agent move through the Lightning Web Component loop:

```text
scan → inspect → diagnose → local test → artifact → iterate
```

It deliberately does **not** become a UI builder, frontend app generator,
deployment tool, org source synchronization surface, or wrapper around
Salesforce CLI commands. Source edits remain normal Pi `read`, `write`, and
`edit` operations. Broader static/security scans remain with `sf-code-analyzer`,
Apex/server verification remains with `sf-apex`, schema validation remains with
`sf-soql`, and advisory on-write diagnostics remain with `sf-lsp`.

Full scans, component inspections, diagnostics, and Jest output are persisted as
**LWC Artifacts** under the global agent directory. Tool output stays compact for
the LLM and renders as human-friendly **LWC Result Cards** in the TUI.

## Runtime Flow

```text
Extension loads
  ├─ register /sf-lwc command
  └─ session_start
       └─ register sf_lwc tool

sf_lwc action
  ├─ resolves the SFDX project from cwd/workspace
  ├─ scans only packageDirectories from sfdx-project.json
  ├─ runs focused local compiler/template diagnostics or bounded local Jest
  ├─ writes full evidence as LWC Artifacts
  └─ returns compact LWC Run Digest + human LWC Result Card
```

## Key Architecture Decisions

- **Local-native hot path** — V1 works against the checked-out SFDX project. It
  does not call Salesforce CLI or org APIs.
- **Public LWC compiler adapter** — V1 uses current public `@lwc/*` compiler
  packages behind SF Pi diagnostics helpers. The public LWC language-server
  package remains the conceptual reference used by `sf-lsp`, but is not a direct
  `sf-lwc` runtime dependency until its transitive dependency tree is release-clean.
- **One family tool** — `sf_lwc` uses dotted actions to keep prompt footprint low.
- **SFDX package-directory boundary** — scans are limited to package directories
  registered by `sfdx-project.json`; non-SFDX and workspace-wide scans are not
  supported in V1.
- **Bounded local tests** — `test.run` may execute `node_modules/.bin/lwc-jest`
  directly with bounded args/timeouts. It never installs dependencies, starts
  watch mode, updates snapshots by default, or runs arbitrary package scripts as
  the primary path.
- **Diagnostics coexistence** — `sf-lsp` keeps advisory on-write LWC diagnostics;
  `sf_lwc file.diagnose` provides explicit lifecycle diagnostics and artifacts.
- **Artifact-first evidence** — raw Jest JSON, stdout/stderr, diagnostics JSON,
  scans, inspections, and summaries are persisted; LLM output stays compact.
- **LWC Local Rail** — cards show the local project/file/compiler/runner context
  used for the action rather than hiding the execution path.
- **Skill-aware, tool-first guidance** — authoring and test actions recommend
  `generating-lwc-components`; style/SLDS signals additionally recommend
  `uplifting-components-to-slds2`. These are guidance hints only: `sf_lwc`
  remains the lifecycle evidence authority, Code Analyzer owns explicit SLDS
  scans today, and a future `sf-slds2` extension can own SLDS2 uplift workflows.

## Behavior Matrix

| Event/Trigger              | Condition                     | Result                                                                  |
| -------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| extension load             | always                        | Register `/sf-lwc` command.                                             |
| session_start              | extension enabled             | Register `sf_lwc` tool.                                                 |
| `/sf-lwc`                  | interactive                   | Open status/actions panel.                                              |
| `/sf-lwc status`           | any mode                      | Print concise extension status.                                         |
| `sf_lwc status`            | explicit tool call            | Report SFDX/LWC Jest/compiler readiness.                                |
| `sf_lwc project.scan`      | SFDX project                  | Inventory LWC bundles in registered package directories.                |
| `sf_lwc component.list`    | SFDX project                  | List matching local LWC bundles.                                        |
| `sf_lwc component.inspect` | component provided            | Summarize bundle shape, imports, diagnostics, style signals, and tests. |
| `sf_lwc file.diagnose`     | local LWC file(s)             | Run focused HTML/JS/TS/meta diagnostics.                                |
| `sf_lwc test.discover`     | SFDX project                  | Find local LWC Jest files and runner readiness.                         |
| `sf_lwc test.plan`         | component/file/test scope     | Recommend the smallest useful local Jest scope.                         |
| `sf_lwc test.run`          | local runner + test scope     | Run bounded local LWC Jest and write artifacts.                         |
| `sf_lwc history.rerun`     | previous runnable test exists | Rerun the previous local LWC Jest action.                               |

## Commands

```text
/sf-lwc          Open SF LWC panel
/sf-lwc status   Print extension status
/sf-lwc help     Print command and tool usage
```

## LLM Tool

`sf_lwc` actions:

| Action              | Description                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `status`            | Report local SFDX/LWC Jest/compiler readiness.                                                    |
| `project.scan`      | Scan registered SFDX package directories for LWC bundles and test signals.                        |
| `component.list`    | List local LWC bundles with exposure/test/file signals.                                           |
| `component.inspect` | Inspect one bundle's metadata, public API, imports, child tags, style signals, tests, and issues. |
| `file.diagnose`     | Diagnose `.html`, `.js`, `.ts`, and `.js-meta.xml` LWC files.                                     |
| `test.discover`     | Discover local LWC Jest test files and runner availability.                                       |
| `test.plan`         | Recommend the smallest useful local LWC Jest run for a component or file.                         |
| `test.run`          | Run a bounded local LWC Jest test and persist JSON/stdout/stderr/summary.                         |
| `history.last`      | Return the previous LWC Run Digest in this session.                                               |
| `history.rerun`     | Rerun the previous local LWC Jest action.                                                         |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-lwc/
  lib/
    artifacts.ts            ← implementation module
    component.ts            ← implementation module
    diagnostics.ts          ← implementation module
    digest.ts               ← implementation module
    errors.ts               ← implementation module
    operations.ts           ← implementation module
    project.ts              ← implementation module
    render.ts               ← implementation module
    result.ts               ← implementation module
    sf-lwc-tool.ts          ← implementation module
    tests.ts                ← implementation module
    types.ts                ← implementation module
  tests/
    diagnostics.test.ts     ← unit / smoke test
    operations.test.ts      ← unit / smoke test
    project.test.ts         ← unit / smoke test
    render.test.ts          ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    tests.test.ts           ← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run targeted tests while developing:

```bash
npm test -- extensions/sf-lwc/tests
```

Before finishing broader changes:

```bash
npm run generate-catalog
npm run format:check
npm run check -- --pretty false
npm test -- extensions/sf-lwc/tests extensions/sf-brain/tests/extension-context.test.ts
```

V1 is local-only, so release validation does not require a live Salesforce org.
Use deterministic local SFDX fixtures for scan/inspect/diagnose/test workflows.

## Troubleshooting

| Symptom                                     | Likely cause                                                     | Fix                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `No sfdx-project.json found`                | Tool was called outside an SFDX project.                         | Pass `workspace` or run from the project root.                                                                                       |
| No components found                         | No LWC bundles in registered package dirs.                       | Check `sfdx-project.json` packageDirectories.                                                                                        |
| Local Jest runner missing                   | Project dependencies are not installed.                          | Install project dependencies outside `sf-lwc`, then rerun.                                                                           |
| `test.run` fails with no Jest JSON          | Runner crashed before writing output.                            | Inspect stdout/stderr artifacts and narrow the test scope.                                                                           |
| Need Apex/schema validation from imports    | `component.inspect` only extracts hints.                         | Use `sf_apex` for Apex and `sf_soql` for schema validation.                                                                          |
| Need SLDS2 uplift or styling-hook migration | `sf_lwc` only detects style signals and recommends skills/tools. | Use `uplifting-components-to-slds2` for guidance and `code_analyzer` SLDS rules or a future `sf-slds2` extension for lint execution. |
