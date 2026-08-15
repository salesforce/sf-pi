# SF SOQL

## What It Does

SF SOQL provides an API-native query lifecycle:

```text
describe schema → validate → explain → count/sample/run → inspect artifacts → iterate
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
file diagnostics, LSP status, and session history/rerun. Pass `api: "tooling"`
for Tooling objects such as `ApexClass` or `ApexLog`.

Result cards show the full normalized query plus the native API rail. Large
result sets remain in raw and flattened SOQL Artifacts while cards show bounded
row and field previews.

## Safety and Data Boundaries

- Startup performs no org probe; connections resolve only for explicit actions.
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

**Salesforce reports `INVALID_TYPE`:** Describe the object and select the
Tooling API when appropriate.

**Salesforce reports `INVALID_FIELD`:** Use schema describe/relationships before
retrying.

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
