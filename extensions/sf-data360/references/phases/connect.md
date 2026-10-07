<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Connect Reference

Set up and inspect Data 360 source connectivity.

## Use this reference when

Data 360 Connect phase. Use when managing connections, connectors, source systems, source metadata, connection tests, or source endpoints with sf-data360 tools.

## Tool discipline

1. Use `sf_data360` with an action in this business namespace.
2. Use `discover.action.search` when the exact action is unclear.
3. Use `discover.action.describe` and `discover.action.example` before complex mutations.
4. Use `dry_run: true` before mutations and review the resolved request.
5. Use `api.request` only as the exact REST escape hatch when no named action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested business actions or orchestrated journeys.

## Phase coverage

- **Connection** — Inspect connectors, connections, endpoints, and source metadata.
- **Ingestion** — Discover connectors, connections, data streams, and ingestion health surfaces.

- Capabilities: 20 (0 runbook-backed)
- Safety mix: read=10, safe_post=5, confirmed=4, destructive=1

## Data 360 family actions

- `sf_data360` `connect.auth.clear` (connect, tenant_ingest_auth, read) — Clear one or all in-memory Data Cloud ingest auth sessions.
- `sf_data360` `connect.auth.pkce_start` (connect, tenant_ingest_auth, read) — Start a PKCE authorization flow for Data Cloud ingest auth and keep the code verifier in memory only.
- `sf_data360` `connect.auth.plan` (connect, tenant_ingest_auth, read) — Plan a headless-safe Data Cloud tenant ingest auth setup path without persisting credentials.
- `sf_data360` `connect.auth.sessions` (connect, tenant_ingest_auth, read) — List in-memory Data Cloud ingest auth sessions without tokens.
- `sf_data360` `connect.auth.status` (connect, tenant_ingest_auth, read) — Inspect whether Data Cloud tenant ingest auth is configured for Ingestion API jobs.
- `sf_data360` `connect.connection_endpoints` (connect, rest_operation, read) — List pre-configured connection endpoints.
- `sf_data360` `connect.connection.get` (connect, rest_operation, read) — Get connection details. connectorType REQUIRED.
- `sf_data360` `connect.connection.list` (connect, rest_operation, read) — List connections. connectorType REQUIRED.

## Cross-phase routing

| Phase       | Reference                          | Summary                                                                               |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| Connect     | `references/phases/connect.md`     | Set up and inspect Data 360 source connectivity.                                      |
| Prepare     | `references/phases/prepare.md`     | Prepare raw data structures and ingestion pipelines.                                  |
| Harmonize   | `references/phases/harmonize.md`   | Model, map, and unify data into harmonized entities.                                  |
| Segment     | `references/phases/segment.md`     | Build and inspect audience segments and calculated insights.                          |
| Act         | `references/phases/act.md`         | Deliver audiences and data-triggered actions downstream.                              |
| Retrieve    | `references/phases/retrieve.md`    | Query, search, and inspect Data 360 data and metadata.                                |
| Semantic    | `references/phases/semantic.md`    | Manage semantic models, search indexes, retrievers, and ML/prediction model surfaces. |
| Observe     | `references/phases/observe.md`     | Analyze Agentforce sessions and platform traces in Data 360.                          |
| Orchestrate | `references/phases/orchestrate.md` | Plan and troubleshoot cross-phase Data 360 workflows.                                 |

## Upstream reference fallback

If this generated reference and the local sf-data360 references are insufficient, inspect the official Data 360 API and hosted MCP contracts, then curate findings into the generated `sf_data360` action catalog.
