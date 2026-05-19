---
name: sf-data360-prepare
description: Data 360 Prepare phase. Use when managing DLOs, data streams, data transforms, data kits, data spaces, ingestion readiness, or raw data preparation with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Prepare

Prepare raw data structures and ingestion pipelines.

## Use this skill when

Data 360 Prepare phase. Use when managing DLOs, data streams, data transforms, data kits, data spaces, ingestion readiness, or raw data preparation with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching operations or runbooks.
3. Use `d360` action=`examples` before complex or mutating operations.
4. Use `d360` action=`execute` for registry-backed operations.
5. Use `d360_api` only as the raw REST escape hatch when the registry is insufficient.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Run dry-run review before confirmed or destructive operations.

## Phase coverage

- **DLO** — Read Data Lake Object catalog and raw lake schemas.
- **DataKit** — Inspect packaged Data 360 data kits and deployment bundles.
- **DataStreams** — Inspect Data 360 ingestion streams.
- **DataTransform** — Inspect SQL-based data transforms and schedules.
- **Dataspace** — Inspect data spaces and data-space membership.
- **Ingestion** — Discover connectors, connections, data streams, and ingestion health surfaces.
- **Transforms and Actions** — Inspect SQL transforms and real-time data actions.

- Operations: 43
- Runbooks: 0
- Safety mix: read=20, safe_post=1, confirmed=16, destructive=6

## Operation map

| Operation                          | Family                 | Safety      | Summary                                                                                             |
| ---------------------------------- | ---------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `d360_datakit_component_deps`      | DataKit                | read        | Get dependencies for one DataKit component.                                                         |
| `d360_datakit_component_status`    | DataKit                | read        | Get component deployment status for one DataKit component.                                          |
| `d360_datakit_components`          | DataKit                | read        | List components for one DataKit.                                                                    |
| `d360_datakit_deploy`              | DataKit                | confirmed   | Deploy or update data kit components.                                                               |
| `d360_datakit_deploy_status`       | DataKit                | read        | Get DataKit deployment job status.                                                                  |
| `d360_datakit_get`                 | DataKit                | read        | Get one DataKit by id.                                                                              |
| `d360_datakit_list`                | DataKit                | read        | List all data kits.                                                                                 |
| `d360_datakit_manifest`            | DataKit                | read        | Get DataKit manifest by id.                                                                         |
| `d360_datakit_undeploy`            | DataKit                | destructive | Undeploy data kit components.                                                                       |
| `d360_datakits_list`               | DataKit                | read        | List available DataKits.                                                                            |
| `d360_dataspace_create`            | Dataspace              | confirmed   | Create a data space.                                                                                |
| `d360_dataspace_delete`            | Dataspace              | destructive | Delete a data space and its contents.                                                               |
| `d360_dataspace_get`               | Dataspace              | read        | Get a data space by name.                                                                           |
| `d360_dataspace_list`              | Dataspace              | read        | List data spaces.                                                                                   |
| `d360_dataspace_member_add`        | Dataspace              | confirmed   | Add members to a data space.                                                                        |
| `d360_dataspace_member_list`       | Dataspace              | read        | List data space members.                                                                            |
| `d360_dataspace_member_remove`     | Dataspace              | destructive | Remove a member from a data space.                                                                  |
| `d360_dataspace_update`            | Dataspace              | confirmed   | Update a data space by name.                                                                        |
| `d360_datastream_create`           | DataStreams            | confirmed   | Create a generic data stream. Connector-specific create operations provide safer payload templates. |
| `d360_datastream_create_aws_s3`    | DataStreams            | confirmed   | Create an AWS S3 data stream payload against /ssot/data-streams.                                    |
| `d360_datastream_create_sfdc`      | DataStreams            | confirmed   | Create a Salesforce CRM data stream payload against /ssot/data-streams.                             |
| `d360_datastream_create_snowflake` | DataStreams            | confirmed   | Create a Snowflake-backed data stream payload against /ssot/data-streams.                           |
| `d360_datastream_delete`           | DataStreams            | destructive | Delete a data stream.                                                                               |
| `d360_datastream_get`              | DataStreams            | read        | Get one data stream configuration.                                                                  |
| `d360_datastream_list`             | DataStreams            | read        | List data streams.                                                                                  |
| `d360_datastream_run`              | DataStreams            | confirmed   | Trigger a manual ingestion run for a data stream.                                                   |
| `d360_datastream_update`           | DataStreams            | confirmed   | Update a data stream by id or name.                                                                 |
| `d360_transform_create`            | DataTransform          | confirmed   | Create a data transform. Schedule runs separately.                                                  |
| `d360_transform_delete`            | DataTransform          | destructive | Delete a data transform.                                                                            |
| `d360_transform_get`               | DataTransform          | read        | Get one data transform.                                                                             |
| `d360_transform_list`              | DataTransform          | read        | List data transforms.                                                                               |
| `d360_transform_run`               | DataTransform          | confirmed   | Run a data transform manually.                                                                      |
| `d360_transform_schedule_get`      | DataTransform          | read        | Get one data transform schedule.                                                                    |
| `d360_transform_schedule_set`      | DataTransform          | confirmed   | Set or update the schedule for a data transform.                                                    |
| `d360_transform_update`            | DataTransform          | confirmed   | Update a data transform by id.                                                                      |
| `d360_transform_validate`          | DataTransform          | safe_post   | Validate Data Transform configuration before create/update.                                         |
| `d360_dlo_create`                  | DLO                    | confirmed   | Create a Data Lake Object.                                                                          |
| `d360_dlo_delete`                  | DLO                    | destructive | Delete a Data Lake Object.                                                                          |
| `d360_dlo_get`                     | DLO                    | read        | Get one Data Lake Object schema.                                                                    |
| `d360_dlo_list`                    | DLO                    | read        | List Data Lake Objects.                                                                             |
| `d360_dlo_update`                  | DLO                    | confirmed   | Update a Data Lake Object by API name.                                                              |
| `d360_data_streams_list`           | Ingestion              | read        | List data streams with optional pagination.                                                         |
| `d360_data_transforms_list`        | Transforms and Actions | read        | List Data 360 SQL/data transforms.                                                                  |

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
