<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Prepare Reference

Prepare raw data structures and ingestion pipelines.

## Use this reference when

Data 360 Prepare phase. Use when managing DLOs, data streams, data transforms, data kits, data spaces, ingestion readiness, or raw data preparation with sf-data360 tools.

## Tool discipline

1. Use `sf_data360` with an action in this business namespace.
2. Use `discover.action.search` when the exact action is unclear.
3. Use `discover.action.describe` and `discover.action.example` before complex mutations.
4. Use `dry_run: true` before mutations and review the resolved request.
5. Use `api.request` only as the exact REST escape hatch when no named action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested business actions or orchestrated journeys.

## Phase coverage

- **DLO** — Read Data Lake Object catalog and raw lake schemas.
- **Data Custom Code** — Inspect Data 360 custom-code deployments and executions.
- **DataKit** — Inspect packaged Data 360 data kits and deployment bundles.
- **DataStreams** — Inspect Data 360 ingestion streams.
- **DataTransform** — Inspect SQL-based data transforms and schedules.
- **Dataspace** — Inspect data spaces and data-space membership.
- **Document AI** — Inspect Data 360 Document AI processing configuration.
- **Ingestion** — Discover connectors, connections, data streams, and ingestion health surfaces.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Capabilities: 74 (0 runbook-backed)
- Safety mix: read=29, safe_post=3, confirmed=32, destructive=10

## Data 360 family actions

- `sf_data360` `prepare.csv_schema.infer` (prepare, local, read) — Infer an Ingestion API schema from a local CSV file.
- `sf_data360` `prepare.custom_code.execution.get` (prepare, rest_operation, read) — Get custom code execution
- `sf_data360` `prepare.custom_code.execution.list` (prepare, rest_operation, read) — Get custom code executions
- `sf_data360` `prepare.custom_code.get` (prepare, rest_operation, read) — Get custom code deployment
- `sf_data360` `prepare.custom_code.list` (prepare, rest_operation, read) — Get custom code deployments
- `sf_data360` `prepare.datakit_component_deps` (prepare, rest_operation, read) — Get component dependencies.
- `sf_data360` `prepare.datakit_component.status` (prepare, rest_operation, read) — Get component deployment status.
- `sf_data360` `prepare.datakit_components` (prepare, rest_operation, read) — List org components available for inclusion in data kits.

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
