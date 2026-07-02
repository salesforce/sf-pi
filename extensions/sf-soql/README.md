# SF SOQL — Code Walkthrough

## What It Does

SF SOQL is a lean, API-native **SOQL Lifecycle Extension** for pi. It helps the
agent move through the SOQL Query Loop:

```text
describe schema → validate query → explain selectivity → sample/count/run → artifact → iterate
```

It deliberately does **not** become a data explorer, record browser, data export
product, report builder, or CLI wrapper. Broad human exploration remains with
`sf-data-explorer`; data mutation and bulk data operations remain outside
`sf-soql`.

## Runtime Flow

```text
Extension loads
  ├─ register /sf-soql command
  └─ session_start
       ├─ clear cached Salesforce connections
       └─ register sf_soql tool

sf_soql action
  ├─ resolves @salesforce/core connection lazily
  ├─ runs native REST/Tooling API calls
  ├─ writes raw/flattened evidence as SOQL Artifacts
  └─ returns compact SOQL Run Digest + human SOQL Result Card
```

## Key Architecture Decisions

- **API-native hot path** — actions use `@salesforce/core` plus REST/Tooling APIs;
  recurring CLI gaps should become native actions instead of subprocess fallbacks.
- **One family tool** — `sf_soql` uses dotted actions to keep prompt footprint low.
- **Bounded execution** — `query.sample` defaults to a small limit, and `query.run`
  safety-gates broad queries without `LIMIT` unless `max_rows` or `allow_unbounded`
  is explicit.
- **Explicit REST vs Tooling** — pass `api: "tooling"` for Tooling objects such as
  `ApexClass`, `ApexLog`, and `ApexTestResult`.
- **Artifact-first evidence** — full raw/flattened results are persisted; LLM output
  stays compact while still showing bounded field, finding, row, and artifact previews
  needed for the next likely agent decision.
- **SOQL API Call Rail** — cards show concrete native endpoints and high-signal
  request parameters.
- **Full query visibility** — every query-shaped card includes a dedicated SOQL
  Query section with the full normalized query, separate from the compact API rail.
- **Guidance without context bloat** — query-shaping actions recommend the
  `querying-soql` skill for deeper syntax, relationship-query, aggregate-query,
  selector-pattern, and anti-pattern guidance, but `sf_soql` remains the native
  execution authority.

## Behavior Matrix

| Event/Trigger             | Condition                       | Result                                                                  |
| ------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| extension load            | always                          | Register `/sf-soql` command.                                            |
| session_start             | extension enabled               | Register `sf_soql` tool and clear connections.                          |
| session_shutdown          | always                          | Clear cached Salesforce connections.                                    |
| `/sf-soql`                | interactive                     | Open the SF SOQL panel.                                                 |
| `/sf-soql status`         | any mode                        | Print concise extension status.                                         |
| `sf_soql org.preflight`   | explicit tool call              | Check native query readiness.                                           |
| `sf_soql schema.describe` | object provided                 | Describe object fields and relationships.                               |
| `sf_soql query.validate`  | query provided                  | Parse and describe-validate query shape.                                |
| `sf_soql query.explain`   | query provided                  | Retrieve the native query plan.                                         |
| `sf_soql query.sample`    | query provided                  | Run a small bounded sample.                                             |
| `sf_soql query.run`       | bounded query or explicit cap   | Run a read-only query, show a bounded row preview, and write artifacts. |
| `sf_soql query.run`       | no LIMIT and no explicit cap    | Return a safety review card instead of running.                         |
| `sf_soql query.queryAll`  | explicit tool call              | Run queryAll and show a scope warning.                                  |
| `sf_soql history.rerun`   | previous runnable action exists | Rerun the previous SOQL action.                                         |

## Commands

```text
/sf-soql          Open SF SOQL panel
/sf-soql status   Print extension status
/sf-soql help     Print command and tool usage
```

## LLM Tool

`sf_soql` actions:

