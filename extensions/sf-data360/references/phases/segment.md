<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Segment Reference

Build and inspect audience segments and calculated insights.

## Use this reference when

Data 360 Segment phase. Use when managing audience segments, segment publish flows, calculated insights, metrics, or segment membership logic with sf-data360 tools.

## Tool discipline

1. Use `sf_data360` with an action in this business namespace.
2. Use `discover.action.search` when the exact action is unclear.
3. Use `discover.action.describe` and `discover.action.example` before complex mutations.
4. Use `dry_run: true` before mutations and review the resolved request.
5. Use `api.request` only as the exact REST escape hatch when no named action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested business actions or orchestrated journeys.

## Phase coverage

- **Calculated Insights** — Validate, run, and inspect calculated metrics and insights.
- **Segment** — Create, inspect, and publish Data Cloud audience segments.

- Capabilities: 19 (0 runbook-backed)
- Safety mix: read=6, safe_post=2, confirmed=9, destructive=2

## Data 360 family actions

- `sf_data360` `segment.ci.get` (segment, rest_operation, read) — Get CI details.
- `sf_data360` `segment.ci.list` (segment, rest_operation, read) — List all CIs. Check status for ACTIVE.
- `sf_data360` `segment.get` (segment, rest_operation, read) — Get segment by record ID or API name. Check segmentStatus for ACTIVE.
- `sf_data360` `segment.list` (segment, rest_operation, read) — List all segments.
- `sf_data360` `segment.ci.run.status` (segment, rest_operation, safe_post) — Get CI run status.
- `sf_data360` `segment.ci.validate` (segment, rest_operation, safe_post) — Validate CI before creation.
- `sf_data360` `segment.ci.create` (segment, rest_operation, confirmed) — Create CI. apiName must end with __cio. No COUNT(DISTINCT).
- `sf_data360` `segment.ci.delete` (segment, rest_operation, destructive) — Delete CI. Breaks dependent segments.

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
