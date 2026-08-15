# SF LWC

## What It Does

SF LWC provides a local-native Lightning Web Component lifecycle:

```text
scan → inspect → diagnose → plan local Jest → run → inspect artifacts → iterate
```

Normal Pi file tools own source edits. SF LWC does not create components,
deploy/retrieve source, synchronize with an org, install dependencies, start
watch mode, or replace Code Analyzer, Apex, schema, or browser evidence.

Full scans, inspections, diagnostics, and Jest output are stored as LWC
Artifacts while model-visible output stays compact.

## Commands

```text
/sf-lwc          Open SF LWC in the SF Pi Manager
/sf-lwc status   Print local readiness
/sf-lwc help     Print command and tool usage
```

## Actions

`sf_lwc` supports `status`, `project.scan`, `component.list`,
`component.inspect`, `file.diagnose`, `test.discover`, `test.plan`, `test.run`,
`history.last`, and `history.rerun`. The active schema is the exact parameter
reference.

Project scans are limited to SFDX package directories. Diagnostics use public
LWC compiler packages. `test.run` invokes the project's local
`node_modules/.bin/lwc-jest` with bounded arguments and timeout.

## Safety and Data Boundaries

- Startup performs no project scan, subprocess, or org probe.
- Every lifecycle action is local-only; no Salesforce org or CLI operation runs.
- The extension never installs dependencies, invokes arbitrary package scripts,
  updates snapshots by default, or starts Jest watch mode.
- Full evidence remains in artifacts; result cards show only bounded project,
  compiler, runner, finding, and path facts.
- Style signals recommend the SLDS2 skill or Code Analyzer; SF LWC does not own
  SLDS lint execution or autofix.

## Troubleshooting

**No `sfdx-project.json` is found:** Pass `workspace` or run from the project
root.

**No components are found:** Verify `packageDirectories` and the LWC bundle
location.

**The local Jest runner is missing:** Install the project's dependencies outside
SF LWC, then rerun discovery or planning.

**Jest fails without JSON:** Inspect the persisted stdout/stderr artifacts and
narrow the test target.

**Apex or schema validation is needed:** Use `sf_apex` or `sf_soql`; component
inspection only reports import and field hints.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-lwc/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
