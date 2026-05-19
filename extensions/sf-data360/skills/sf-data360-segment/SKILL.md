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
2. Use `d360` action=`search` to find matching operations or runbooks.
3. Use `d360` action=`examples` before complex or mutating operations.
4. Use `d360` action=`execute` for registry-backed operations.
5. Use `d360_api` only as the raw REST escape hatch when the registry is insufficient.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Run dry-run review before confirmed or destructive operations.

## Phase coverage

- **Calculated Insights** — Validate, run, and inspect calculated metrics and insights.
- **Segment** — Create, inspect, and publish Data Cloud audience segments.

- Operations: 19
- Runbooks: 0
- Safety mix: read=7, safe_post=1, confirmed=9, destructive=2

## Operation map

| Operation                       | Family              | Safety      | Summary                                                                   |
| ------------------------------- | ------------------- | ----------- | ------------------------------------------------------------------------- |
| `d360_calculated_insights_list` | Calculated Insights | read        | List calculated insights.                                                 |
| `d360_ci_create`                | Calculated Insights | confirmed   | Create a calculated insight. Validate the payload before create.          |
| `d360_ci_delete`                | Calculated Insights | destructive | Delete a calculated insight.                                              |
| `d360_ci_disable`               | Calculated Insights | confirmed   | Disable a calculated insight.                                             |
| `d360_ci_enable`                | Calculated Insights | confirmed   | Enable a calculated insight.                                              |
| `d360_ci_get`                   | Calculated Insights | read        | Get one calculated insight by API name.                                   |
| `d360_ci_list`                  | Calculated Insights | read        | List all calculated insights.                                             |
| `d360_ci_run`                   | Calculated Insights | confirmed   | Run a calculated insight calculation.                                     |
| `d360_ci_run_status`            | Calculated Insights | read        | Get calculated insight run status.                                        |
| `d360_ci_update`                | Calculated Insights | confirmed   | Update a calculated insight by API name.                                  |
| `d360_ci_validate`              | Calculated Insights | safe_post   | Validate calculated insight SQL before create/update.                     |
| `d360_segment_create`           | Segment             | confirmed   | Create a segment. Validate DMO/CI fields and payload shape before create. |
| `d360_segment_deactivate`       | Segment             | confirmed   | Deactivate a segment by API name.                                         |
| `d360_segment_delete`           | Segment             | destructive | Delete a segment by API name.                                             |
| `d360_segment_get`              | Segment             | read        | Get one segment by id.                                                    |
| `d360_segment_list`             | Segment             | read        | List all segments.                                                        |
| `d360_segment_publish`          | Segment             | confirmed   | Publish/calculate segment membership by id.                               |
| `d360_segment_update`           | Segment             | confirmed   | Update a segment by id.                                                   |
| `d360_segments_list`            | Segment             | read        | List segments with optional pagination.                                   |

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
