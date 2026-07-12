# Data 360 Upstream Parity

This generated report compares the public upstream Data 360 reference catalog to the sf-pi `d360` facade registry.

Generated from upstream snapshot: https://github.com/forcedotcom/d360-mcp-server/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java
Snapshot date: 2026-07-02

## Summary

- Upstream tools: 246
- Supported upstream tools: 246
- Missing upstream tools: 0
- Facade registry operations: 279
- Facade extras / aliases: 33
- Upstream payload examples: 89
- Payload examples covered exactly: 74
- Payload examples covered as variants: 15
- Missing payload examples: 0

### Supported upstream tools by kind

| Kind             | Count |
| ---------------- | ----: |
| rest             |   209 |
| local_helper     |     5 |
| destructive_rest |    32 |

### Supported upstream tools by safety

| Kind        | Count |
| ----------- | ----: |
| read        |    98 |
| safe_post   |    22 |
| confirmed   |    94 |
| destructive |    32 |

### Facade extras by kind

| Kind             | Count |
| ---------------- | ----: |
| alias            |    16 |
| facade_extension |    14 |
| destructive_rest |     3 |

## Missing upstream tools

All upstream tools in the snapshot have an exact facade entry.

## Changed or adjusted REST shapes

No upstream-supported operations currently use adjusted REST shapes.

## Local compatibility / extension entries

| Facade operation                  | Family                 | Kind             | Safety      |
| --------------------------------- | ---------------------- | ---------------- | ----------- |
| d360_data_spaces_list             | Metadata               | alias            | read        |
| d360_dmo_describe                 | Metadata               | alias            | read        |
| d360_dlo_describe                 | Metadata               | alias            | read        |
| d360_segments_list                | Segment                | alias            | read        |
| d360_activations_list             | Activation             | alias            | read        |
| d360_calculated_insights_list     | Calculated Insights    | alias            | read        |
| d360_connectors_list              | Ingestion              | alias            | read        |
| d360_connections_sfdc_list        | Ingestion              | facade_extension | read        |
| d360_data_streams_list            | Ingestion              | alias            | read        |
| d360_data_transforms_list         | Transforms and Actions | alias            | read        |
| d360_data_actions_list            | Transforms and Actions | alias            | read        |
| d360_identity_resolutions_list    | Identity Resolution    | alias            | read        |
| d360_semantic_models_list         | Semantic Retrieval     | alias            | read        |
| d360_search_indexes_list          | Semantic Retrieval     | alias            | read        |
| d360_retrievers_list              | Semantic Retrieval     | alias            | read        |
| d360_datakits_list                | DataKit                | alias            | read        |
| d360_metadata_get                 | Metadata               | facade_extension | read        |
| d360_model_artifact_list          | Semantic Retrieval     | facade_extension | read        |
| d360_connection_endpoints         | Connection             | facade_extension | read        |
| d360_dataaction_delete            | DataAction             | destructive_rest | destructive |
| d360_semantic_model_get           | Semantic Retrieval     | facade_extension | read        |
| d360_semantic_model_validate      | Semantic Retrieval     | facade_extension | read        |
| d360_profile_metadata_model       | Profile and Data Graph | facade_extension | read        |
| d360_insights_metadata_get        | Profile and Data Graph | facade_extension | read        |
| d360_semantic_query               | Semantic Retrieval     | facade_extension | safe_post   |
| d360_dmo_mapping_update           | Mappings               | facade_extension | confirmed   |
| d360_activation_target_delete     | Activation             | destructive_rest | destructive |
| d360_dataspace_delete             | Dataspace              | destructive_rest | destructive |
| d360_ingest_api_connections_list  | Connection             | alias            | read        |
| d360_ingest_api_schema_get        | Connection             | facade_extension | read        |
| d360_ingest_api_schema_test       | Connection             | facade_extension | safe_post   |
| d360_ingest_api_schema_put        | Connection             | facade_extension | confirmed   |
| d360_datastream_create_ingest_api | DataStreams            | facade_extension | confirmed   |

## Notes

- `rest_adjusted` means sf-pi intentionally uses a REST shape that differs from the imported upstream catalog snapshot. Review adjusted entries before assuming upstream parity.
- `local_helper` means the operation is deterministic local logic, not a Salesforce REST call.
- `destructive_rest` operations require dry-run review, `allow_confirmed: true`, and Guardrail mediation before execution.
- Facade extras include compatibility aliases and sf-pi-specific convenience entries; this is why facade operation count can exceed upstream tool count.
- Full operation-level detail is stored in `extensions/sf-data360/registry/upstream-parity.json`.
