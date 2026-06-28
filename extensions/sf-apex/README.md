# SF Apex — Code Walkthrough

## What It Does

SF Apex is a lean, API-native **Apex Lifecycle Extension** for pi. It helps the
agent move through the Apex loop:

```text
author → diagnose → trace/log/watch → anon probe → targeted test → fix
```

It deliberately does **not** edit source files itself. Agents still use normal
Pi `read`, `write`, and `edit` tools for code changes. `sf-apex` provides the
Apex-specific lifecycle primitives around those edits:

- `org.preflight`, `apex.search`, `test.discover`, `test.plan`, `coverage.summary` — bounded native discovery actions for Apex lifecycle decisions
- `author.plan` — lightweight authoring plan, likely tests, and existing skill hints
- `diagnose.file` — Apex diagnostics via a managed Apex LSP during the `sf-lsp` handoff
- `trace.start` / `trace.stop` / `trace.status` — bounded Tooling API trace setup
- `log.latest` / `log.get` / `log.analyze` / `log.watch` — high-signal Apex log digestion
- `anon.run` — native Anonymous Apex execution with log capture
- `test.run` / `test.result` / `test.rerun` — native targeted test runs

Full logs, digests, Anonymous Apex bodies/results, and test results are persisted
as **Apex Artifacts** under the global agent directory. Tool output stays compact
for the LLM and renders as human-friendly **Apex Result Cards** in the TUI.

## Runtime Flow

```text
Extension loads
  ├─ register /sf-apex command
  └─ session_start
       ├─ clear cached Salesforce connections
       └─ register sf_apex tool

sf_apex action
  ├─ local-only actions: author.plan, diagnose.file, log.analyze
  ├─ API-native actions resolve @salesforce/core connection lazily
  ├─ Tooling/REST call runs on the fast native path
  ├─ raw evidence is written as Apex Artifacts
  └─ compact digest returns to the LLM + custom TUI renderer
```

## Key Architecture Decisions

- **API-native hot path** — lifecycle actions use `@salesforce/core` plus
  Tooling/REST APIs by default so they feel fast and native. If a lifecycle
  capability is missing, prefer adding a small native action over routing
  `sf-apex` through Salesforce CLI subprocess stacks. See ADR 0069.
- **One family tool** — `sf_apex` uses dotted actions instead of many tools,
  keeping prompt footprint low while covering the lifecycle.
- **Source edits stay generic** — normal Pi file tools edit Apex. `sf-apex`
  guides, diagnoses, observes, probes, and tests.
- **Diagnostics handoff** — Apex diagnostics move toward `sf-apex`; `sf-lsp`
  remains the transitional fallback until the handoff is complete.
- **Artifact-first evidence** — raw logs and test results stay on disk; the LLM
  sees summaries and artifact pointers.
- **API Call Rail** — human cards include a compact rail of concrete native endpoints
  and high-signal request parameters, while raw payloads remain in structured details.

## Result Cards

Human-facing cards are expanded by default but avoid repeated evidence/next-step
footers. The card title is followed by an API Call Rail, then action-specific
sections such as Apex Log Timeline, Root Cause, Run Summary, File Gate, or Trace
Capture.

Example:

```text
❌ 🔎 Apex Log Timeline · failed · MyDevOrg · log=07L…Pmz
   API
   │ GET      /tooling/query ApexLog             metadata · id=07L…Pmz
   │ GET      /tooling/sobjects/ApexLog/Body     id=07L…Pmz

—— 🔥 Root Cause ——
  🔥 Type         System.DmlException
  💬 Message      INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST...
  ↩️ Rollback     observed in debug markers

—— ⏱️ Timeline ——
  ▶️ start        Apex execution
  📝 +3ms         dml · Op:Insert · Type:SfApexHarness__c · Rows:1
  🔥 +4ms         exception · System.DmlException: ...
```

## Release Hardening Harness

`sf-apex` is validated against a dedicated local harness project that deploys the
`SfApexHarness` fixture to a development org. The harness includes:

- `SfApexHarness__c` plus focused fields and permission set access.
- service, trigger/handler, queueable, batch, schedulable, and invocable Apex.
- matching test classes and Anonymous Apex smoke / rollback scripts.

The harness has been used to validate native discovery, targeted test execution,
coverage summaries, trace capture, log timelines, mutation guards, rollback-safe
Anonymous Apex, controlled runtime failures, and controlled failing Apex test
cards. A Flow observation smoke can use an existing active Autolaunched Flow via
`Flow.Interview`; a purpose-built Flow → harness invocable scenario remains
pending until the Flow-generation MCP pipeline is available.

## Behavior Matrix

