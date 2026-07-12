<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Semantic Reference

Manage semantic models, search indexes, retrievers, and ML/prediction model surfaces.

## Use this reference when

Data 360 Semantic phase. Use when managing semantic models, search indexes, retrievers, model artifacts, configured models, model setups, prediction jobs, setup versions, or prediction helper actions with sf-data360 tools.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- **MachineLearning** — Inspect and manage Data 360 machine learning models, prediction jobs, model setups, configured models, alerts, and prediction helpers.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.

- Capabilities: 86 (0 runbook-backed)
- Safety mix: read=45, safe_post=8, confirmed=26, destructive=7

## Data 360 family actions

- `data360_semantic` `ml.configured_model.get` (rest_operation, read) — Get a configured model by id or developer name.
- `data360_semantic` `ml.configured_model.history.get` (rest_operation, read) — Get one configured-model history snapshot.
- `data360_semantic` `ml.configured_model.history.list` (rest_operation, read) — List history snapshots for a configured model.
- `data360_semantic` `ml.configured_model.list` (rest_operation, read) — List configured models. Filter by assetIdOrName + assetType (ModelArtifact|ModelSetup) to find configured models bound to a specific artifact or setup.
- `data360_semantic` `ml.model_artifact.get` (rest_operation, read) — Get a trained model artifact. Carries the parameters, inputFields, outputFields, source/setupContainer back-links.
- `data360_semantic` `ml.model_artifact.list` (rest_operation, read) — List trained model artifacts. Filter by modelType, sourceType, dataCloudOneVisibility.
- `data360_semantic` `ml.model_setup.get` (rest_operation, read) — Get a model-setup container by id or developer name.
- `data360_semantic` `ml.model_setup.list` (rest_operation, read) — List model-setup containers. Filters: search, modelType, modelCapability, setupType, connectorType. Pagination via limit/offset.

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

If this generated reference and the local sf-data360 references are insufficient, inspect the public upstream Data 360 reference repository for operation and payload-shape metadata, then curate findings into Pi-native `data360_*` family actions.
