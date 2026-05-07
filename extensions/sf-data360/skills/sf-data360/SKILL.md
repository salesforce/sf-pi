---
name: sf-data360
description: Data Cloud/Data 360 REST API workflows using d360_api or sf api request rest. Use for Data 360 metadata discovery, SQL queries, DMO/DLO schemas, mappings, data streams, calculated insights, segments, activations, semantic data models, search indexes, retrievers, and DataKit operations.
---

# SF Data 360

Use this skill when working with Salesforce Data Cloud / Data 360 REST APIs.

## Execution preference

1. Use `d360_probe` first when Data Cloud/Data 360 readiness is uncertain.
2. Prefer `d360_metadata` for compact DMO/DLO list and describe tasks.
3. Prefer the native `d360_api` tool for other Data 360 REST endpoints.
4. If `d360_api` is unavailable, use `sf api request rest` directly.
5. Always use the active org API version from the Salesforce environment.
6. Always name the target org explicitly for mutating calls.

## Default workflow

1. Probe readiness before assuming Data Cloud is on or off.
2. Discover metadata before querying or mutating.
3. Read examples before complex create/update calls.
4. Use `dry_run: true` before create, update, run, publish, deploy, undeploy, or delete.
5. Keep result sets small with limits, row limits, and pagination.
6. Prefer validation, preview, and test endpoints before saving configuration.

## DMO/DLO discovery discipline

When the user asks to list DMOs, first decide which list they mean.

Default interpretation:

- "List DMOs" means active / metadata-visible Data Model Objects.
- Use `d360_metadata` with `action: "list_dmos"`, or `GET /ssot/metadata-entities?entityType=DataModelObject`.
- Return only category, display name, and API name unless more detail is requested.

Do not use `GET /ssot/data-model-objects` for a simple list. That endpoint returns full DMO definitions, including fields, disabled/unassigned standard catalog entries, and can produce very large responses.

Use `d360_metadata` with `action: "describe_dmo"`, or `GET /ssot/data-model-objects/{dmoApiName}`, only after selecting one DMO and needing its fields, mappings, enabled status, or segmentability.

For DLOs, follow the same pattern: use compact metadata list/describe helpers first, then inspect detailed DLO schema only when required. Treat `category` filters on `list_dlos` as compact metadata categories; detailed DLO schema categories can differ.

If the user explicitly asks for the full standard DMO catalog or field inventory:

1. Keep limits small.
2. Paginate deliberately.
3. Prefer `output_mode: "summary"` or `output_mode: "file_only"` for broad `d360_api` calls.
4. Summarize in chat instead of pasting full nested field payloads.

## Output budget rules

Avoid broad Data 360 calls that return nested field arrays unless field-level detail is required.

For list requests:

- Prefer `d360_metadata` or metadata/search endpoints that return compact records.
- Return names, labels, categories, status, and counts.
- Do not paste full field definitions by default.

For large responses:

- Prefer saving raw JSON to a file and returning a concise summary.
- Treat `d360_api` truncation as a last-resort safety net, not a normal workflow.
- A 50 KB truncated result still consumes meaningful context.

## Raw sf api request fallback

Prefer `d360_api` over raw `sf api request rest`.

If raw `sf api request rest` is necessary:

- Do not pass `--json`; some CLI versions do not support it for this command.
- Pipe stdout to `jq` for formatting.
- Redirect or ignore beta warnings from stderr when needed.
- Always pass `--target-org` explicitly when not using `d360_api`.

## References

Read these files only when needed:

- `references/quickstart.md` — common `d360_api` examples.
- `references/workflows.md` — end-to-end operation sequences.
- `references/endpoint-families.md` — endpoint families and representative paths.
- `references/examples.md` — public-safe payload examples.
- `references/data-shapes.md` — request-body shapes distilled from public examples and DTOs.
- `references/query-patterns.md` — Data Cloud SQL, CI SQL, and semantic query guidance.
- `references/safety.md` — mutating-operation safety policy.
- `references/readiness.md` — how to interpret Data 360 readiness probes.
- `references/troubleshooting.md` — common failures and recovery steps.

## Rules of thumb

- Prefer `d360_metadata` or metadata search over broad metadata listing.
- Prefer Data 360 query SQL endpoints over legacy query endpoints for new work.
- Read `references/query-patterns.md` before inventing Data Cloud SQL, calculated insight SQL, or semantic queries.
- For mappings, inspect both source DLO and target DMO fields first.
- For calculated insights, validate before create/update and check status before using in segments.
- For data streams, inspect connector metadata and test connections first.
- For semantic models, create the model shell first, then add data objects, relationships, calculations, and metrics.
- Read `references/data-shapes.md` before complex create/update calls.
- Confirm destructive operations even in sandboxes unless the user explicitly asked for them.
