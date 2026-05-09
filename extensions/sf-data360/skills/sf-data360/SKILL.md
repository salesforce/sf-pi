---
name: sf-data360
description: Data Cloud/Data 360 REST API workflows using d360_api or sf api request rest. Use for Data 360 metadata discovery, SQL queries, DMO/DLO schemas, mappings, data streams, calculated insights, segments, activations, semantic data models, search indexes, retrievers, and DataKit operations.
---

# SF Data 360

Use this skill for Salesforce Data Cloud / Data 360 REST work.

## Tool order

1. `d360_probe` first when readiness is uncertain.
2. `d360_metadata` for compact DMO/DLO list and describe.
3. `d360_api` for everything else; `sf api request rest` only as a fallback.

Always pass `target_org` explicitly when the intended Data 360 org is not
the active sf-pi default. Always use the active org API version — do not
hardcode a path like `/services/data/v60.0/...`.

## Default workflow

1. Probe → metadata-discover → read examples → dry-run mutating calls.
2. Keep result sets small (`limit`, `rowLimit`, `output_mode: "summary"|"file_only"`).
3. Prefer validation/preview/test endpoints before saving configuration.
4. For a non-default explicit `target_org`, `d360_api` will resolve that
   org via `sf org display` and use its API version and org type.

## DMO/DLO discovery discipline

- "List DMOs" means active / metadata-visible Data Model Objects. Use
  `d360_metadata list_dmos` or `GET /ssot/metadata-entities?entityType=DataModelObject`.
- Do not call `GET /ssot/data-model-objects` broadly — it returns full
  DMO definitions (including disabled standard catalog entries).
- Use `d360_metadata describe_dmo` (or `GET /ssot/data-model-objects/{name}__dlm`)
  only after selecting one DMO that needs field-level detail.
- Same pattern for DLOs. `list_dlos` `category` filters are compact
  metadata categories and can differ from detailed DLO categories.

## Output budget

- Prefer compact list/metadata/search endpoints over broad catalog calls.
- Return names, labels, categories, status, and counts by default.
- Use `output_mode: "summary"` or `"file_only"` for broad responses;
  treat truncation as a last-resort safety net.

## Raw `sf api request rest` fallback

- Do not pass `--json` to that subcommand.
- Pipe stdout to `jq`; ignore beta warnings on stderr.
- Always pass `--target-org` explicitly when not using `d360_api`.

## Rules of thumb

- Prefer `/ssot/query-sql` for new query work; `/ssot/query` and
  `/ssot/queryv2` are legacy. All three accept `{ "sql": "..." }` —
  there is no `query` field.
- For mappings, inspect both source DLO and target DMO fields first.
- For calculated insights, validate before create when an
  `actions/validate` endpoint exists; check status before referencing in
  segments. Connect REST `apiName` must end `__cio`.
- For connector detail, use the connector catalog `name` from
  `GET /ssot/connectors`, not the connection `connectorType`.
- For data streams, inspect connector metadata and test the connection
  first. `DELETE` requires `?shouldDeleteDataLakeObject=true|false`.
- For semantic models, create the shell first; subresources are added
  via the URLs returned in the create response. Validate is GET, not POST.
- Confirm destructive operations even in sandboxes unless the user
  explicitly asked for them.

## References

Read these only when needed:

- `references/quickstart.md` — minimum-viable d360 cheatsheet.
- `references/data-shapes.md` — verified create/update payload shapes for
  every common entity, with lifecycle gotchas.
- `references/examples.md` — small workflow snippets that pair with `d360_api`.
- `references/query-patterns.md` — Data Cloud SQL, CI SQL, profile filters, semantic queries.
- `references/endpoint-families.md` — endpoint family map.
- `references/workflows.md` — read-only smoke matrix and recursive validation recipe.
- `references/action-coverage.md` — verified live-mutation lifecycle proofs.
- `references/safety.md` — mutating-operation safety policy.
- `references/readiness.md` — how to interpret `d360_probe` output.
- `references/troubleshooting.md` — symptom → cause → fix index.

When local references are not enough, inspect the public upstream repo
before broad web search:
<https://github.com/forcedotcom/d360-mcp-server>. Use it for action-family
design and public payload source material; do not run or embed its Java
MCP server from this extension.
