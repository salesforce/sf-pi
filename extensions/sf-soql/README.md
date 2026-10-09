# SF SOQL

## What It Does

SF SOQL provides an API-native query lifecycle:

```text
resolve API + schema → validate → explain/count/sample/run → inspect artifacts → iterate
```

It is not a record editor, report builder, data mutation tool, or broad bulk
export surface. Human exploration belongs in SF Data Explorer; normal Pi file
tools own `.soql` and Apex edits.

## Commands

```text
/sf-soql          Open SF SOQL in the SF Pi Manager
/sf-soql status   Print native connection status
/sf-soql help     Print command and tool usage
```

## Actions

`sf_soql` supports readiness, schema search/describe/relationships, bounded query
drafting/validation/explain/sample/run/count/queryAll, SOSL, artifact export,
file diagnostics, parser status through the compatibility `lsp.status` action, and
session history/rerun. Omit `api` to resolve
regular REST versus Tooling from current-org metadata and full query-field
validation. Explicit `api: "rest"` or `api: "tooling"` remains strict.

Result cards show the full normalized query plus the native API rail. Large
result sets remain in raw and flattened SOQL Artifacts while cards show bounded
row and field previews.

## Safety and Data Boundaries

- Startup performs no org probe; connections resolve only for explicit actions.
- Every query execution performs one syntax pass using the API version resolved
  from the current org, followed by recursive, mode-aware schema validation.
  Single-object and chained relationship aliases, multi-level parent paths,
  child-subquery fields/filters/sorts, semi-joins, polymorphic `Name`/`TYPEOF`
  contracts, `FIELDS()` bounds, `FORMULA()` operands, fields nested in
  date/geolocation functions, and documented standard-object query restrictions
  are checked before execution. Predictable object, field, relationship,
  capability, context, object-shape, and API-mode failures are blocked before
  the query endpoint.
- REST and Tooling actions reject Apex bind variables. Embedded Apex file
  diagnostics use a separate Apex parsing context.
- Parser conformance covers public Salesforce examples for SELECT, functions,
  operators, semi/anti-joins, dates, grouping, polymorphism, access clauses, and
  query modifiers. The read-only live harness exercises REST and Tooling behavior
  across org-resolved API versions, including implementation-restricted objects.
- Apex query discovery balances nested brackets, strings, and comments, reports
  source lines, and evaluates `Database.query*()` expressions made only from string
  literals, concatenation, and parentheses. Variable-dependent dynamic SOQL remains
  unresolved. `sf-apex` remains the owner of whole-file Apex diagnostics.
- Session-scoped schema caches are keyed by org, API version, API mode, and object.
- `query.sample` defaults to a small limit. A top-level query without `LIMIT`
  requires an explicit row cap or `allow_unbounded` review.
- `query.queryAll`, `ALL ROWS`, and deleted/archived scope are explicit and
  visible.
- Results are read-only and hard-capped even when broader execution is accepted.
- Explicit exports are confined to `.sf-pi/exports/soql/` under the workspace.
- Object, field, and relationship names should be established through schema
  evidence rather than guessed.

## Troubleshooting

**A run returns a safety review:** Add a top-level `LIMIT`, use `query.sample` or
`query.count`, or pass an intentional `max_rows`.

**Preflight reports an API-mode mismatch:** Omit `api` to use automatic
resolution, or keep the explicit mode and correct the object selection.

**Preflight reports an invalid field or relationship:** Correct the query using
the reported current-org schema finding. No query request was sent.

**Salesforce still reports a runtime error:** Inspect the retained error code.
Transient sessions, permissions, and platform failures can still occur after
schema preflight.

**No query plan is available:** Continue with validation, count, or a bounded
sample; Salesforce does not return a plan for every shape.

**The full result is absent from chat:** Open the reported SOQL Artifact path.
Cards intentionally contain bounded previews.

**Export rejects a path:** Use a relative file name/subpath under the allowed
workspace export directory; absolute paths and `..` are refused.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-soql/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
