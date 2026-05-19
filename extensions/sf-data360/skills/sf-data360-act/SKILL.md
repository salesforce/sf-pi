---
name: sf-data360-act
description: Data 360 Act phase. Use when managing activations, activation targets, downstream delivery, data actions, or action targets with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Act

Deliver audiences and data-triggered actions downstream.

## Use this skill when

Data 360 Act phase. Use when managing activations, activation targets, downstream delivery, data actions, or action targets with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching D360 capabilities.
3. Use `d360` action=`examples` with a capability before complex or mutating calls.
4. Use `d360` action=`execute` with that capability and reviewed params.
5. Use `d360_api` only as the raw REST escape hatch when no capability fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested D360 capabilities.

## Phase coverage

- **Activation** — Send audiences downstream through activation targets.
- **DataAction** — Inspect data actions and action targets.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Capabilities: 20 (0 runbook-backed)
- Safety mix: read=10, safe_post=0, confirmed=7, destructive=3

## D360 capabilities

- `d360_activation_get` (rest_operation, read) — Get one activation by id.
- `d360_activation_list` (rest_operation, read) — List activations.
- `d360_activation_target_get` (rest_operation, read) — Get one activation target by id.
- `d360_activation_target_list` (rest_operation, read) — List activation targets.
- `d360_activations_list` (rest_operation, read) — List activations with optional pagination.
- `d360_data_actions_list` (rest_operation, read) — List Data 360 data actions.

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
