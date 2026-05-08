# SF Data 360 Troubleshooting

## `sf` authentication failed

Run:

```bash
sf org login web --set-default --alias my-sandbox
```

Then retry the `d360_api` call or pass `target_org` explicitly.

## Endpoint returned too much data

Use filters, `limit`, `rowLimit`, `offset`, or endpoint-specific pagination.
Prefer `output_mode: "summary"` or `output_mode: "file_only"` for broad responses. `d360_api` truncates oversized inline output and saves the full response to a temp file.

## Metadata request is too broad

For simple DMO/DLO lists, prefer `d360_metadata` first. List actions show a capped inline table and save the full response to a temp file:

```json
{ "action": "list_dmos", "max_results": 25 }
```

For one object's fields, describe that single object:

```json
{ "action": "describe_dmo", "api_name": "SomeObject__dlm" }
```

Do not call `/ssot/data-model-objects` broadly unless the user explicitly needs the full standard catalog or field inventory.

For other metadata, prefer metadata search first when the search plane is available:

```json
{
  "method": "POST",
  "path": "/connect/search/metadata/results",
  "body": { "query": "the entity you need", "pagination": { "limit": 10 } }
}
```

Then fetch one entity with `/ssot/metadata` and an `entityName` query parameter. If metadata search returns a backend index error, fall back to `/ssot/metadata-entities` or `d360_metadata`; catalog APIs can still be healthy.

## Optional surface returned `NOT_FOUND`

Search indexes, retrievers, and some DataKit manifest paths can return `NOT_FOUND` in an otherwise healthy Data 360 org. Treat these as feature/path availability issues unless core catalog, stream, query, or metadata probes also fail.

## Connector detail returned `NOT_FOUND`

Use the connector catalog `name` from `GET /ssot/connectors` for `/ssot/connectors/{name}`. Do not assume the connection list's `connectorType` is accepted by the connector metadata endpoint.

## DLO category filter returned no rows

`d360_metadata list_dlos` filters on compact metadata categories from `/ssot/metadata-entities`. A detailed DLO description can report a different category. If a category filter returns zero rows, retry without the category filter and inspect the available categories in the helper output.

## Create/update failed with schema errors

1. Fetch the current resource state with a `GET` call.
2. Re-read `examples.md` for a similar payload shape.
3. Remove read-only fields copied from a GET response.
4. Retry with the smallest possible body.

## Raw `sf api request rest` rejected `--json`

Prefer `d360_api`. If you must call raw `sf api request rest`, do not add `--json`; pipe stdout to `jq` and redirect beta warnings from stderr when needed.

## Mutating call was blocked

Re-run with `dry_run: true` and inspect the safety decision. If the operation is
intended, run interactively so the confirmation dialog can appear.
