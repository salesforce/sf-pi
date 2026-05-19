---
name: sf-data360-retrieve
description: Data 360 Retrieve phase. Use when running Data 360 SQL, metadata search, profile or data graph queries, semantic queries, retriever inspection, or search-index work with sf-data360 tools.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# SF Data 360 — Retrieve

Query, search, and inspect Data 360 data and metadata.

## Use this skill when

Data 360 Retrieve phase. Use when running Data 360 SQL, metadata search, profile or data graph queries, semantic queries, retriever inspection, or search-index work with sf-data360 tools.

## Tool discipline

1. Use `d360_probe` first when org readiness is uncertain.
2. Use `d360` action=`search` to find matching operations or runbooks.
3. Use `d360` action=`examples` before complex or mutating operations.
4. Use `d360` action=`execute` for registry-backed operations.
5. Use `d360_api` only as the raw REST escape hatch when the registry is insufficient.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Run dry-run review before confirmed or destructive operations.

## Phase coverage

- **Metadata** — Discover data spaces, DMO schemas, DLO schemas, and compact catalogs.
- **Profile and Data Graph** — Read profile, insight, and data graph metadata and records.
- **Query** — Run bounded Data 360 SQL and inspect data shape.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.

- Operations: 62
- Runbooks: 0
- Safety mix: read=47, safe_post=5, confirmed=6, destructive=4

## Operation map

