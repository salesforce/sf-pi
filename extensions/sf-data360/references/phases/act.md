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
- **Clean Rooms** — Inspect privacy-safe Data 360 clean-room providers, collaborations, templates, and results.
- **Communication Capping** — Inspect communication-capping configuration, dimensions, rules, and activation targets.
- **DataAction** — Inspect data actions and action targets.
- **Personalization** — Configure downstream personalization experiences, transformers, schemas, points, mobile previews, and engagement signals.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Capabilities: 121 (0 runbook-backed)
- Safety mix: read=57, safe_post=2, confirmed=50, destructive=12

## Data 360 family actions

- `sf_data360` `activate.activation_external_platform.get` (activate, rest_operation, read) — Get activation external platform
- `sf_data360` `activate.activation_external_platform.list` (activate, rest_operation, read) — Get activation external platforms
- `sf_data360` `activate.activation_platform.get` (activate, rest_operation, read) — Get activation platform
- `sf_data360` `activate.activation_platform.list` (activate, rest_operation, read) — Get activation platforms
- `sf_data360` `activate.activation_platform.metadata.action_source.list` (activate, rest_operation, read) — Get action sources for an event
- `sf_data360` `activate.activation_platform.metadata.event.list` (activate, rest_operation, read) — Get events for an activation platform
- `sf_data360` `activate.activation_platform.metadata.partner_object_type.list` (activate, rest_operation, read) — Get partner-object types for an activation platform
- `sf_data360` `activate.activation_target.available_ad_account.list` (activate, rest_operation, read) — Get available ad accounts

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
