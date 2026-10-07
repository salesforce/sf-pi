<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Retrieve Reference

Query, search, and inspect Data 360 data and metadata.

## Use this reference when

Data 360 Retrieve phase. Use when running Data 360 SQL, metadata search, profile or data graph queries, semantic queries, retriever inspection, or search-index work with sf-data360 tools.

## Tool discipline

1. Use `sf_data360` with an action in this business namespace.
2. Use `discover.action.search` when the exact action is unclear.
3. Use `discover.action.describe` and `discover.action.example` before complex mutations.
4. Use `dry_run: true` before mutations and review the resolved request.
5. Use `api.request` only as the exact REST escape hatch when no named action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested business actions or orchestrated journeys.

## Phase coverage

- **Metadata** — Discover data spaces, DMO schemas, DLO schemas, and compact catalogs.
- **Profile and Data Graph** — Read profile, insight, and data graph metadata and records.
- **Query** — Run bounded Data 360 SQL and inspect data shape.

- Capabilities: 20 (0 runbook-backed)
- Safety mix: read=17, safe_post=2, confirmed=0, destructive=1

## Data 360 family actions

- `sf_data360` `query.datagraph.lookup` (query, rest_operation, read) — Lookup by natural key.
- `sf_data360` `query.datagraph.metadata` (query, rest_operation, read) — List data graph entities or get schema.
- `sf_data360` `query.datagraph.query` (query, rest_operation, read) — Query data graphs. Set live=true for real-time.
- `sf_data360` `query.insight.metadata_get` (query, rest_operation, read) — Discover one calculated insight metadata definition.
- `sf_data360` `query.insights.metadata` (query, rest_operation, read) — Discover CI names and available dimensions/measures.
- `sf_data360` `query.insights.query` (query, rest_operation, read) — Query calculated insights with dimensions and measures.
- `sf_data360` `query.metadata.entities` (query, rest_operation, read) — List paginated metadata entities. entityType required.
- `sf_data360` `query.metadata.query` (query, rest_operation, read) — Get metadata for entity. ALWAYS use entityName filter.

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
