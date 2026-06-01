# SF Data 360 Examples

Curated public-safe examples for the `data360_*` family tools. For full
create/update shapes use `references/data-shapes.md`; for query patterns use
`references/query-patterns.md`. These snippets show the smaller, common workflow
steps that do not warrant a full data-shape entry.

## Metadata search

```json
{
  "tool": "data360_query",
  "action": "metadata.search",
  "params": {
    "body": {
      "query": "customer profile fields",
      "pagination": { "limit": 10 },
      "filters": [{ "field": "metadataType", "values": ["DataModelObject"] }]
    }
  }
}
```

## Compact DMO / DLO discovery

```json
{
  "tool": "data360_harmonize",
  "action": "dmo.list",
  "params": { "category": "Profile", "max_results": 25 }
}
```

```json
{
  "tool": "data360_prepare",
  "action": "dlo.get",
  "params": { "dloName": "Example__dll", "max_fields": 25 }
}
```

## Profile read with filters

`profile.query` maps to `GET /ssot/profile/{dataModelName}`. Use the bracketed
`filters` syntax and the unsuffixed-only path segment for `dataModelName`:

```json
{
  "tool": "data360_query",
  "action": "profile.query",
  "params": {
    "dataModelName": "ssot__Individual__dlm",
    "filters": "[ssot__Id__c=00D000000000000]",
    "fields": "ssot__Id__c,ssot__Status__c",
    "batchSize": 5
  }
}
```

For `GET /ssot/profile/{dataModelName}/{id}`, supply `orderby` whenever you also
pass `offset`.

## CI run + status check

```json
{
  "tool": "data360_segment",
  "action": "ci.run",
  "params": { "ciName": "Customer_Order_Summary__cio" },
  "dry_run": true
}
```

```json
{
  "tool": "data360_segment",
  "action": "ci.get",
  "params": { "ciName": "Customer_Order_Summary__cio" }
}
```

## Segment delete (bypass deactivate when stuck)

If `actions/deactivate` returns an internal processing error while the segment is
still `PROCESSING`, deleting can still work after review:

```json
{
  "tool": "data360_segment",
  "action": "segment.delete",
  "params": { "segmentApiName": "Example_Segment" },
  "dry_run": true
}
```

Then rerun with `allow_confirmed: true` only after reviewing the dry-run.

## Data stream cleanup with DLO

```json
{
  "tool": "data360_orchestrate",
  "action": "cleanup.plan",
  "params": {
    "dataStreamIds": ["1ds000000000000AAA"],
    "shouldDeleteDataLakeObject": true
  }
}
```

`shouldDeleteDataLakeObject` is required by the underlying API even when set to
`false`.
