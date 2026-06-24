<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Observe Reference

Analyze Agentforce sessions and platform traces in Data 360.

## Use this reference when

Data 360 Observe phase. Use when analyzing Agentforce STDM sessions, conversation traces, platform tracing spans, trace trees, action failures, or production agent behavior with sf-data360 tools.

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

- Capabilities: 6 (6 runbook-backed)
- Safety mix: read=0, safe_post=0, confirmed=0, destructive=0

## Data 360 family actions

- `data360_observe` `stdm.find_sessions` (runbook, read) — Find recent Agentforce STDM sessions by optional agent API name and time window.
- `data360_observe` `stdm.session_timeline` (runbook, read) — Fetch an STDM conversation timeline for a session id.
- `data360_observe` `trace.error_traces` (runbook, read) — Find recent Agent Platform Tracing ERROR spans.
- `data360_observe` `trace.join_interaction_trace` (runbook, read) — Join one STDM interaction to messages, steps, and Platform Tracing spans.
- `data360_observe` `trace.operation_latency_summary` (runbook, read) — Aggregate Platform Tracing duration by operation name.
- `data360_observe` `trace.trace_tree` (runbook, read) — Fetch and reconstruct a Platform Tracing span tree by trace id.
- `data360_observe` `stdm.session_otel` (local, read) — Export one recent Agentforce session as pre-joined OpenTelemetry JSON.

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
