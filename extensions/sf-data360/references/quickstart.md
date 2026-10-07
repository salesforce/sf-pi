# SF Data 360 Quickstart

Use one `sf_data360` call with a business-namespaced action:

```json
{
  "action": "discover.readiness.probe",
  "target_org": "my-data360-sandbox"
}
```

```json
{
  "action": "discover.action.search",
  "params": { "query": "ingestion api stream" }
}
```

```json
{
  "action": "discover.action.describe",
  "params": { "action": "prepare.stream.create_ingest_api" }
}
```

```json
{
  "action": "harmonize.dmo.list",
  "params": { "max_results": 25 }
}
```

```json
{
  "action": "query.sql.run",
  "params": {
    "sql": "SELECT COUNT(*) AS total FROM Example__dlm",
    "transferMode": "ADAPTIVE",
    "queryRowLimit": 10
  }
}
```

```json
{
  "action": "harmonize.dmo.create",
  "params": { "body": {} },
  "dry_run": true
}
```

```json
{
  "action": "orchestrate.manifest.plan",
  "params": { "manifestPath": "data360/ingest.json" }
}
```

```json
{
  "action": "api.request",
  "params": { "method": "GET", "path": "/ssot/data-spaces" }
}
```

Pass `target_org` explicitly when the intended org is not the active target. Use `dry_run: true` before mutation and `allow_mutation: true` only after review.
