# SF Data 360 Examples

Curated public-safe examples that pair with `d360_api`. For full create/update
shapes use `references/data-shapes.md`; for query patterns use
`references/query-patterns.md`. The examples here are the smaller, more
common workflow snippets that do not warrant a full data-shape entry.

## Metadata search

```json
{
  "method": "POST",
  "path": "/connect/search/metadata/results",
  "body": {
    "query": "customer profile fields",
    "pagination": { "limit": 10 },
    "filters": [{ "field": "metadataType", "values": ["DataModelObject"] }]
  }
}
```

## Profile read with filters

`GET /ssot/profile/{dataModelName}` requires the bracketed `filters` syntax
and the unsuffixed-only path segment for `dataModelName`:

```json
{
  "method": "GET",
  "path": "/ssot/profile/ssot__Individual__dlm",
  "query": {
    "filters": "[ssot__Id__c=00DKa0000000000]",
    "fields": "ssot__Id__c,ssot__Status__c",
    "batchSize": 5
  }
}
```

For `GET /ssot/profile/{dataModelName}/{id}`, supply `orderby` whenever
you also pass `offset`.

## CI run + status check

```json
{ "method": "POST", "path": "/ssot/calculated-insights/Customer_Order_Summary__cio/actions/run" }
```

```json
{ "method": "GET", "path": "/ssot/calculated-insights/Customer_Order_Summary__cio" }
```

## Segment delete (bypass deactivate when stuck)

If `actions/deactivate` returns `INTERNAL_ERROR: We couldn't publish your
segment` while the segment is still in `PROCESSING`, deleting still works:

```json
{ "method": "DELETE", "path": "/ssot/segments/Example_Segment", "dry_run": true }
```

Then drop `dry_run` to execute.

## Data stream cleanup with DLO

```json
{
  "method": "DELETE",
  "path": "/ssot/data-streams/ProductStream",
  "query": { "shouldDeleteDataLakeObject": true },
  "dry_run": true
}
```

`shouldDeleteDataLakeObject` is required even when set to `false`.
