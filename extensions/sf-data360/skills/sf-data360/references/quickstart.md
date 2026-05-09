# SF Data 360 Quickstart

`d360_api` calls take a `path` relative to `/services/data/vXX.X`. Pass
`target_org` explicitly when the intended Data 360 org is not the
sf-pi default org. Pass `dry_run: true` before any mutating call.

## Cheatsheet

```json
// 1. Probe readiness once per session
{ "tool": "d360_probe" }

// 2. List DMOs compactly
{ "tool": "d360_metadata", "action": "list_dmos", "max_results": 25 }

// 3. Describe one DMO before query
{ "tool": "d360_metadata", "action": "describe_dmo", "api_name": "ssot__Individual__dlm", "max_fields": 25 }

// 4. Read-only call
{ "tool": "d360_api", "method": "GET", "path": "/ssot/data-spaces", "target_org": "my-data360-sandbox" }

// 5. SQL count
{
  "tool": "d360_api",
  "method": "POST",
  "path": "/ssot/query-sql",
  "body": { "sql": "SELECT COUNT(*) row_count FROM SomeObject__dlm", "rowLimit": 1 }
}

// 6. Dry-run a mutation
{ "tool": "d360_api", "method": "POST", "path": "/ssot/data-model-objects", "body": { /* see data-shapes.md */ }, "dry_run": true }
```

For full request bodies see `references/data-shapes.md`. For raw fallback,
translate to `sf api request rest`:

```bash
sf api request rest /services/data/v66.0/ssot/data-model-objects \
  --method GET \
  --target-org my-data360-sandbox
```
