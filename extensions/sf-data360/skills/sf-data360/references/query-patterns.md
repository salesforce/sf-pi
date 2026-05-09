# SF Data 360 Query Patterns

Data Cloud SQL is not CRM SOQL. Use these patterns when inventing SQL,
calculated insight SQL, profile reads, or semantic queries.

## Discovery before query

1. `d360_probe` if readiness is uncertain.
2. `d360_metadata list_dmos` / `list_dlos` to find candidate objects.
3. `d360_metadata describe_dmo` / `describe_dlo` to verify field names.
4. Start with `COUNT(*)` and a small `rowLimit`.
5. Paginate via query-status/rows endpoints only after the shape works.

## Query endpoint shapes

All three Data 360 query endpoints accept the same body: a single `sql`
field. Do not use `query`; the parser rejects it.

```json
{ "sql": "SELECT COUNT(*) row_count FROM SomeObject__dlm", "rowLimit": 1 }
```

| Endpoint               | Notes                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `POST /ssot/query-sql` | Preferred. Optional `rowLimit`. Use `/{queryId}` and `/{queryId}/rows` for async.  |
| `POST /ssot/queryv2`   | Synchronous. May return `nextBatchId` for pagination via `/queryv2/{nextBatchId}`. |
| `POST /ssot/query`     | V1 legacy. Same `sql` body. Prefer query-sql or queryv2 for new work.              |

## Table and field naming

- Use names verified from DLO/DMO/metadata; do not guess `__c` field names.
- A catalog object can exist while the query plane rejects it
  (table not queryable, external lake access blocked).
- Quote table names if needed; if the catalog name is rejected, retry
  unquoted before assuming the table is missing.

## DMO record query loop

1. Select the DMO from `d360_metadata list_dmos`.
2. Describe with `d360_metadata describe_dmo`; pick a few non-sensitive
   verified fields (ids, statuses, timestamps).
3. `SELECT COUNT(*) record_count FROM SomeObject__dlm` first.
4. `SELECT FieldA__c, FieldB__c FROM SomeObject__dlm LIMIT 5` second.
5. Keep both SQL `LIMIT` and request `rowLimit` small.

## Profile API

- `dataModelName` is the full DMO API name with the `__dlm` suffix.
- `GET /ssot/profile/{dataModelName}` requires
  `filters=[Field__c=Value]` (plural, bracketed). Singular `filter=` and
  RSQL operators are rejected. Combine with `fields=Field1,Field2` to
  limit the projection.
- `GET /ssot/profile/{dataModelName}/{id}` and child/CI variants require
  `orderby` whenever `offset` is supplied. The path segment is the
  unified profile id, not a `__c` field value.

## Calculated insight SQL rules

Stricter than ad-hoc query SQL:

- Fully qualified `table.field` references in projection and `GROUP BY`.
- Prefer `APPROX_COUNT_DISTINCT(...)` over `COUNT(DISTINCT ...)`.
- Avoid subqueries, subquery aliases, and unsupported casts (e.g.
  `CAST(... AS FLOAT)`).
- Let the API derive dimensions/measures from the expression.
- Connect REST endpoints under `/ssot/calculated-insights/{apiName}`
  require `apiName` ending in `__cio`. The
  `/ssot/insight/calculated-insights/{ciName}` family needs an existing
  CI; discover names with `GET /ssot/calculated-insights` first.

## Segment SQL

Segment DBT SQL must:

- Use unaliased fully-qualified identifiers in the primary projection.
- Project both the primary key and key qualifier of the segmentOn
  entity.

```sql
SELECT DISTINCT base.ssot__Id__c, base.KQ_Id__c
FROM UnifiedOrBaseEntity__dlm AS base
```

See `data-shapes.md` for the full segment create body.

## Semantic queries

Semantic queries use `/semantic-engine/gateway`, not `/ssot/query-sql`.
Use `tableField` for data-object fields and `semanticField` for
model-level calculated fields, dimensions, or metrics. The full body
shape is in `data-shapes.md` under "Semantic engine query".

## Recovery

- `DataModelEntity not found` → wrong table name or not queryable; pick another verified DMO/DLO and retry.
- `Couldn't find CDP tenant ID` → query-plane readiness issue, not a global Data Cloud outage.
- External lake errors can coexist with healthy catalog, stream, and semantic endpoints.
- Fall back to catalog/metadata probes and `COUNT(*)` smoke before
  retrying the failing query.
