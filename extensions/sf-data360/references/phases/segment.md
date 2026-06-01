<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Segment Reference

Build and inspect audience segments and calculated insights.

## Use this reference when

Data 360 Segment phase. Use when managing audience segments, segment publish flows, calculated insights, metrics, or segment membership logic with sf-data360 tools.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- **Calculated Insights** — Validate, run, and inspect calculated metrics and insights.
- **Segment** — Create, inspect, and publish Data Cloud audience segments.

- Capabilities: 19 (0 runbook-backed)
- Safety mix: read=7, safe_post=1, confirmed=9, destructive=2

## Data 360 family actions

- `data360_segment` `ci_run.status` (rest_operation, read) — Get calculated insight run status.
- `data360_segment` `ci.get` (rest_operation, read) — Get one calculated insight by API name.
- `data360_segment` `ci.list` (rest_operation, read) — List calculated insights.
- `data360_segment` `ci.list.ci_list` (rest_operation, read) — List all calculated insights.
- `data360_segment` `segment.get` (rest_operation, read) — Get one segment by id.
- `data360_segment` `segment.list` (rest_operation, read) — List segments with optional pagination.
- `data360_segment` `segment.list.segment_list` (rest_operation, read) — List all segments.
- `data360_segment` `ci.validate` (rest_operation, safe_post) — Validate calculated insight SQL before create/update.

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
