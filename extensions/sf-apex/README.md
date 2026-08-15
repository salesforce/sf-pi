# SF Apex

## What It Does

SF Apex provides an API-native Apex lifecycle for Pi:

```text
author → diagnose → trace/log/watch → bounded probe → targeted test → fix
```

Normal Pi file tools still own source edits. The `sf_apex` family owns Apex
planning, diagnostics, trace flags, logs, Anonymous Apex probes, targeted tests,
and coverage evidence. Raw logs and reports are stored as Apex Artifacts while
model-visible output stays compact.

Result cards show the native API rail and action-specific evidence such as log
timelines, root causes, run summaries, file gates, or trace captures.

## Commands

```text
/sf-apex          Open SF Apex in the SF Pi Manager
/sf-apex status   Print extension status
/sf-apex help     Print command and tool usage
```

## Actions

- **Readiness and discovery:** `status`, `org.preflight`, `apex.search`,
  `test.discover`, `test.plan`, `test.suites`, `coverage.summary`.
- **Authoring evidence:** `author.plan`, `diagnose.file`, `apex.source.get`.
- **Runtime evidence:** `trace.start`, `trace.stop`, `trace.status`,
  `log.latest`, `log.get`, `log.analyze`, `log.watch`.
- **Bounded execution:** `anon.run`, `test.run`, `test.result`, `test.rerun`.

The active tool schema is the exact parameter reference. Multi-step ordering and
recovery live in [`AGENT_GUIDE.md`](./AGENT_GUIDE.md).

## Safety and Data Boundaries

- Startup performs no org probe; connections resolve only for explicit actions.
- Trace flags have bounded lifetimes and can be stopped explicitly.
- Mutation-like Anonymous Apex requires `allow_mutation=true` and remains
  Guardrail-mediated.
- Tests are scoped to explicit classes or methods; SF Apex is not an org-wide
  test dashboard.
- Full source, logs, diagnostics, and test evidence remain in artifacts rather
  than being copied wholesale into model context.

## Troubleshooting

**`sf_apex` cannot resolve the org:** Confirm the alias is authenticated and
pass `target_org` explicitly when the intended target is not the current default.

**No log appears during `log.watch`:** Confirm the code path ran after the watch
started. The watch is bounded and does not start an unbounded CLI tail process.

**Anonymous Apex is refused as mutating:** Pass `allow_mutation=true` only when
execution is intentional. Prefer a focused Apex test or rollback-safe probe.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-apex/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
