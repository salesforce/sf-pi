<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Retrieve Reference

Query, search, and inspect Data 360 data and metadata.

## Use this reference when

Data 360 Retrieve phase. Use when running Data 360 SQL, metadata search, profile or data graph queries, semantic queries, retriever inspection, or search-index work with sf-data360 tools.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- **Metadata** — Discover data spaces, DMO schemas, DLO schemas, and compact catalogs.
- **Profile and Data Graph** — Read profile, insight, and data graph metadata and records.
- **Query** — Run bounded Data 360 SQL and inspect data shape.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.

- Capabilities: 63 (0 runbook-backed)
- Safety mix: read=49, safe_post=4, confirmed=6, destructive=4

## Data 360 family actions

- `data360_query` `data_spaces.list` (rest_operation, read) — List Data 360 data spaces.
- `data360_query` `datagraph.lookup` (rest_operation, read) — Lookup data graph records by natural key.
- `data360_query` `datagraph.metadata` (rest_operation, read) — List data graph metadata.
- `data360_query` `datagraph.query` (rest_operation, read) — Query data graph records for an entity.
- `data360_query` `dlo_describe` (rest_operation, read) — Describe one Data Lake Object by API name.
- `data360_query` `dmo_describe` (rest_operation, read) — Describe one Data Model Object by API name.
- `data360_query` `insight.metadata_get` (rest_operation, read) — Discover one calculated insight metadata definition.
- `data360_query` `insights.metadata` (rest_operation, read) — Discover calculated insight metadata.

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
