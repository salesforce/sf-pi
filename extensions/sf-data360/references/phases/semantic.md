<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Semantic Reference

Manage semantic models, search indexes, retrievers, and ML/prediction model surfaces.

## Use this reference when

Data 360 Semantic phase. Use when managing semantic models, search indexes, retrievers, model artifacts, configured models, model setups, prediction jobs, setup versions, or prediction helper actions with sf-data360 tools.

## Tool discipline

1. Use `sf_data360` with an action in this business namespace.
2. Use `discover.action.search` when the exact action is unclear.
3. Use `discover.action.describe` and `discover.action.example` before complex mutations.
4. Use `dry_run: true` before mutations and review the resolved request.
5. Use `api.request` only as the exact REST escape hatch when no named action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested business actions or orchestrated journeys.

## Phase coverage

- **MachineLearning** — Inspect and manage Data 360 machine learning models, prediction jobs, model setups, configured models, alerts, and prediction helpers.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.

- Capabilities: 86 (0 runbook-backed)
- Safety mix: read=45, safe_post=8, confirmed=26, destructive=7

## Data 360 family actions

- `sf_data360` `semantic.ml.configured_model.get` (semantic, rest_operation, read) — Get a configured model by id or developer name.
- `sf_data360` `semantic.ml.configured_model.history.get` (semantic, rest_operation, read) — Get one configured-model history snapshot.
- `sf_data360` `semantic.ml.configured_model.history.list` (semantic, rest_operation, read) — List history snapshots for a configured model.
- `sf_data360` `semantic.ml.configured_model.list` (semantic, rest_operation, read) — List configured models. Filter by assetIdOrName + assetType (ModelArtifact|ModelSetup) to find configured models bound to a specific artifact or setup.
- `sf_data360` `semantic.ml.model_artifact.get` (semantic, rest_operation, read) — Get a trained model artifact. Carries the parameters, inputFields, outputFields, source/setupContainer back-links.
- `sf_data360` `semantic.ml.model_artifact.list` (semantic, rest_operation, read) — List trained model artifacts. Filter by modelType, sourceType, dataCloudOneVisibility.
- `sf_data360` `semantic.ml.model_setup.get` (semantic, rest_operation, read) — Get a model-setup container by id or developer name.
- `sf_data360` `semantic.ml.model_setup.list` (semantic, rest_operation, read) — List model-setup containers. Filters: search, modelType, modelCapability, setupType, connectorType. Pagination via limit/offset.

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
