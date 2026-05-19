# Data 360 Upstream Parity

This generated report compares the public upstream Data 360 MCP tool catalog to the sf-pi `d360` facade registry.

Generated from upstream snapshot: https://github.com/forcedotcom/d360-mcp-server/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java
Snapshot date: 2026-05-18

## Summary

- Upstream tools: 181
- Supported upstream tools: 181
- Missing upstream tools: 0
- Facade registry operations: 205
- Facade extras / aliases: 24
- Upstream payload examples: 31
- Payload examples covered exactly: 20
- Payload examples covered as variants: 11
- Missing payload examples: 0

### Supported upstream tools by kind

| Kind             | Count |
| ---------------- | ----: |
| rest             |    70 |
| rest_adjusted    |    80 |
| local_helper     |     5 |
| destructive_rest |    26 |

### Supported upstream tools by safety

| Kind        | Count |
| ----------- | ----: |
| read        |    79 |
| safe_post   |    11 |
| confirmed   |    65 |
| destructive |    26 |

### Facade extras by kind

| Kind             | Count |
| ---------------- | ----: |
| alias            |    15 |
| facade_extension |     8 |
| destructive_rest |     1 |

## Missing upstream tools

All upstream tools in the snapshot have an exact facade entry.

## Notes

- `rest_adjusted` means sf-pi intentionally uses the live REST shape implemented by its facade, which can differ from a path string in the upstream catalog snapshot.
- `local_helper` means the operation is deterministic local logic, not a Salesforce REST call.
- `destructive_rest` operations require `target_org: "AgentforceSTDM"`, `allow_confirmed: true`, and an interactive Pi confirmation prompt.
- Facade extras include compatibility aliases and sf-pi-specific convenience entries; this is why facade operation count can exceed upstream tool count.

## Upstream support table

