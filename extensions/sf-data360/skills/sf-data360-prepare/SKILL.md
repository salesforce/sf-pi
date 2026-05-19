---
name: sf-data360-prepare
description: Data 360 Prepare phase. Use when managing DLOs, data streams, data transforms, data kits, data spaces, ingestion readiness, or raw data preparation with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Prepare

Prepare raw data structures and ingestion pipelines.

## Use this skill when

Data 360 Prepare phase. Use when managing DLOs, data streams, data transforms, data kits, data spaces, ingestion readiness, or raw data preparation with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching D360 capabilities.
3. Use `d360` action=`examples` with a capability before complex or mutating calls.
4. Use `d360` action=`execute` with that capability and reviewed params.
5. Use `d360_api` only as the raw REST escape hatch when no capability fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested D360 capabilities.

## Phase coverage

- **DLO** — Read Data Lake Object catalog and raw lake schemas.
- **DataKit** — Inspect packaged Data 360 data kits and deployment bundles.
- **DataStreams** — Inspect Data 360 ingestion streams.
- **DataTransform** — Inspect SQL-based data transforms and schedules.
- **Dataspace** — Inspect data spaces and data-space membership.
- **Ingestion** — Discover connectors, connections, data streams, and ingestion health surfaces.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Capabilities: 43 (0 runbook-backed)
- Safety mix: read=20, safe_post=1, confirmed=16, destructive=6

## D360 capabilities

- `d360_data_streams_list` (rest_operation, read) — List data streams with optional pagination.
- `d360_data_transforms_list` (rest_operation, read) — List Data 360 SQL/data transforms.
- `d360_datakit_component_deps` (rest_operation, read) — Get dependencies for one DataKit component.
- `d360_datakit_component_status` (rest_operation, read) — Get component deployment status for one DataKit component.
- `d360_datakit_components` (rest_operation, read) — List components for one DataKit.
- `d360_datakit_deploy_status` (rest_operation, read) — Get DataKit deployment job status.

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
