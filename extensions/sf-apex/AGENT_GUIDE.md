# SF Apex Agent Guide

Use this guide for multi-step Apex authoring, diagnostics, logs, probes, and test workflows. `sf_apex` owns lifecycle evidence; normal Pi file tools own source edits.

## Behavior-proof-first loop

1. Use `author.plan`, `test.discover`, or `test.plan` to establish the intended change and smallest focused proof.
2. Reproduce the problem with a targeted test when feasible. Use `anon.run` only for a bounded probe or rollback rehearsal when a maintainable test is not yet available.
3. Edit the smallest relevant Apex source file with normal file tools.
4. Run `diagnose.file` and the focused `test.run` target.
5. Use `test.result` or `test.rerun` until green; request coverage evidence only when it informs the task.
6. Report test outcomes and persisted Apex Artifact paths.

## Action families

- Readiness and discovery: `status`, `org.preflight`, `apex.search`, `test.discover`, `test.plan`, `test.suites`.
- Local evidence: `author.plan`, `diagnose.file`.
- Runtime evidence: `trace.start`, `log.latest`, `log.get`, `log.watch`, `log.analyze`, `trace.stop`.
- Bounded probes: `anon.run`; set `allow_mutation=true` only when intentional and Guardrail-approved.
- Tests: `test.run`, `test.result`, `test.rerun`, `coverage.summary`.
- Missing local source comparison: `apex.source.get` returns read-only Org Apex Source Evidence; it does not replace Metadata API retrieval or local editing.

## Grounding and safety

- Use explicit target orgs for mutations and org-dependent tests.
- Do not guess test classes or methods; use discovery when the target is unclear.
- Start trace flags before asking the user to reproduce runtime behavior, and stop them when the bounded investigation ends.
- Keep raw logs and reports in artifacts. Bring stack traces, limit signals, debug markers, and failing assertions into model context.
- Raw Salesforce CLI is a fallback only when `sf_apex` lacks the required lifecycle capability.

## Related domain skills

Prefer `sf_apex` when it can do the action. If it cannot, read one of these Salesforce skills:
`platform-apex-generate` · `platform-apex-test-generate` · `platform-apex-test-run` · `platform-apex-logs-debug`
