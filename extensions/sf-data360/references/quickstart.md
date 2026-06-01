# SF Data 360 Quickstart

Use the `data360_*` family tools for Data Cloud / Data 360 work. Every family tool
accepts a compact envelope:

```json
{
  "action": "actions.search",
  "params": {},
  "target_org": "my-data360-sandbox",
  "dry_run": true,
  "output_mode": "summary"
}
```

Pass `target_org` explicitly when the intended Data 360 org is not the sf-pi
default org. Use `dry_run: true` before any confirmed or destructive action.

## Cheatsheet

```json
// 1. Probe readiness once per session
{ "tool": "data360_discover", "action": "readiness.probe" }
```

```json
// 2. Search actions when unsure
{
  "tool": "data360_discover",
  "action": "catalog.search",
  "params": { "query": "ingestion api stream" }
}
```

```json
// 3. List DMOs compactly
{
  "tool": "data360_harmonize",
  "action": "dmo.list",
  "params": { "max_results": 25 }
}
```

```json
// 4. Describe one DMO before query
{
  "tool": "data360_harmonize",
  "action": "dmo.get",
  "params": { "dmoName": "ssot__Individual__dlm", "max_fields": 25 }
}
```

```json
// 5. Read-only raw REST escape hatch
{
  "tool": "data360_api",
  "action": "rest.request",
  "params": { "method": "GET", "path": "/ssot/data-spaces" },
  "target_org": "my-data360-sandbox"
}
```

```json
// 6. SQL count / verification
{
  "tool": "data360_query",
  "action": "sql.verify_rows",
  "params": { "dloName": "SomeObject__dlm" }
}
```

```json
// 7. Dry-run a mutation
{
  "tool": "data360_harmonize",
  "action": "dmo.create",
  "params": { "body": { "/* see data-shapes.md */": true } },
  "dry_run": true
}
```

```json
// 8. Plan a CSV ingest journey
{
  "tool": "data360_orchestrate",
  "action": "manifest.plan",
  "params": { "manifestPath": "data360/ingest.json" }
}
```

For full request bodies see `references/data-shapes.md`. Raw `sf api request
rest` remains a last fallback only when `data360_api rest.request` cannot cover a
new endpoint.
