# SF SOQL Agent Guide

Use this guide for schema-aware CRM SOQL/SOSL work. `sf_soql` owns discovery, validation, query planning, bounded execution, and artifacts; it does not own record mutation or Data 360 SQL.

## Query loop

1. Establish the target org and object.
2. Omit `api` to let sf-soql resolve regular REST versus Tooling from current-org schema evidence. Pass `api="rest"` or `api="tooling"` only when the caller intentionally requires that exact surface.
3. Use `schema.describe`, `schema.relationships`, or `schema.search` when the metadata itself is part of the answer. Query execution also performs the same mode-aware schema validation automatically.
4. Draft or review the query with `query.draft` or `query.validate` when useful; execution does not depend on a separate validation call.
5. Use `query.explain` for regular REST queries when selectivity or scale matters.
6. Prefer `query.count` or `query.sample` before broader `query.run`.
7. Persist/export large results through SOQL Artifacts rather than model context.

## Important boundaries

- Omitted `api` is automatic. sf-soql compares current-org REST and Tooling catalogs/describes and uses full query-field validation to resolve overlaps.
- Explicit `api="rest"` or `api="tooling"` is strict. A mismatch returns a preflight block instead of silently switching or sending a doomed query.
- `query.queryAll` and `ALL ROWS` can include deleted or archived records; use them only when the user intends that scope and disclose it.
- `query.run` without a bounded limit requires an explicit safety decision and remains hard-capped by the tool.
- Use `sosl.run` for cross-object text search.
- Use `query.export` only for an existing artifact and a deliberate workspace output path.
- Use Data 360 query tools for Data Lake/Data Model Object SQL, profile reads, and vector-search workflows.
- Use data-operation guidance and tools for create/update/delete/import work; `sf_soql` is read-only.

## Evidence

Validation, API-resolution evidence, query-plan signals, samples, counts, and artifact paths are the Behavior Proof. Preflight recursively validates multi-level parent paths, child-subquery fields/filters/sorts, semi-join inner queries, direct polymorphic traversal and `TYPEOF ELSE` against Salesforce's `Name` pseudo-object contract, `TYPEOF WHEN` fields against their concrete objects, and fields nested in supported date/geolocation functions. Predictable object, field, relationship, capability, and API-mode failures must be blocked during preflight; the query endpoint is not called. Transient session, permission, and platform failures remain possible and must retain their Salesforce error code.

## Related domain skills

Prefer `sf_soql` when it can do the action. If it cannot, read one of these Salesforce skills:
`platform-soql-query` · `platform-data-manage`
