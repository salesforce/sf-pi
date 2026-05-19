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
2. Use `d360` action=`search` to find matching operations or runbooks.
3. Use `d360` action=`examples` before complex or mutating operations.
4. Use `d360` action=`execute` for registry-backed operations.
5. Use `d360_api` only as the raw REST escape hatch when the registry is insufficient.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Run dry-run review before confirmed or destructive operations.

## Phase coverage

- **Activation** — Send audiences downstream through activation targets.
- **DataAction** — Inspect data actions and action targets.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Operations: 20
- Runbooks: 0
- Safety mix: read=10, safe_post=0, confirmed=7, destructive=3

## Operation map

| Operation                       | Family                 | Safety      | Summary                                                                           |
| ------------------------------- | ---------------------- | ----------- | --------------------------------------------------------------------------------- |
| `d360_activation_create`        | Activation             | confirmed   | Create an activation. Requires an active segment and an activation target.        |
| `d360_activation_delete`        | Activation             | destructive | Delete an activation.                                                             |
| `d360_activation_get`           | Activation             | read        | Get one activation by id.                                                         |
| `d360_activation_list`          | Activation             | read        | List activations.                                                                 |
| `d360_activation_target_create` | Activation             | confirmed   | Create an activation target. Must reference a valid destination/connection shape. |
| `d360_activation_target_delete` | Activation             | destructive | Delete an activation target.                                                      |
| `d360_activation_target_get`    | Activation             | read        | Get one activation target by id.                                                  |
| `d360_activation_target_list`   | Activation             | read        | List activation targets.                                                          |
| `d360_activation_target_update` | Activation             | confirmed   | Update an activation target by id.                                                |
| `d360_activation_update`        | Activation             | confirmed   | Update an activation by id.                                                       |
| `d360_activations_list`         | Activation             | read        | List activations with optional pagination.                                        |
| `d360_dataaction_create`        | DataAction             | confirmed   | Create a data action. Requires a configured data action target.                   |
| `d360_dataaction_get`           | DataAction             | read        | Get one data action.                                                              |
| `d360_dataaction_list`          | DataAction             | read        | List data actions.                                                                |
| `d360_dataaction_target_create` | DataAction             | confirmed   | Create a data action target for event-triggered payload delivery.                 |
| `d360_dataaction_target_delete` | DataAction             | destructive | Delete a data action target.                                                      |
| `d360_dataaction_target_get`    | DataAction             | read        | Get one data action target.                                                       |
| `d360_dataaction_target_list`   | DataAction             | read        | List data action targets.                                                         |
| `d360_dataaction_target_update` | DataAction             | confirmed   | Update a data action target by id.                                                |
| `d360_data_actions_list`        | Transforms and Actions | read        | List Data 360 data actions.                                                       |

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
