<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Act Reference

Deliver audiences and data-triggered actions downstream.

## Use this reference when

Data 360 Act phase. Use when managing activations, activation targets, downstream delivery, data actions, or action targets with sf-data360 tools.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- **Activation** — Send audiences downstream through activation targets.
- **DataAction** — Inspect data actions and action targets.
- **Personalization** — Configure downstream personalization experiences, transformers, schemas, points, mobile previews, and engagement signals.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Capabilities: 42 (0 runbook-backed)
- Safety mix: read=18, safe_post=0, confirmed=16, destructive=8

## Data 360 family actions

- `data360_activate` `activation_target.get` (rest_operation, read) — Get target details.
- `data360_activate` `activation_target.list` (rest_operation, read) — List activation targets.
- `data360_activate` `activation.get` (rest_operation, read) — Get activation details.
- `data360_activate` `activation.list` (rest_operation, read) — List activations with optional pagination.
- `data360_activate` `activation.list.compat` (rest_operation, read) — List activations.
- `data360_activate` `data_action_target.get` (rest_operation, read) — Get target details.
- `data360_activate` `data_action_target.list` (rest_operation, read) — List action targets.
- `data360_activate` `data_action.get` (rest_operation, read) — Get action details.

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
