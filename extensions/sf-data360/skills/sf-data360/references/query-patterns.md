# SF Data 360 Query Patterns

Use these patterns when inventing Data Cloud SQL, calculated insight SQL, and
semantic queries. Data Cloud SQL is not CRM SOQL.

## Discovery before query

1. Run `d360_probe` if org readiness is uncertain.
2. Use DMO/DLO list endpoints to find candidate objects.
3. Use object metadata endpoints to inspect fields.
4. Start with `COUNT(*)` or a very small `rowLimit`.
5. Paginate through query status/rows endpoints only after the first query shape works.

## Query endpoint shapes

All three Data 360 query endpoints accept the same body shape: a single `sql`
field. Do not use a `query` field; the parser rejects it.

```json
{ "sql": "SELECT COUNT(*) row_count FROM SomeObject__dlm" }
```

- `POST /ssot/query-sql` is the preferred endpoint and accepts an optional
  `rowLimit`. Use `GET /ssot/query-sql/{queryId}` and
  `GET /ssot/query-sql/{queryId}/rows` to pull async results.
- `POST /ssot/queryv2` returns rows synchronously and may return a
  `nextBatchId` for pagination via `GET /ssot/queryv2/{nextBatchId}`.
- `POST /ssot/query` is the V1 legacy endpoint and accepts the same `sql`
  body; prefer `query-sql` or `queryv2` for new work.

## Preferred SQL endpoint

Use:

```json
{
  "method": "POST",
  "path": "/ssot/query-sql",
  "body": {
    "sql": "SELECT COUNT(*) record_count FROM SomeObject__dll",
    "rowLimit": 1
  }
}
```

Use `GET /ssot/query-sql/{queryId}` for status and
`GET /ssot/query-sql/{queryId}/rows?offset=0&rowLimit=100` for rows when the
query returns a query id or requires pagination.

## Table and field naming

- Prefer names discovered from DLO/DMO/metadata endpoints.
- Do not guess custom field names.
- Quote table names if needed, but verify both quoted and unquoted forms if the query plane rejects a discovered catalog name.
- A catalog object can exist while the query plane rejects it because the table is not queryable or external lake access is blocked.

## DMO record query loop

When querying records from a DMO:

1. Select the DMO from metadata.
   - Prefer `d360_metadata` with `action: "list_dmos"`, or `/ssot/metadata-entities?entityType=DataModelObject`, for discovery.
   - Use the user-provided DMO name only after verifying it exists.

2. Inspect the selected DMO.
   - Prefer `d360_metadata` with `action: "describe_dmo"`, or `GET /ssot/data-model-objects/{dmoApiName}`.
   - Choose verified fields only.
   - Prefer non-sensitive fields such as IDs, status/type fields, and timestamps.

3. Count first.

```sql
SELECT COUNT(*) AS record_count
FROM SomeObject__dlm
```

4. Sample second.

```sql
SELECT IdField__c, StatusField__c, CreatedDateField__c
FROM SomeObject__dlm
LIMIT 5
```

5. Keep both SQL `LIMIT` and request `rowLimit` small.

Do not use SOQL assumptions for Data Cloud SQL. Relationship names, field names, and queryability must be verified from Data 360 metadata.

## Safe first query

```sql
SELECT COUNT(*) record_count FROM MyObject__dll
```

Then sample rows:

```sql
SELECT FieldA__c, FieldB__c FROM MyObject__dll LIMIT 10
```

## Profile API requirements

The `/ssot/profile/{dataModelName}` family enforces additional input
requirements that are easy to miss:

- `dataModelName` must be the full DMO API name, including the `__dlm`
  suffix (for example `ssot__AiAgentSession__dlm`).
- `GET /ssot/profile/{dataModelName}` requires the plural `filters` query
  parameter using the bracketed equality syntax
  `filters=[Field__c=Value]`. The singular `filter` query parameter and
  RSQL-style operators are rejected.
- Combine `filters` with `fields` to limit the columns:
  `filters=[ssot__Id__c=019cddc3-...]&fields=ssot__Id__c,ssot__Status__c`.
- `GET /ssot/profile/{dataModelName}/{id}` and the related child/CI
  variants require an `orderby` query parameter when `offset` is
  supplied. The path segment is the unified profile id, not a `__c`
  field value.

## Calculated insight name and Connect REST rules

- The Connect REST endpoints under `/ssot/calculated-insights/{apiName}`
  require `apiName` to end in `__cio`. Calls with any other suffix return
  `ILLEGAL_QUERY_PARAMETER_VALUE`.
- The `/ssot/insight/calculated-insights/{ciName}` and
  `/ssot/insight/metadata/{ciName}` family also require an existing CI; use
  `GET /ssot/calculated-insights` to discover real names first.

## Calculated insight SQL rules

Calculated insight SQL has stricter rules than ad hoc query SQL:

- Use fully qualified `table.field` references.
- `GROUP BY` should use full field references, not select aliases.
- Prefer `APPROX_COUNT_DISTINCT(...)` instead of `COUNT(DISTINCT ...)`.
- Avoid subqueries and subquery aliases.
- Avoid unsupported casts such as `CAST(... AS FLOAT)`; return raw values and compute ratios downstream when needed.
- Avoid date arithmetic forms that the CI validator rejects; use explicit filters supported by the target org.
- Let the API derive dimensions/measures from the expression unless current docs say otherwise.

## Segment SQL patterns

Segments often use nested SQL under `includeDbt.models.models[].sql`. Keep the
SQL focused on the segmented entity id and verify the base entity first.

Pattern:

```sql
SELECT DISTINCT base.IdField__c
FROM UnifiedOrBaseEntity__dlm base
WHERE <conditions>
```

For readable member details after publishing, prefer SQL joins over opaque
member-list output when available.

## Semantic query body shape

Semantic queries use `/semantic-engine/gateway`, not `/ssot/query-sql`.

The body shape is:

```json
{
  "semanticModelId": "MODEL_ID_OR_API_NAME",
  "structuredSemanticQuery": {
    "fields": [
      {
        "expression": {
          "tableField": { "tableName": "DataObjectName", "name": "FieldName" }
        },
        "alias": "FieldAlias",
        "rowGrouping": true
      },
      {
        "expression": { "semanticField": { "name": "CalculatedOrMetricName" } },
        "alias": "MetricAlias",
        "semanticAggregationMethod": "SEMANTIC_AGGREGATION_METHOD_SUM"
      }
    ],
    "options": { "limitOptions": { "limit": 10 } }
  }
}
```

Use `tableField` for fields on a semantic data object. Use `semanticField` for
model-level calculated fields or metrics.

## Recovery from query failures

- `DataModelEntity not found` usually means the table name is wrong or not queryable.
- `Couldn't find CDP tenant ID` is a query-plane readiness problem, not proof every Data Cloud endpoint is off.
- External lake access errors can coexist with healthy catalog, stream, and semantic endpoints.
- Fall back to catalog/metadata probes, choose another known DLO/DMO, and retry with `COUNT(*)`.
