---
name: sf-data360-retrieve
description: Data 360 Retrieve phase. Use when running Data 360 SQL, metadata search, profile or data graph queries, semantic queries, retriever inspection, or search-index work with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Retrieve

Query, search, and inspect Data 360 data and metadata.

## Use this skill when

Data 360 Retrieve phase. Use when running Data 360 SQL, metadata search, profile or data graph queries, semantic queries, retriever inspection, or search-index work with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching D360 capabilities.
3. Use `d360` action=`examples` with a capability before complex or mutating calls.
4. Use `d360` action=`execute` with that capability and reviewed params.
5. Use `d360_api` only as the raw REST escape hatch when no capability fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested D360 capabilities.

## Phase coverage

- **Metadata** — Discover data spaces, DMO schemas, DLO schemas, and compact catalogs.
- **Profile and Data Graph** — Read profile, insight, and data graph metadata and records.
- **Query** — Run bounded Data 360 SQL and inspect data shape.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.

- Capabilities: 62 (0 runbook-backed)
- Safety mix: read=48, safe_post=4, confirmed=6, destructive=4

## D360 capabilities

- `d360_data_spaces_list` (rest_operation, read) — List Data 360 data spaces.
- `d360_datagraph_lookup` (rest_operation, read) — Lookup data graph records by natural key.
- `d360_datagraph_metadata` (rest_operation, read) — List data graph metadata.
- `d360_datagraph_query` (rest_operation, read) — Query data graph records for an entity.
- `d360_dlo_describe` (rest_operation, read) — Describe one Data Lake Object by API name.
- `d360_dmo_describe` (rest_operation, read) — Describe one Data Model Object by API name.

## Cross-phase routing

| Phase       | Skill                    | Summary                                                      |
| ----------- | ------------------------ | ------------------------------------------------------------ |
| Connect     | `sf-data360-connect`     | Set up and inspect Data 360 source connectivity.             |
| Prepare     | `sf-data360-prepare`     | Prepare raw data structures and ingestion pipelines.         |
| Harmonize   | `sf-data360-harmonize`   | Model, map, and unify data into harmonized entities.         |
| Segment     | `sf-data360-segment`     | Build and inspect audience segments and calculated insights. |
| Act         | `sf-data360-act`         | Deliver audiences and data-triggered actions downstream.     |
| Retrieve    | `sf-data360-retrieve`    | Query, search, and inspect Data 360 data and metadata.       |
| Observe     | `sf-data360-observe`     | Analyze Agentforce sessions and platform traces in Data 360. |
| Orchestrate | `sf-data360-orchestrate` | Plan and troubleshoot cross-phase Data 360 workflows.        |

## Upstream reference fallback

If this generated skill and the local sf-data360 references are insufficient, inspect the public upstream Data 360 MCP server repository for reference material. Do not run or embed the upstream Java MCP server from this extension.
