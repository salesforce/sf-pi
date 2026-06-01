<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Connect Reference

Set up and inspect Data 360 source connectivity.

## Use this reference when

Data 360 Connect phase. Use when managing connections, connectors, source systems, source metadata, connection tests, or source endpoints with sf-data360 tools.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- **Connection** — Inspect connectors, connections, endpoints, and source metadata.
- **Ingestion** — Discover connectors, connections, data streams, and ingestion health surfaces.

- Capabilities: 17 (0 runbook-backed)
- Safety mix: read=10, safe_post=2, confirmed=4, destructive=1

## Data 360 family actions

- `data360_connect` `auth.clear` (tenant_ingest_auth, read) — Clear one or all in-memory Data Cloud ingest auth sessions.
- `data360_connect` `auth.pkce_start` (tenant_ingest_auth, read) — Start a PKCE authorization flow for Data Cloud ingest auth and keep the code verifier in memory only.
- `data360_connect` `auth.plan` (tenant_ingest_auth, read) — Plan a headless-safe Data Cloud tenant ingest auth setup path without persisting credentials.
- `data360_connect` `auth.sessions` (tenant_ingest_auth, read) — List in-memory Data Cloud ingest auth sessions without tokens.
- `data360_connect` `auth.status` (tenant_ingest_auth, read) — Inspect whether Data Cloud tenant ingest auth is configured for Ingestion API jobs.
- `data360_connect` `connection_endpoints` (rest_operation, read) — List pre-configured connection endpoints.
- `data360_connect` `connection.get` (rest_operation, read) — Get one connection by id.
- `data360_connect` `connection.list` (rest_operation, read) — List connections for a connector type.

## Cross-phase routing

| Phase       | Reference                          | Summary                                                      |
| ----------- | ---------------------------------- | ------------------------------------------------------------ |
| Connect     | `references/phases/connect.md`     | Set up and inspect Data 360 source connectivity.             |
| Prepare     | `references/phases/prepare.md`     | Prepare raw data structures and ingestion pipelines.         |
| Harmonize   | `references/phases/harmonize.md`   | Model, map, and unify data into harmonized entities.         |
| Segment     | `references/phases/segment.md`     | Build and inspect audience segments and calculated insights. |
| Act         | `references/phases/act.md`         | Deliver audiences and data-triggered actions downstream.     |
| Retrieve    | `references/phases/retrieve.md`    | Query, search, and inspect Data 360 data and metadata.       |
| Observe     | `references/phases/observe.md`     | Analyze Agentforce sessions and platform traces in Data 360. |
| Orchestrate | `references/phases/orchestrate.md` | Plan and troubleshoot cross-phase Data 360 workflows.        |

## Upstream reference fallback

If this generated reference and the local sf-data360 references are insufficient, inspect the public upstream Data 360 MCP server repository for reference material. Do not run or embed the upstream Java MCP server from this extension.
