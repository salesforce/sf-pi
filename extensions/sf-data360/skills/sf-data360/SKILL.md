---
name: sf-data360
description: Data Cloud/Data 360 workflows using d360 facade runbooks, d360_api, d360_metadata, or d360_probe. Use for Data 360 metadata discovery, SQL queries, DMO/DLO schemas, Agentforce observability, mappings, data streams, calculated insights, segments, activations, semantic data models, search indexes, retrievers, and DataKit operations.
---

# SF Data 360

Use this skill for Salesforce Data Cloud / Data 360 REST work.

## Tool order

1. `d360_probe` first when readiness is uncertain.
2. `d360` action=`search` / `examples` for deterministic operation discovery.
3. `d360` action=`runbook` for Agentforce observability workflows (STDM + Agent Platform Tracing).
4. `d360_metadata` for compact DMO/DLO list and describe.
5. `d360_api` for raw REST escape hatches; `sf api request rest` only as a fallback.

Always pass `target_org` explicitly when the intended Data 360 org is not
the active sf-pi default. Always use the active org API version — do not
hardcode a path like `/services/data/v60.0/...`.

## Default workflow

1. Probe → `d360 search` → `d360 examples` → `d360 runbook`/`execute` or raw `d360_api`.
2. Keep result sets small (`limit`, `rowLimit`, `output_mode: "summary"|"file_only"`).
3. Prefer validation/preview/test endpoints before saving configuration.
4. For `d360 execute` operations with `safety: "confirmed"` or `"destructive"`, run `dry_run: true` first. Only pass `allow_confirmed: true` after the resolved request has been reviewed and the user clearly intends execution.
5. For a non-default explicit `target_org`, d360 tools resolve that org
   through `@salesforce/core` and use its API version and org type.

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

- Use `d360` action=`runbook` for repeated STDM / Agent Platform Tracing
  workflows before hand-writing SQL.
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

## Agentforce session tracing (STDM)

When a question is about Agentforce session traces — "why did agent X
behave wrong yesterday?", "top intent in production?", "which subagent
has the most action errors?" — use **STDM** (Session Trace Data Model)
DMOs in Data Cloud, not the local trace files (those are dev-only).

For `.agent` source / preview / eval / publish, defer to the
**sf-agentscript** skill. STDM is for what production users actually did.

The pre-flight (probe + data-space + agent-name resolution), DMO field
reference, query patterns (find sessions, get conversation timeline,
aggregate metrics, RAG quality), and quirks (NOT_SET sentinel,
TRUST_GUARDRAILS_STEP `error: "None"`, LLM_STEP-not-JSON, 15/18-char
ID inconsistency, propagation lag) live in
`references/agentforce-stdm.md`. Read that before writing any
`/ssot/query-sql` against the `ssot__AiAgent*__dlm` family.

## Agent Platform Tracing

When a question is about Agentforce backend execution — slow LLM spans,
Flow/Apex action failures, retriever/search spans, or reconstructing an
OpenTelemetry-style trace tree — use **Agent Platform Tracing** data in
Data Cloud. Query `ssot__TelemetryTraceSpan__dlm` with `d360_api`, then
reconstruct the tree client-side from span id and parent span id.

Use STDM when you need the conversation; use Agent Platform Tracing when
you need the backend execution chain. When both are available, join
`ssot__AiAgentInteraction__dlm.ssot__TelemetryTraceId__c` to
`ssot__TelemetryTraceSpan__dlm.ssot__TelemetryTrace__c`.

The pre-flight, field reference, copy-paste SQL, tree reconstruction
rules, and quirks live in `references/agent-platform-tracing.md`. Read
that before querying `ssot__TelemetryTraceSpan__dlm`.

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
- `references/agentforce-stdm.md` — Agentforce session tracing DMO
  schema, query patterns, and quirks. Pair with the **sf-agentscript**
  skill for the dev-loop side.
- `references/agent-platform-tracing.md` — Agent Platform Tracing span
  DMO/DLO schema, trace-tree reconstruction, STDM join pattern, and
  backend execution diagnostics.

When local references are not enough, inspect the public upstream repo
before broad web search:
<https://github.com/forcedotcom/d360-mcp-server>. Use it for action-family
design and public payload source material; do not run or embed its Java
MCP server from this extension.
