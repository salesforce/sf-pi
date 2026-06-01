<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Prepare Reference

Prepare raw data structures and ingestion pipelines.

## Use this reference when

Data 360 Prepare phase. Use when managing DLOs, data streams, data transforms, data kits, data spaces, ingestion readiness, or raw data preparation with sf-data360 tools.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- **DLO** — Read Data Lake Object catalog and raw lake schemas.
- **DataKit** — Inspect packaged Data 360 data kits and deployment bundles.
- **DataStreams** — Inspect Data 360 ingestion streams.
- **DataTransform** — Inspect SQL-based data transforms and schedules.
- **Dataspace** — Inspect data spaces and data-space membership.
- **Ingestion** — Discover connectors, connections, data streams, and ingestion health surfaces.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Capabilities: 44 (0 runbook-backed)
- Safety mix: read=20, safe_post=1, confirmed=17, destructive=6

## Data 360 family actions

- `data360_prepare` `csv_schema.infer` (local, read) — Infer an Ingestion API schema from a local CSV file.
- `data360_prepare` `datakit_component_deps` (rest_operation, read) — Get dependencies for one DataKit component.
- `data360_prepare` `datakit_component.status` (rest_operation, read) — Get component deployment status for one DataKit component.
- `data360_prepare` `datakit_components` (rest_operation, read) — List components for one DataKit.
- `data360_prepare` `datakit_deploy.status` (rest_operation, read) — Get DataKit deployment job status.
- `data360_prepare` `datakit.get` (rest_operation, read) — Get one DataKit by id.
- `data360_prepare` `datakit.list` (rest_operation, read) — List all data kits.
- `data360_prepare` `datakit.manifest` (rest_operation, read) — Get DataKit manifest by id.

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
