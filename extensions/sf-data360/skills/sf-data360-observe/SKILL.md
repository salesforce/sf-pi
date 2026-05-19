---
name: sf-data360-observe
description: Data 360 Observe phase. Use when analyzing Agentforce STDM sessions, conversation traces, platform tracing spans, trace trees, action failures, or production agent behavior with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Observe

Analyze Agentforce sessions and platform traces in Data 360.

## Use this skill when

Data 360 Observe phase. Use when analyzing Agentforce STDM sessions, conversation traces, platform tracing spans, trace trees, action failures, or production agent behavior with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching operations or runbooks.
3. Use `d360` action=`examples` before complex or mutating operations.
4. Use `d360` action=`execute` for registry-backed operations.
5. Use `d360_api` only as the raw REST escape hatch when the registry is insufficient.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Run dry-run review before confirmed or destructive operations.

## Phase coverage

- Cross-phase orchestration skill. Use the phase map below to route work.

- Operations: 0
- Runbooks: 5
- Safety mix: read=0, safe_post=0, confirmed=0, destructive=0

## Operation map

This orchestration skill does not own direct operation coverage. Route to the phase-specific skill first, then use `d360` or `d360_api`.

## Runbooks

| Runbook                                         | Family              | Summary                                                                   |
| ----------------------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `agent_observability.join_interaction_trace`    | Agent Observability | Join one STDM interaction to messages, steps, and Platform Tracing spans. |
| `agent_observability.operation_latency_summary` | Agent Observability | Aggregate Platform Tracing duration by operation name.                    |
| `agent_observability.platform_error_traces`     | Agent Observability | Find recent Agent Platform Tracing ERROR spans.                           |
| `agent_observability.platform_trace_tree`       | Agent Observability | Fetch and reconstruct a Platform Tracing span tree by trace id.           |
| `agent_observability.stdm_session_timeline`     | Agent Observability | Fetch an STDM conversation timeline for a session id.                     |

## Cross-phase routing

| Phase       | Skill                    | Summary                                                      |
| ----------- | ------------------------ | ------------------------------------------------------------ |
| Connect     | `sf-data360-connect`     | Set up and inspect Data 360 source connectivity.             |
| Prepare     | `sf-data360-prepare`     | Prepare raw data structures and ingestion pipelines.         |
| Harmonize   | `sf-data360-harmonize`   | Model, map, and unify data into harmonized entities.         |
| Segment     | `sf-data360-segment`     | Build and inspect audience segments and calculated insights. |
| Act         | `sf-data360-act`         | Deliver audiences and data-triggered actions downstream.     |
| Retrieve    | `sf-data360-retrieve`    | Query, search, and inspect Data 360 data and metadata.       |
| Observe     | `sf-data360-observe`     | Analyze Agentforce sessions and platform traces in Data 360. |
| Orchestrate | `sf-data360-orchestrate` | Plan and troubleshoot cross-phase Data 360 workflows.        |

## Upstream reference fallback

If this generated skill and the local sf-data360 references are insufficient, inspect the public upstream Data 360 MCP server repository for reference material. Do not run or embed the upstream Java MCP server from this extension.