| Event/Trigger              | Condition                | Result                                                       |
| -------------------------- | ------------------------ | ------------------------------------------------------------ |
| extension load             | always                   | Register `/sf-apex` command.                                 |
| session_start              | extension enabled        | Register `sf_apex` tool and clear cached org connections.    |
| session_shutdown           | always                   | Clear cached org connections.                                |
| `/sf-apex`                 | interactive              | Open status/actions panel.                                   |
| `/sf-apex status`          | any mode                 | Print concise extension status.                              |
| `sf_apex author.plan`      | local                    | Return lightweight plan, likely tests, and skill hints.      |
| `sf_apex org.preflight`    | explicit tool call       | Check native Apex lifecycle readiness in the target org.     |
| `sf_apex apex.search`      | explicit tool call       | Search active Apex classes/triggers for lifecycle targets.   |
| `sf_apex test.discover`    | explicit tool call       | Find candidate Apex test classes for targets or query terms. |
| `sf_apex test.plan`        | explicit tool call       | Recommend the smallest useful test scope.                    |
| `sf_apex coverage.summary` | explicit tool call       | Summarize native Tooling coverage for named classes.         |
| `sf_apex trace.start`      | explicit tool call       | Create/update bounded current-user trace flag.               |
| `sf_apex log.watch`        | explicit tool call       | Poll for a new ApexLog and analyze it.                       |
| `sf_apex anon.run`         | explicit tool call       | Execute Anonymous Apex natively and capture/analyze the log. |
| `sf_apex test.run`         | explicit classes/methods | Run native targeted tests and summarize results.             |

## Commands

```text
/sf-apex          Open SF Apex panel
/sf-apex status   Print extension status
/sf-apex help     Print command and tool usage
```

## LLM Tool

`sf_apex` actions:

| Action             | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `status`           | Resolve org connection and report active SF Pi trace flags.                      |
| `org.preflight`    | Check target-org Apex readiness, active traces, and recent test queue state.     |
| `apex.search`      | Search active Apex classes/triggers by name, with a test-only filter.            |
| `test.discover`    | Find candidate test classes from targets, class names, or query terms.           |
| `test.plan`        | Recommend the smallest useful test class to run first.                           |
| `coverage.summary` | Summarize Tooling coverage for named classes or target files.                    |
| `author.plan`      | Return local authoring guidance, likely tests, and skill hints.                  |
| `diagnose.file`    | Run Apex diagnostics for one `.cls` or `.trigger` file via the managed Apex LSP. |
| `trace.start`      | Start or refresh a bounded DEVELOPER_LOG trace for a user.                       |
| `trace.stop`       | Stop active SF Pi Apex trace flags for a user.                                   |
| `trace.status`     | Show active trace flags.                                                         |
| `log.latest`       | Fetch and analyze the latest Apex log for a user.                                |
| `log.get`          | Fetch and analyze one Apex log by Id.                                            |
| `log.analyze`      | Parse a raw log body or local log file.                                          |
| `log.watch`        | Bounded native tail-like observer for new Apex logs.                             |
| `anon.run`         | Execute Anonymous Apex and capture/analyze the resulting log.                    |
| `test.run`         | Run targeted Apex tests by class or method.                                      |
| `test.result`      | Poll/summarize a prior targeted test run.                                        |
| `test.rerun`       | Rerun the previous targeted test spec in this session.                           |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-apex/
  lib/
    anonymous.ts            ← implementation module
    api.ts                  ← implementation module
    artifacts.ts            ← implementation module
    author.ts               ← implementation module
    diagnostics.ts          ← implementation module
    digest.ts               ← implementation module
    discovery.ts            ← implementation module
    log-parser.ts           ← implementation module
    logs.ts                 ← implementation module
    operations.ts           ← implementation module
    render.ts               ← implementation module
    result.ts               ← implementation module
    sf-apex-tool.ts         ← implementation module
    soql.ts                 ← implementation module
    tests.ts                ← implementation module
    trace.ts                ← implementation module
    types.ts                ← implementation module
  tests/
    anonymous.test.ts       ← unit / smoke test
    artifacts.test.ts       ← unit / smoke test
    log-parser.test.ts      ← unit / smoke test
    render.test.ts          ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    tests.test.ts           ← unit / smoke test
    trace.test.ts           ← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run targeted tests while developing:

```bash
npm test -- extensions/sf-apex/tests
```

Before finishing broader changes:

```bash
npm run generate-catalog
npm run format:check
npm run check
npm test
```

## Release Checks

Before release, run at minimum:

```bash
npm test -- extensions/sf-apex/tests lib/common/tests/sf-conn-connection.test.ts
npm run check -- --pretty false
npm run check:boot-path
npm run e2e:sf-apex-harness -- --org <alias> --harness-cwd <path-to-harness-project> --flow <FlowApiName>
```

Recommended Code Analyzer scans:

- `Recommended:Security` on `extensions/sf-apex` and shared connection helpers.
- `sfge:Recommended` on the Apex harness project.
- `pmd:Recommended` on harness Apex when harness files change.

## Troubleshooting

**`sf_apex` cannot resolve the org:**
Confirm the target org alias is authenticated. Use `/sf-org` or pass
`target_org` explicitly.

**No log appears during `log.watch`:**
Confirm the code path actually ran after the watch started. The watch is bounded
and API-native; it does not start an unbounded CLI tail process.

**Anonymous Apex is refused as mutating:**
Pass `allow_mutation=true` only when the DML/async behavior is intentional.
Prefer rollback-safe probes for data mutations.
