---
name: sf-data360-segment
description: Data 360 Segment phase. Use when managing audience segments, segment publish flows, calculated insights, metrics, or segment membership logic with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Segment

Build and inspect audience segments and calculated insights.

## Use this skill when

Data 360 Segment phase. Use when managing audience segments, segment publish flows, calculated insights, metrics, or segment membership logic with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching D360 capabilities.
3. Use `d360` action=`examples` with a capability before complex or mutating calls.
4. Use `d360` action=`execute` with that capability and reviewed params.
5. Use `d360_api` only as the raw REST escape hatch when no capability fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested D360 capabilities.

## Phase coverage

- **Calculated Insights** — Validate, run, and inspect calculated metrics and insights.
- **Segment** — Create, inspect, and publish Data Cloud audience segments.

- Capabilities: 19 (0 runbook-backed)
- Safety mix: read=7, safe_post=1, confirmed=9, destructive=2

## D360 capabilities

- `d360_calculated_insights_list` (rest_operation, read) — List calculated insights.
- `d360_ci_get` (rest_operation, read) — Get one calculated insight by API name.
- `d360_ci_list` (rest_operation, read) — List all calculated insights.
- `d360_ci_run_status` (rest_operation, read) — Get calculated insight run status.
- `d360_segment_get` (rest_operation, read) — Get one segment by id.
- `d360_segment_list` (rest_operation, read) — List all segments.

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
