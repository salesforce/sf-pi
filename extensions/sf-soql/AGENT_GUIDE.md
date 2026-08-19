# SF SOQL Agent Guide

Use this guide for schema-aware CRM SOQL/SOSL work. `sf_soql` owns discovery, validation, query planning, bounded execution, and artifacts; it does not own record mutation or Data 360 SQL.

## Query loop

1. Establish the target org and object.
2. Use `schema.describe`, `schema.relationships`, or `schema.search` before relying on custom fields or relationship names.
3. Draft or validate the query with `query.draft` or `query.validate`.
4. Use `query.explain` when selectivity or scale matters.
5. Prefer `query.count` or `query.sample` before broader `query.run`.
6. Persist/export large results through SOQL Artifacts rather than model context.

## Important boundaries

- Use `api="tooling"` for Tooling API objects such as ApexClass, ApexTrigger, ApexLog, and ApexTestResult.
- `query.queryAll` and `ALL ROWS` can include deleted or archived records; use them only when the user intends that scope and disclose it.
- `query.run` without a bounded limit requires an explicit safety decision and remains hard-capped by the tool.
- Use `sosl.run` for cross-object text search.
- Use `query.export` only for an existing artifact and a deliberate workspace output path.
- Use Data 360 query tools for Data Lake/Data Model Object SQL, profile reads, and vector-search workflows.
- Use data-operation guidance and tools for create/update/delete/import work; `sf_soql` is read-only.

## Evidence

Validation, query-plan signals, samples, counts, and artifact paths are the Behavior Proof. Never infer query correctness from syntax alone when current org schema is available.

## Related domain skills

Prefer `sf_soql` when it can do the action. If it cannot, read one of these Salesforce skills:
`platform-soql-query` · `platform-data-manage`
