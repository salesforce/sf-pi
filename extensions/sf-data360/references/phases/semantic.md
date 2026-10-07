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

- **Agent Configuration** — Inspect Data 360 agentic configuration exposed by Connect API.
- **MachineLearning** — Inspect and manage Data 360 machine learning models, prediction jobs, model setups, configured models, alerts, and prediction helpers.
- **Notebook AI** — Inspect knowledge spaces, libraries, research sessions, and Notebook AI configuration.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.

- Capabilities: 132 (0 runbook-backed)
- Safety mix: read=64, safe_post=14, confirmed=40, destructive=14

## Data 360 family actions

- `sf_data360` `semantic.agent_config.get` (semantic, rest_operation, read) — Get agent
- `sf_data360` `semantic.agent_config.list` (semantic, rest_operation, read) — Get agents
- `sf_data360` `semantic.knowledge_space.config.get` (semantic, rest_operation, read) — Get knowledge space configuration
- `sf_data360` `semantic.knowledge_space.config.list` (semantic, rest_operation, read) — Get knowledge space configurations
- `sf_data360` `semantic.knowledge_space.deep_research.status.get` (semantic, rest_operation, read) — Get deep research status
- `sf_data360` `semantic.knowledge_space.details.get` (semantic, rest_operation, read) — Get knowledge space details
- `sf_data360` `semantic.knowledge_space.get` (semantic, rest_operation, read) — Get knowledge space
- `sf_data360` `semantic.knowledge_space.library.details.get` (semantic, rest_operation, read) — Get knowledge library details

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