| Upstream tool                     | Family             | Facade kind      | Safety      | Facade operation                  |
| --------------------------------- | ------------------ | ---------------- | ----------- | --------------------------------- |
| d360_query_sql                    | Query              | rest             | safe_post   | d360_query_sql                    |
| d360_query_sql_status             | Query              | rest             | read        | d360_query_sql_status             |
| d360_query_sql_rows               | Query              | rest             | read        | d360_query_sql_rows               |
| d360_query_sql_cancel             | Query              | destructive_rest | destructive | d360_query_sql_cancel             |
| d360_metadata                     | Query              | rest             | read        | d360_metadata                     |
| d360_metadata_search              | Query              | rest             | safe_post   | d360_metadata_search              |
| d360_metadata_entities            | Query              | rest             | read        | d360_metadata_entities            |
| d360_profile_query                | Query              | rest             | read        | d360_profile_query                |
| d360_profile_metadata             | Query              | rest             | read        | d360_profile_metadata             |
| d360_insights_query               | Query              | rest             | read        | d360_insights_query               |
| d360_insights_metadata            | Query              | rest             | read        | d360_insights_metadata            |
| d360_datagraph_query              | Query              | rest_adjusted    | read        | d360_datagraph_query              |
| d360_datagraph_lookup             | Query              | rest             | read        | d360_datagraph_lookup             |
| d360_datagraph_metadata           | Query              | rest             | read        | d360_datagraph_metadata           |
| d360_dmo_list                     | DMO                | rest             | read        | d360_dmo_list                     |
| d360_dmo_get                      | DMO                | rest             | read        | d360_dmo_get                      |
| d360_dmo_create                   | DMO                | rest             | confirmed   | d360_dmo_create                   |
| d360_dmo_update                   | DMO                | rest             | confirmed   | d360_dmo_update                   |
| d360_dmo_delete                   | DMO                | destructive_rest | destructive | d360_dmo_delete                   |
| d360_dlo_list                     | DLO                | rest             | read        | d360_dlo_list                     |
| d360_dlo_get                      | DLO                | rest             | read        | d360_dlo_get                      |
| d360_dlo_create                   | DLO                | rest             | confirmed   | d360_dlo_create                   |
| d360_dlo_update                   | DLO                | rest             | confirmed   | d360_dlo_update                   |
| d360_dlo_delete                   | DLO                | destructive_rest | destructive | d360_dlo_delete                   |
| d360_dmo_mapping_list             | Mappings           | rest             | read        | d360_dmo_mapping_list             |
| d360_dmo_mapping_get              | Mappings           | rest             | read        | d360_dmo_mapping_get              |
| d360_dmo_mapping_create           | Mappings           | rest             | confirmed   | d360_dmo_mapping_create           |
| d360_dmo_mapping_update           | Mappings           | rest             | confirmed   | d360_dmo_mapping_update           |
| d360_dmo_mapping_delete           | Mappings           | destructive_rest | destructive | d360_dmo_mapping_delete           |
| d360_dmo_field_mapping_add        | Mappings           | rest             | confirmed   | d360_dmo_field_mapping_add        |
| d360_dmo_field_mapping_delete     | Mappings           | destructive_rest | destructive | d360_dmo_field_mapping_delete     |
| d360_datastream_list              | DataStreams        | rest             | read        | d360_datastream_list              |
| d360_datastream_get               | DataStreams        | rest_adjusted    | read        | d360_datastream_get               |
| d360_datastream_create            | DataStreams        | rest             | confirmed   | d360_datastream_create            |
| d360_datastream_update            | DataStreams        | rest_adjusted    | confirmed   | d360_datastream_update            |
| d360_datastream_delete            | DataStreams        | destructive_rest | destructive | d360_datastream_delete            |
| d360_datastream_run               | DataStreams        | rest_adjusted    | confirmed   | d360_datastream_run               |
| d360_datastream_create_sfdc       | DataStreams        | rest             | confirmed   | d360_datastream_create_sfdc       |
| d360_datastream_create_aws_s3     | DataStreams        | rest             | confirmed   | d360_datastream_create_aws_s3     |
| d360_datastream_create_snowflake  | DataStreams        | rest             | confirmed   | d360_datastream_create_snowflake  |
| d360_connection_list              | Connection         | rest             | read        | d360_connection_list              |
| d360_connection_get               | Connection         | rest_adjusted    | read        | d360_connection_get               |
| d360_connection_create            | Connection         | rest             | confirmed   | d360_connection_create            |
| d360_connection_update            | Connection         | rest_adjusted    | confirmed   | d360_connection_update            |
| d360_connection_delete            | Connection         | destructive_rest | destructive | d360_connection_delete            |
| d360_connection_test              | Connection         | rest             | safe_post   | d360_connection_test              |
| d360_connector_list               | Connection         | rest             | read        | d360_connector_list               |
| d360_connector_metadata           | Connection         | rest_adjusted    | read        | d360_connector_metadata           |
| d360_connection_endpoints         | Connection         | rest             | read        | d360_connection_endpoints         |
| d360_snowflake_connection_list    | Connection         | rest_adjusted    | read        | d360_snowflake_connection_list    |
| d360_connection_create_snowflake  | Connection         | rest_adjusted    | confirmed   | d360_connection_create_snowflake  |
| d360_segment_list                 | Segment            | rest             | read        | d360_segment_list                 |
| d360_segment_get                  | Segment            | rest_adjusted    | read        | d360_segment_get                  |
| d360_segment_create               | Segment            | rest             | confirmed   | d360_segment_create               |
| d360_segment_update               | Segment            | rest_adjusted    | confirmed   | d360_segment_update               |
| d360_segment_delete               | Segment            | destructive_rest | destructive | d360_segment_delete               |
| d360_segment_publish              | Segment            | rest_adjusted    | confirmed   | d360_segment_publish              |
| d360_segment_deactivate           | Segment            | rest_adjusted    | confirmed   | d360_segment_deactivate           |
| d360_ci_list                      | CalculatedInsights | rest             | read        | d360_ci_list                      |
| d360_ci_get                       | CalculatedInsights | rest             | read        | d360_ci_get                       |
| d360_ci_create                    | CalculatedInsights | rest             | confirmed   | d360_ci_create                    |
| d360_ci_update                    | CalculatedInsights | rest             | confirmed   | d360_ci_update                    |
| d360_ci_delete                    | CalculatedInsights | destructive_rest | destructive | d360_ci_delete                    |
| d360_ci_enable                    | CalculatedInsights | rest             | confirmed   | d360_ci_enable                    |
| d360_ci_disable                   | CalculatedInsights | rest             | confirmed   | d360_ci_disable                   |
| d360_ci_run                       | CalculatedInsights | rest             | confirmed   | d360_ci_run                       |
| d360_ci_run_status                | CalculatedInsights | rest             | read        | d360_ci_run_status                |
| d360_ci_validate                  | CalculatedInsights | rest             | safe_post   | d360_ci_validate                  |
| d360_ir_list                      | IdentityResolution | rest             | read        | d360_ir_list                      |
| d360_ir_get                       | IdentityResolution | rest_adjusted    | read        | d360_ir_get                       |
| d360_ir_create                    | IdentityResolution | rest             | confirmed   | d360_ir_create                    |
| d360_ir_update                    | IdentityResolution | rest_adjusted    | confirmed   | d360_ir_update                    |
| d360_ir_full_update               | IdentityResolution | rest_adjusted    | confirmed   | d360_ir_full_update               |
| d360_ir_delete                    | IdentityResolution | destructive_rest | destructive | d360_ir_delete                    |
| d360_ir_publish                   | IdentityResolution | rest_adjusted    | confirmed   | d360_ir_publish                   |
| d360_ir_run                       | IdentityResolution | rest_adjusted    | confirmed   | d360_ir_run                       |
| d360_activation_list              | Activation         | rest             | read        | d360_activation_list              |
| d360_activation_get               | Activation         | rest_adjusted    | read        | d360_activation_get               |
| d360_activation_create            | Activation         | rest             | confirmed   | d360_activation_create            |
| d360_activation_update            | Activation         | rest_adjusted    | confirmed   | d360_activation_update            |
| d360_activation_delete            | Activation         | destructive_rest | destructive | d360_activation_delete            |
| d360_activation_target_list       | Activation         | rest             | read        | d360_activation_target_list       |
| d360_activation_target_get        | Activation         | rest_adjusted    | read        | d360_activation_target_get        |
| d360_activation_target_create     | Activation         | rest             | confirmed   | d360_activation_target_create     |
| d360_activation_target_update     | Activation         | rest_adjusted    | confirmed   | d360_activation_target_update     |
| d360_activation_target_delete     | Activation         | destructive_rest | destructive | d360_activation_target_delete     |
| d360_dataspace_list               | Dataspace          | rest             | read        | d360_dataspace_list               |
| d360_dataspace_get                | Dataspace          | rest_adjusted    | read        | d360_dataspace_get                |
| d360_dataspace_create             | Dataspace          | rest             | confirmed   | d360_dataspace_create             |
| d360_dataspace_update             | Dataspace          | rest_adjusted    | confirmed   | d360_dataspace_update             |
| d360_dataspace_delete             | Dataspace          | destructive_rest | destructive | d360_dataspace_delete             |
| d360_dataspace_member_list        | Dataspace          | rest_adjusted    | read        | d360_dataspace_member_list        |
| d360_dataspace_member_add         | Dataspace          | rest_adjusted    | confirmed   | d360_dataspace_member_add         |
| d360_dataspace_member_remove      | Dataspace          | destructive_rest | destructive | d360_dataspace_member_remove      |
| d360_transform_list               | DataTransform      | rest             | read        | d360_transform_list               |
| d360_transform_get                | DataTransform      | rest_adjusted    | read        | d360_transform_get                |
| d360_transform_create             | DataTransform      | rest             | confirmed   | d360_transform_create             |
| d360_transform_update             | DataTransform      | rest_adjusted    | confirmed   | d360_transform_update             |
| d360_transform_delete             | DataTransform      | destructive_rest | destructive | d360_transform_delete             |
| d360_transform_run                | DataTransform      | rest_adjusted    | confirmed   | d360_transform_run                |
| d360_transform_validate           | DataTransform      | rest             | safe_post   | d360_transform_validate           |
| d360_transform_schedule_get       | DataTransform      | rest_adjusted    | read        | d360_transform_schedule_get       |
| d360_transform_schedule_set       | DataTransform      | rest_adjusted    | confirmed   | d360_transform_schedule_set       |
| d360_datakit_list                 | DataKit            | rest             | read        | d360_datakit_list                 |
| d360_datakit_get                  | DataKit            | rest_adjusted    | read        | d360_datakit_get                  |
| d360_datakit_manifest             | DataKit            | rest_adjusted    | read        | d360_datakit_manifest             |
| d360_datakit_deploy               | DataKit            | rest             | confirmed   | d360_datakit_deploy               |
| d360_datakit_undeploy             | DataKit            | destructive_rest | destructive | d360_datakit_undeploy             |
| d360_datakit_deploy_status        | DataKit            | rest             | read        | d360_datakit_deploy_status        |
| d360_datakit_component_status     | DataKit            | rest_adjusted    | read        | d360_datakit_component_status     |
| d360_datakit_component_deps       | DataKit            | rest_adjusted    | read        | d360_datakit_component_deps       |
| d360_datakit_components           | DataKit            | rest_adjusted    | read        | d360_datakit_components           |
| d360_dataaction_list              | DataAction         | rest             | read        | d360_dataaction_list              |
| d360_dataaction_get               | DataAction         | rest_adjusted    | read        | d360_dataaction_get               |
| d360_dataaction_create            | DataAction         | rest             | confirmed   | d360_dataaction_create            |
| d360_dataaction_target_list       | DataAction         | rest             | read        | d360_dataaction_target_list       |
| d360_dataaction_target_get        | DataAction         | rest_adjusted    | read        | d360_dataaction_target_get        |
| d360_dataaction_target_create     | DataAction         | rest             | confirmed   | d360_dataaction_target_create     |
| d360_dataaction_target_update     | DataAction         | rest_adjusted    | confirmed   | d360_dataaction_target_update     |
| d360_dataaction_target_delete     | DataAction         | destructive_rest | destructive | d360_dataaction_target_delete     |
| d360_sdm_list                     | SDM                | rest             | read        | d360_sdm_list                     |
| d360_sdm_get                      | SDM                | rest_adjusted    | read        | d360_sdm_get                      |
| d360_sdm_create                   | SDM                | rest             | confirmed   | d360_sdm_create                   |
| d360_sdm_update                   | SDM                | rest_adjusted    | confirmed   | d360_sdm_update                   |
| d360_sdm_delete                   | SDM                | destructive_rest | destructive | d360_sdm_delete                   |
| d360_sdm_clone                    | SDM                | rest_adjusted    | confirmed   | d360_sdm_clone                    |
| d360_sdm_validate                 | SDM                | rest_adjusted    | read        | d360_sdm_validate                 |
| d360_sdm_dependencies             | SDM                | rest_adjusted    | read        | d360_sdm_dependencies             |
| d360_sdm_data_object_create       | SDM                | rest_adjusted    | confirmed   | d360_sdm_data_object_create       |
| d360_sdm_data_objects_list        | SDM                | rest_adjusted    | read        | d360_sdm_data_objects_list        |
| d360_sdm_data_object_get          | SDM                | rest_adjusted    | read        | d360_sdm_data_object_get          |
| d360_sdm_data_object_update       | SDM                | rest_adjusted    | confirmed   | d360_sdm_data_object_update       |
| d360_sdm_data_object_delete       | SDM                | destructive_rest | destructive | d360_sdm_data_object_delete       |
| d360_sdm_dimensions_list          | SDM                | rest_adjusted    | read        | d360_sdm_dimensions_list          |
| d360_sdm_measurements_list        | SDM                | rest_adjusted    | read        | d360_sdm_measurements_list        |
| d360_sdm_calc_dims_list           | SDM                | rest_adjusted    | read        | d360_sdm_calc_dims_list           |
| d360_sdm_calc_dim_create          | SDM                | rest_adjusted    | confirmed   | d360_sdm_calc_dim_create          |
| d360_sdm_calc_dim_get             | SDM                | rest_adjusted    | read        | d360_sdm_calc_dim_get             |
| d360_sdm_calc_dim_update          | SDM                | rest_adjusted    | confirmed   | d360_sdm_calc_dim_update          |
| d360_sdm_calc_dim_delete          | SDM                | destructive_rest | destructive | d360_sdm_calc_dim_delete          |
| d360_sdm_calc_measures_list       | SDM                | rest_adjusted    | read        | d360_sdm_calc_measures_list       |
| d360_sdm_calc_measure_create      | SDM                | rest_adjusted    | confirmed   | d360_sdm_calc_measure_create      |
| d360_sdm_calc_measure_get         | SDM                | rest_adjusted    | read        | d360_sdm_calc_measure_get         |
| d360_sdm_calc_measure_update      | SDM                | rest_adjusted    | confirmed   | d360_sdm_calc_measure_update      |
| d360_sdm_calc_measure_delete      | SDM                | destructive_rest | destructive | d360_sdm_calc_measure_delete      |
| d360_sdm_metrics_list             | SDM                | rest_adjusted    | read        | d360_sdm_metrics_list             |
| d360_sdm_metric_create            | SDM                | rest_adjusted    | confirmed   | d360_sdm_metric_create            |
| d360_sdm_metric_get               | SDM                | rest_adjusted    | read        | d360_sdm_metric_get               |
| d360_sdm_metric_update            | SDM                | rest_adjusted    | confirmed   | d360_sdm_metric_update            |
| d360_sdm_metric_delete            | SDM                | destructive_rest | destructive | d360_sdm_metric_delete            |
| d360_sdm_relationships_list       | SDM                | rest_adjusted    | read        | d360_sdm_relationships_list       |
| d360_sdm_relationship_create      | SDM                | rest_adjusted    | confirmed   | d360_sdm_relationship_create      |
| d360_sdm_relationship_get         | SDM                | rest_adjusted    | read        | d360_sdm_relationship_get         |
| d360_sdm_relationship_update      | SDM                | rest_adjusted    | confirmed   | d360_sdm_relationship_update      |
| d360_sdm_relationship_delete      | SDM                | destructive_rest | destructive | d360_sdm_relationship_delete      |
| d360_sdm_formula_metadata         | SDM                | rest             | read        | d360_sdm_formula_metadata         |
| d360_sdm_permissions              | SDM                | rest             | read        | d360_sdm_permissions              |
| d360_sdm_query                    | SDM                | rest             | safe_post   | d360_sdm_query                    |
| d360_smart_mapping_suggest        | Smart              | local_helper     | safe_post   | d360_smart_mapping_suggest        |
| d360_preview_field_matches        | Smart              | local_helper     | safe_post   | d360_preview_field_matches        |
| d360_smart_datastream_create      | Smart              | local_helper     | safe_post   | d360_smart_datastream_create      |
| d360_event_date_recommend         | Smart              | local_helper     | safe_post   | d360_event_date_recommend         |
| d360_standard_mapping_preview     | StandardMappings   | local_helper     | safe_post   | d360_standard_mapping_preview     |
| d360_standard_mapping_create      | StandardMappings   | rest             | confirmed   | d360_standard_mapping_create      |
| d360_search_index_list            | SearchIndex        | rest_adjusted    | read        | d360_search_index_list            |
| d360_search_index_get             | SearchIndex        | rest_adjusted    | read        | d360_search_index_get             |
| d360_search_index_create          | SearchIndex        | rest_adjusted    | confirmed   | d360_search_index_create          |
| d360_search_index_update          | SearchIndex        | rest_adjusted    | confirmed   | d360_search_index_update          |
| d360_search_index_delete          | SearchIndex        | destructive_rest | destructive | d360_search_index_delete          |
| d360_search_index_config          | SearchIndex        | rest_adjusted    | read        | d360_search_index_config          |
| d360_search_index_process_history | SearchIndex        | rest_adjusted    | read        | d360_search_index_process_history |
| d360_retriever_list               | Retriever          | rest_adjusted    | read        | d360_retriever_list               |
| d360_retriever_get                | Retriever          | rest_adjusted    | read        | d360_retriever_get                |
| d360_retriever_create             | Retriever          | rest_adjusted    | confirmed   | d360_retriever_create             |
| d360_retriever_update             | Retriever          | rest_adjusted    | confirmed   | d360_retriever_update             |
| d360_retriever_delete             | Retriever          | destructive_rest | destructive | d360_retriever_delete             |
| d360_retriever_config_list        | Retriever          | rest_adjusted    | read        | d360_retriever_config_list        |
| d360_retriever_config_get         | Retriever          | rest_adjusted    | read        | d360_retriever_config_get         |
| d360_retriever_config_create      | Retriever          | rest_adjusted    | confirmed   | d360_retriever_config_create      |
| d360_retriever_config_update      | Retriever          | rest_adjusted    | confirmed   | d360_retriever_config_update      |
| d360_retriever_config_delete      | Retriever          | destructive_rest | destructive | d360_retriever_config_delete      |
