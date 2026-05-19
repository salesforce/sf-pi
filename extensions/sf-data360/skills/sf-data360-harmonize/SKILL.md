---
name: sf-data360-harmonize
description: Data 360 Harmonize phase. Use when managing DMOs, mappings, standard mappings, identity resolution, smart mapping helpers, or semantic model definitions with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Harmonize

Model, map, and unify data into harmonized entities.

## Use this skill when

Data 360 Harmonize phase. Use when managing DMOs, mappings, standard mappings, identity resolution, smart mapping helpers, or semantic model definitions with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching operations or runbooks.
3. Use `d360` action=`examples` before complex or mutating operations.
4. Use `d360` action=`execute` for registry-backed operations.
5. Use `d360_api` only as the raw REST escape hatch when the registry is insufficient.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Run dry-run review before confirmed or destructive operations.

## Phase coverage

- **DMO** — Read Data Model Object catalog and schemas.
- **Identity Resolution** — Inspect identity resolution rulesets and profile unification setup.
- **Mappings** — Inspect DLO-to-DMO mappings and field mappings.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.
- **Smart** — Local helper algorithms for field matching, mapping suggestions, and data stream payload enhancement.
- **StandardMappings** — Create standard DLO-to-DMO mappings from predefined mapping definitions.

- Operations: 46
- Runbooks: 0
- Safety mix: read=7, safe_post=5, confirmed=24, destructive=10

## Operation map

| Operation                        | Family              | Safety      | Summary                                                                    |
| -------------------------------- | ------------------- | ----------- | -------------------------------------------------------------------------- |
| `d360_dmo_create`                | DMO                 | confirmed   | Create a Data Model Object. Do not include the \_\_dlm suffix in the name. |
| `d360_dmo_delete`                | DMO                 | destructive | Delete a Data Model Object.                                                |
| `d360_dmo_get`                   | DMO                 | read        | Get one Data Model Object schema.                                          |
| `d360_dmo_list`                  | DMO                 | read        | List Data Model Objects.                                                   |
| `d360_dmo_update`                | DMO                 | confirmed   | Update a Data Model Object by API name.                                    |
| `d360_identity_resolutions_list` | Identity Resolution | read        | List identity resolution rulesets.                                         |
| `d360_ir_create`                 | Identity Resolution | confirmed   | Create an identity resolution ruleset.                                     |
| `d360_ir_delete`                 | Identity Resolution | destructive | Delete an identity resolution ruleset.                                     |
| `d360_ir_full_update`            | Identity Resolution | confirmed   | Fully replace an identity resolution ruleset.                              |
| `d360_ir_get`                    | Identity Resolution | read        | Get one identity resolution ruleset by id.                                 |
| `d360_ir_list`                   | Identity Resolution | read        | List identity resolution rulesets.                                         |
| `d360_ir_publish`                | Identity Resolution | confirmed   | Publish an identity resolution ruleset.                                    |
| `d360_ir_run`                    | Identity Resolution | confirmed   | Run identity resolution now.                                               |
| `d360_ir_update`                 | Identity Resolution | confirmed   | Patch an identity resolution ruleset.                                      |
| `d360_dmo_field_mapping_add`     | Mappings            | confirmed   | Add field mappings to an existing DLO-to-DMO object mapping.               |
| `d360_dmo_field_mapping_delete`  | Mappings            | destructive | Delete one field mapping from an object mapping.                           |
| `d360_dmo_mapping_create`        | Mappings            | confirmed   | Create a DLO-to-DMO mapping.                                               |
| `d360_dmo_mapping_delete`        | Mappings            | destructive | Delete a DLO-to-DMO mapping.                                               |
| `d360_dmo_mapping_get`           | Mappings            | read        | Get one DLO-to-DMO mapping configuration.                                  |
| `d360_dmo_mapping_list`          | Mappings            | read        | List DLO-to-DMO mappings. Prefer filtering by DMO or source object.        |
| `d360_dmo_mapping_update`        | Mappings            | confirmed   | Update a DLO-to-DMO mapping by developer name.                             |
| `d360_sdm_calc_dim_create`       | Semantic Retrieval  | confirmed   | Create a calculated dimension in a semantic data model.                    |
| `d360_sdm_calc_dim_delete`       | Semantic Retrieval  | destructive | Delete a calculated dimension from a semantic data model.                  |
| `d360_sdm_calc_dim_update`       | Semantic Retrieval  | confirmed   | Update a calculated dimension in a semantic data model.                    |
| `d360_sdm_calc_measure_create`   | Semantic Retrieval  | confirmed   | Create a calculated measurement in a semantic data model.                  |
| `d360_sdm_calc_measure_delete`   | Semantic Retrieval  | destructive | Delete a calculated measurement from a semantic data model.                |
| `d360_sdm_calc_measure_update`   | Semantic Retrieval  | confirmed   | Update a calculated measurement in a semantic data model.                  |
| `d360_sdm_clone`                 | Semantic Retrieval  | confirmed   | Clone a semantic data model.                                               |
| `d360_sdm_create`                | Semantic Retrieval  | confirmed   | Create a semantic data model shell.                                        |
| `d360_sdm_data_object_create`    | Semantic Retrieval  | confirmed   | Add a data object to a semantic data model.                                |
| `d360_sdm_data_object_delete`    | Semantic Retrieval  | destructive | Delete a data object from a semantic data model.                           |
| `d360_sdm_data_object_update`    | Semantic Retrieval  | confirmed   | Update a data object in a semantic data model.                             |
| `d360_sdm_delete`                | Semantic Retrieval  | destructive | Delete a semantic data model.                                              |
| `d360_sdm_metric_create`         | Semantic Retrieval  | confirmed   | Create a metric in a semantic data model.                                  |
| `d360_sdm_metric_delete`         | Semantic Retrieval  | destructive | Delete a metric from a semantic data model.                                |
| `d360_sdm_metric_update`         | Semantic Retrieval  | confirmed   | Update a metric in a semantic data model.                                  |
| `d360_sdm_relationship_create`   | Semantic Retrieval  | confirmed   | Create a relationship between semantic data objects.                       |
| `d360_sdm_relationship_delete`   | Semantic Retrieval  | destructive | Delete a relationship from a semantic data model.                          |
| `d360_sdm_relationship_update`   | Semantic Retrieval  | confirmed   | Update a relationship in a semantic data model.                            |
| `d360_sdm_update`                | Semantic Retrieval  | confirmed   | Update a semantic data model.                                              |
| `d360_event_date_recommend`      | Smart               | safe_post   | Recommend the best event date field for engagement streams.                |
| `d360_preview_field_matches`     | Smart               | safe_post   | Preview DLO-to-DMO field matches with confidence scores.                   |
| `d360_smart_datastream_create`   | Smart               | safe_post   | Enhance a data stream create body with smart event date selection.         |
| `d360_smart_mapping_suggest`     | Smart               | safe_post   | Suggest DLO-to-DMO field mappings and produce a mapping create payload.    |
| `d360_standard_mapping_create`   | StandardMappings    | confirmed   | Create standard DLO-to-DMO mappings using reviewed mapping payloads.       |
| `d360_standard_mapping_preview`  | StandardMappings    | safe_post   | Preview bundled standard DLO-to-DMO mappings for a source object.          |

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
