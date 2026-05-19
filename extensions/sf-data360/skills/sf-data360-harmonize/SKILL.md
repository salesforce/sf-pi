---
name: sf-data360-harmonize
description: Data 360 Harmonize phase. Use when managing DMOs, mappings, standard mappings, identity resolution, smart mapping helpers, or semantic model definitions with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Harmonize

Model, map, and unify data into harmonized entities.

## Use this skill when

Data 360 Harmonize phase. Use when managing DMOs, mappings, standard mappings, identity resolution, smart mapping helpers, or semantic model definitions with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching D360 capabilities.
3. Use `d360` action=`examples` with a capability before complex or mutating calls.
4. Use `d360` action=`execute` with that capability and reviewed params.
5. Use `d360_api` only as the raw REST escape hatch when no capability fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested D360 capabilities.

## Phase coverage

- **DMO** — Read Data Model Object catalog and schemas.
- **Identity Resolution** — Inspect identity resolution rulesets and profile unification setup.
- **Mappings** — Inspect DLO-to-DMO mappings and field mappings.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.
- **Smart** — Local helper algorithms for field matching, mapping suggestions, and data stream payload enhancement.
- **StandardMappings** — Create standard DLO-to-DMO mappings from predefined mapping definitions.

- Capabilities: 46 (0 runbook-backed)
- Safety mix: read=7, safe_post=5, confirmed=24, destructive=10

## D360 capabilities

- `d360_dmo_get` (rest_operation, read) — Get one Data Model Object schema.
- `d360_dmo_list` (rest_operation, read) — List Data Model Objects.
- `d360_dmo_mapping_get` (rest_operation, read) — Get one DLO-to-DMO mapping configuration.
- `d360_dmo_mapping_list` (rest_operation, read) — List DLO-to-DMO mappings. Prefer filtering by DMO or source object.
- `d360_identity_resolutions_list` (rest_operation, read) — List identity resolution rulesets.
- `d360_ir_get` (rest_operation, read) — Get one identity resolution ruleset by id.

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
