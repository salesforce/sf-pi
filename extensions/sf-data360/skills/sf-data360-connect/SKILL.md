---
name: sf-data360-connect
description: Data 360 Connect phase. Use when managing connections, connectors, source systems, source metadata, connection tests, or source endpoints with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Connect

Set up and inspect Data 360 source connectivity.

## Use this skill when

Data 360 Connect phase. Use when managing connections, connectors, source systems, source metadata, connection tests, or source endpoints with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching operations or runbooks.
3. Use `d360` action=`examples` before complex or mutating operations.
4. Use `d360` action=`execute` for registry-backed operations.
5. Use `d360_api` only as the raw REST escape hatch when the registry is insufficient.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Run dry-run review before confirmed or destructive operations.

## Phase coverage

- **Connection** — Inspect connectors, connections, endpoints, and source metadata.
- **Ingestion** — Discover connectors, connections, data streams, and ingestion health surfaces.

- Operations: 13
- Runbooks: 0
- Safety mix: read=8, safe_post=1, confirmed=3, destructive=1

## Operation map

| Operation                          | Family     | Safety      | Summary                                                                    |
| ---------------------------------- | ---------- | ----------- | -------------------------------------------------------------------------- |
| `d360_connection_create`           | Connection | confirmed   | Create a data connection. Test the connection configuration before saving. |
| `d360_connection_create_snowflake` | Connection | confirmed   | Create a Snowflake connection with key-pair authentication.                |
| `d360_connection_delete`           | Connection | destructive | Delete a data connection.                                                  |
| `d360_connection_endpoints`        | Connection | read        | List pre-configured connection endpoints.                                  |
| `d360_connection_get`              | Connection | read        | Get one connection by id.                                                  |
| `d360_connection_list`             | Connection | read        | List connections for a connector type.                                     |
| `d360_connection_test`             | Connection | safe_post   | Test connection configuration without saving it.                           |
| `d360_connection_update`           | Connection | confirmed   | Update a data connection by id.                                            |
| `d360_connector_list`              | Connection | read        | List supported connector types.                                            |
| `d360_connector_metadata`          | Connection | read        | Get connector metadata by connector catalog name.                          |
| `d360_snowflake_connection_list`   | Connection | read        | List Data 360 connections for a connector type, commonly SNOWFLAKE.        |
| `d360_connections_sfdc_list`       | Ingestion  | read        | List Salesforce CRM connections.                                           |
| `d360_connectors_list`             | Ingestion  | read        | List connector catalog entries supported by the org.                       |

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
