<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Orchestrate Reference

Plan and troubleshoot cross-phase Data 360 workflows.

## Use this reference when

Data 360 Orchestrate phase. Use for cross-phase Data 360 planning, pipeline setup, readiness triage, or troubleshooting that spans multiple sf-data360 phases.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- Cross-phase orchestration reference. Use the phase map below to route work.

- Capabilities: 0 (0 runbook-backed)
- Safety mix: read=0, safe_post=0, confirmed=0, destructive=0

## Data 360 family actions

- `data360_orchestrate` `activate_segment.plan` (journey, read) — Plan activation target and activation creation steps without mutation.
- `data360_orchestrate` `agent_behavior_investigation.plan` (journey, read) — Plan Agentforce STDM and platform tracing queries for an agent/session investigation.
- `data360_orchestrate` `agent_behavior_investigation.run` (journey, read) — Run read-only Agentforce STDM and platform tracing investigation actions and summarize findings.
- `data360_orchestrate` `build_segment.plan` (journey, read) — Plan calculated insight and segment creation/publish steps without mutation.
- `data360_orchestrate` `cleanup.discover_owned` (journey, read) — Discover explicit cleanup candidates by safe prefixes and produce cleanup.plan parameters without deleting anything.
- `data360_orchestrate` `cleanup.plan` (journey, read) — Plan cleanup of explicitly owned Data 360 resources.
- `data360_orchestrate` `ingest_csv.plan` (journey, read) — Plan Route A local CSV ingestion through Ingestion API source schema, data stream, tenant ingest job, and SQL verification.
- `data360_orchestrate` `intent.plan` (journey, read) — Route a natural-language Data 360 user utterance to a recommended journey and next action.

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