| Operation                           | Family                 | Safety      | Summary                                                                 |
| ----------------------------------- | ---------------------- | ----------- | ----------------------------------------------------------------------- |
| `d360_data_spaces_list`             | Metadata               | read        | List Data 360 data spaces.                                              |
| `d360_dlo_describe`                 | Metadata               | read        | Describe one Data Lake Object by API name.                              |
| `d360_dmo_describe`                 | Metadata               | read        | Describe one Data Model Object by API name.                             |
| `d360_metadata_entities`            | Metadata               | read        | List metadata entities by entity type.                                  |
| `d360_metadata_get`                 | Metadata               | read        | Fetch metadata for a specific entity name.                              |
| `d360_metadata_search`              | Metadata               | safe_post   | Search Data 360 metadata using natural language.                        |
| `d360_datagraph_lookup`             | Profile and Data Graph | read        | Lookup data graph records by natural key.                               |
| `d360_datagraph_metadata`           | Profile and Data Graph | read        | List data graph metadata.                                               |
| `d360_datagraph_query`              | Profile and Data Graph | read        | Query data graph records for an entity.                                 |
| `d360_insights_metadata`            | Profile and Data Graph | read        | Discover calculated insight metadata.                                   |
| `d360_insights_metadata_get`        | Profile and Data Graph | read        | Discover one calculated insight metadata definition.                    |
| `d360_insights_query`               | Profile and Data Graph | read        | Query calculated insight rows.                                          |
| `d360_profile_metadata`             | Profile and Data Graph | read        | Discover profile schema.                                                |
| `d360_profile_metadata_model`       | Profile and Data Graph | read        | Discover one profile DMO schema and relationships.                      |
| `d360_profile_query`                | Profile and Data Graph | read        | Query profile records for a data model. Requires profile filter params. |
| `d360_metadata`                     | Query                  | read        | Get metadata for one entity. Prefer entityName filters.                 |
| `d360_query_sql`                    | Query                  | safe_post   | Execute a Data 360 SQL query through /ssot/query-sql.                   |
| `d360_query_sql_cancel`             | Query                  | destructive | Cancel a running SQL query.                                             |
| `d360_query_sql_rows`               | Query                  | read        | Fetch rows for a completed Data 360 SQL query.                          |
| `d360_query_sql_status`             | Query                  | read        | Poll a Data 360 SQL query status.                                       |
| `d360_retriever_config_create`      | Semantic Retrieval     | confirmed   | Create a new retriever configuration version.                           |
| `d360_retriever_config_delete`      | Semantic Retrieval     | destructive | Delete one retriever configuration.                                     |
| `d360_retriever_config_get`         | Semantic Retrieval     | read        | Get a retriever configuration by id or name.                            |
| `d360_retriever_config_list`        | Semantic Retrieval     | read        | List configurations for a retriever.                                    |
| `d360_retriever_config_update`      | Semantic Retrieval     | confirmed   | Update a retriever configuration, such as active status.                |
| `d360_retriever_create`             | Semantic Retrieval     | confirmed   | Create a RAG retriever.                                                 |
| `d360_retriever_delete`             | Semantic Retrieval     | destructive | Delete a RAG retriever and all configurations.                          |
| `d360_retriever_get`                | Semantic Retrieval     | read        | Get one machine-learning retriever by id or name.                       |
| `d360_retriever_list`               | Semantic Retrieval     | read        | List RAG retrievers with optional filters.                              |
| `d360_retriever_update`             | Semantic Retrieval     | confirmed   | Update a RAG retriever label or description.                            |
| `d360_retrievers_list`              | Semantic Retrieval     | read        | List machine-learning retrievers when retriever APIs are provisioned.   |
| `d360_sdm_calc_dim_get`             | Semantic Retrieval     | read        | Get a calculated dimension from a semantic data model.                  |
| `d360_sdm_calc_dims_list`           | Semantic Retrieval     | read        | List calculated dimensions in a semantic data model.                    |
| `d360_sdm_calc_measure_get`         | Semantic Retrieval     | read        | Get a calculated measurement from a semantic data model.                |
| `d360_sdm_calc_measures_list`       | Semantic Retrieval     | read        | List calculated measurements in a semantic data model.                  |
| `d360_sdm_data_object_get`          | Semantic Retrieval     | read        | Get a data object from a semantic data model.                           |
| `d360_sdm_data_objects_list`        | Semantic Retrieval     | read        | List data objects in a semantic data model.                             |
| `d360_sdm_dependencies`             | Semantic Retrieval     | read        | Get dependencies of a semantic data model.                              |
| `d360_sdm_dimensions_list`          | Semantic Retrieval     | read        | List dimensions for a semantic data object.                             |
| `d360_sdm_formula_metadata`         | Semantic Retrieval     | read        | Get supported formula metadata for semantic data models.                |
| `d360_sdm_get`                      | Semantic Retrieval     | read        | Get a semantic data model by API name or id.                            |
| `d360_sdm_list`                     | Semantic Retrieval     | read        | List semantic data models.                                              |
| `d360_sdm_measurements_list`        | Semantic Retrieval     | read        | List measurements for a semantic data object.                           |
| `d360_sdm_metric_get`               | Semantic Retrieval     | read        | Get a metric from a semantic data model.                                |
| `d360_sdm_metrics_list`             | Semantic Retrieval     | read        | List metrics in a semantic data model.                                  |
| `d360_sdm_permissions`              | Semantic Retrieval     | read        | Get semantic data model permissions.                                    |
| `d360_sdm_query`                    | Semantic Retrieval     | safe_post   | Execute a semantic query through the semantic engine gateway.           |
| `d360_sdm_relationship_get`         | Semantic Retrieval     | read        | Get a relationship from a semantic data model.                          |
| `d360_sdm_relationships_list`       | Semantic Retrieval     | read        | List relationships in a semantic data model.                            |
| `d360_sdm_validate`                 | Semantic Retrieval     | safe_post   | Validate a semantic data model.                                         |
| `d360_search_index_config`          | Semantic Retrieval     | read        | Get valid search index configuration options.                           |
| `d360_search_index_create`          | Semantic Retrieval     | confirmed   | Create a semantic search index for RAG/vector search.                   |
| `d360_search_index_delete`          | Semantic Retrieval     | destructive | Delete a search index definition.                                       |
| `d360_search_index_get`             | Semantic Retrieval     | read        | Get one search index by API name or id.                                 |
| `d360_search_index_list`            | Semantic Retrieval     | read        | List search indexes.                                                    |
| `d360_search_index_process_history` | Semantic Retrieval     | read        | Get process run history for a search index.                             |
| `d360_search_index_update`          | Semantic Retrieval     | confirmed   | Update a semantic search index by API name or id.                       |
| `d360_search_indexes_list`          | Semantic Retrieval     | read        | List search indexes when the org exposes the search-index surface.      |
| `d360_semantic_model_get`           | Semantic Retrieval     | read        | Get one semantic data model.                                            |
| `d360_semantic_model_validate`      | Semantic Retrieval     | read        | Validate one semantic data model.                                       |
| `d360_semantic_models_list`         | Semantic Retrieval     | read        | List semantic data models.                                              |
| `d360_semantic_query`               | Semantic Retrieval     | safe_post   | Execute a semantic data model query.                                    |

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