| Action                 | Description                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `status`               | Report extension/native connection status.                                                          |
| `org.preflight`        | Check org readiness for SOQL lifecycle work.                                                        |
| `schema.search`        | Search queryable sObjects by API name or label.                                                     |
| `schema.describe`      | Describe one sObject for queryable fields and relationships.                                        |
| `schema.relationships` | Show child-to-parent and parent-to-child relationship names.                                        |
| `query.draft`          | Draft a bounded SOQL query from explicit object, fields, filters, and intent.                       |
| `query.validate`       | Parse and describe-validate objects, fields, relationships, field capabilities, literals, and risk. |
| `query.explain`        | Retrieve the native query plan via `/query?explain=...`.                                            |
| `query.sample`         | Run a small bounded sample query.                                                                   |
| `query.run`            | Run a bounded explicit query. Broad queries without `LIMIT` are safety-gated.                       |
| `query.count`          | Convert a query shape to `SELECT COUNT()` and run it.                                               |
| `query.queryAll`       | Explicit queryAll / deleted-row-aware execution.                                                    |
| `query.export`         | Export the latest query artifact to a workspace file.                                               |
| `sosl.run`             | Run a bounded native SOSL search via `/search`.                                                     |
| `file.diagnose`        | Diagnose `.soql` files and embedded Apex `[SELECT ...]` queries.                                    |
| `lsp.status`           | Report current parser/describe diagnostics mode and managed LSP readiness.                          |
| `history.last`         | Return the previous SOQL Run Digest in this session.                                                |
| `history.rerun`        | Rerun the previous runnable SOQL action.                                                            |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-soql/
  lib/
    api.ts                  ← implementation module
    artifacts.ts            ← implementation module
    digest.ts               ← implementation module
    draft.ts                ← implementation module
    errors.ts               ← implementation module
    export.ts               ← implementation module
    file.ts                 ← implementation module
    flattener.ts            ← implementation module
    lsp.ts                  ← implementation module
    operations.ts           ← implementation module
    parser.ts               ← implementation module
    render.ts               ← implementation module
    result.ts               ← implementation module
    runner.ts               ← implementation module
    schema.ts               ← implementation module
    search.ts               ← implementation module
    sf-soql-tool.ts         ← implementation module
    sosl.ts                 ← implementation module
    status.ts               ← implementation module
    types.ts                ← implementation module
    validator.ts            ← implementation module
  tests/
    errors.test.ts          ← unit / smoke test
    flattener.test.ts       ← unit / smoke test
    parser.test.ts          ← unit / smoke test
    render.test.ts          ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run targeted tests while developing:

```bash
npm test -- extensions/sf-soql/tests
```

Before finishing broader changes:

```bash
npm run generate-catalog
npm run format:check
npm run check -- --pretty false
npm test -- extensions/sf-soql/tests extensions/sf-brain/tests/extension-context.test.ts
```

For live-org smoke, use a sandbox/dev org and exercise the native loop:

```bash
npm run e2e:sf-soql -- --org <alias>
```

For deterministic parent-to-child subquery coverage in a non-production org, pass
`--harness-data`. This creates temporary Account/Contact records and deletes them
in a `finally` cleanup block:

```bash
npm run e2e:sf-soql -- --org <alias> --harness-data
```

## Troubleshooting

| Symptom                             | Likely cause                                                                 | Fix                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `query.run` returns a safety review | Query has no top-level `LIMIT` and no explicit row cap.                      | Use `query.sample`, `query.count`, or pass `max_rows`.                   |
| `INVALID_TYPE` or invalid object    | The object name is wrong or belongs to Tooling API.                          | Use `schema.describe`, or run with `api: "tooling"` for Tooling objects. |
| `INVALID_FIELD`                     | Field or relationship name was guessed.                                      | Use `schema.describe` / `schema.relationships` before running.           |
| Query plan unavailable              | Salesforce did not return a plan for that query shape.                       | Run `query.validate`, `query.count`, or a bounded `query.sample`.        |
| Large result not visible in chat    | Full evidence is artifact-first by design; chat shows only bounded previews. | Open the SOQL Artifact paths from the result card.                       |
