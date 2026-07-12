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

## Connection source schema discovery

Use these read-style POST actions before creating streams for database or
third-party connectors. Keep connector-specific metadata in `body` and verify the
object name before describing fields.

```json
{
  "tool": "data360_connect",
  "action": "connection.db_schemas.list",
  "params": {
    "connectionId": "example-connection-id",
    "body": { "advancedAttributes": "{\"database\":\"EXAMPLE_DB\"}" }
  }
}
```

```json
{
  "tool": "data360_connect",
  "action": "connection.object_fields.describe",
  "params": {
    "connectionId": "example-connection-id",
    "resourceName": "CUSTOMER",
    "body": { "advancedAttributes": "{\"database\":\"EXAMPLE_DB\",\"schema\":\"PUBLIC\"}" }
  }
}
```

## Transform prepare before create

```json
{
  "tool": "data360_prepare",
  "action": "transform.prepare",
  "params": {
    "body": {
      "name": "SfPiParity_ExampleTransform",
      "definition": {
        "query": "SELECT Id__c FROM Example_Source__dll",
        "outputObjectName": "Example_Output__dll"
      }
    }
  }
}
```

## Machine Learning discovery and helper query

```json
{
  "tool": "data360_semantic",
  "action": "ml.model_artifact.list",
  "params": { "limit": 10 }
}
```

```json
{
  "tool": "data360_semantic",
  "action": "ml.predict",
  "params": {
    "body": {
      "model": { "name": "Example_Configured_Model" },
      "fieldNames": ["feature_one", "feature_two"],
      "rows": [["A", "10"]]
    }
  }
}
```

## Personalization config discovery

```json
{
  "tool": "data360_activate",
  "action": "personalization.experience_config.list",
  "params": {
    "idOrAppSourceIdOrName": "ExampleConnector",
    "limit": 10,
    "isWpmUrlRequired": false
  }
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
