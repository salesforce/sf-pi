<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Act Reference

Deliver audiences and data-triggered actions downstream.

## Use this reference when

Data 360 Act phase. Use when managing activations, activation targets, downstream delivery, data actions, or action targets with sf-data360 tools.

## Tool discipline

1. Use `sf_data360` with an action in this business namespace.
2. Use `discover.action.search` when the exact action is unclear.
3. Use `discover.action.describe` and `discover.action.example` before complex mutations.
4. Use `dry_run: true` before mutations and review the resolved request.
5. Use `api.request` only as the exact REST escape hatch when no named action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested business actions or orchestrated journeys.

## Phase coverage

- **Activation** — Send audiences downstream through activation targets.
- **DataAction** — Inspect data actions and action targets.
- **Personalization** — Configure downstream personalization experiences, transformers, schemas, points, mobile previews, and engagement signals.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Capabilities: 42 (0 runbook-backed)
- Safety mix: read=18, safe_post=0, confirmed=16, destructive=8

## Data 360 family actions

- `sf_data360` `activate.activation_target.get` (activate, rest_operation, read) — Get target details.
- `sf_data360` `activate.activation_target.list` (activate, rest_operation, read) — List activation targets.
- `sf_data360` `activate.activation.get` (activate, rest_operation, read) — Get activation details.
- `sf_data360` `activate.activation.list` (activate, rest_operation, read) — List activations.
- `sf_data360` `activate.data_action_target.get` (activate, rest_operation, read) — Get target details.
- `sf_data360` `activate.data_action_target.list` (activate, rest_operation, read) — List action targets.
- `sf_data360` `activate.data_action.get` (activate, rest_operation, read) — Get action details.
- `sf_data360` `activate.data_action.list` (activate, rest_operation, read) — List data actions.

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
