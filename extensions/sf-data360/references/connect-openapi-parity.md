# SF Data 360 Connect OpenAPI Parity

This generated report compares the official Data 360 Connect OpenAPI contract with endpoint-backed actions exposed through the single `sf_data360` tool. Query API V3, tenant Ingestion API, local helpers, and journeys are outside this Connect contract.

- Source: https://developer.salesforce.com/static/datacloud/connectapi/spec/cdp-connect-api-Swagger.yaml
- OpenAPI: 3.0.0
- Connect API version: 68.0
- SHA-256: `33ab2dc6080a98507139e204c7f390e7b97226a31d9ea1a60e58ff63cd485fa9`
- OpenAPI operations: 414
- Matched OpenAPI operations: 414
- OpenAPI-only operations: 0
- SDK endpoint actions: 527
- Matched SDK actions: 435
- SDK-only actions: 94
- Method mismatches: 0
- OpenAPI operations sharing a path with other SDK methods: 0
- SDK actions sharing a path with other OpenAPI methods: 7
- Exact parameter actions: 330
- Adjusted parameter actions: 73
- SDK-stricter parameter actions: 32
- Parameter-drift actions: 0

## Promotion waves

| Wave                            | Scope                                                          | Total | Promoted | Remaining |
| ------------------------------- | -------------------------------------------------------------- | ----: | -------: | --------: |
| wave1_activation_metadata_reads | Activation metadata reads without required fixture identifiers |     3 |        3 |         0 |
| wave2_existing_family_reads     | Remaining reads in existing SDK product families               |    39 |       39 |         0 |
| wave3_new_family_reads          | Reads in new Connect product families                          |    66 |       66 |         0 |
| wave4_post_operations           | POST operations after safety and fixture review                |   112 |      112 |         0 |
| wave5_update_operations         | PATCH and PUT operations with owned fixtures                   |    22 |       22 |         0 |
| wave6_destructive_operations    | DELETE operations with exact ownership and cleanup proof       |    26 |       26 |         0 |

## OpenAPI-only product families

| Product family | Total | Read | Action/create | Update | Destructive |
| -------------- | ----: | ---: | ------------: | -----: | ----------: |

## OpenAPI-only operations

None.

## Path-method overlaps

These are distinct operations that share a resource path; they are not method mismatches.

None.

- SDK `PATCH /ssot/data-action-targets/{dataActionTargetId}`; OpenAPI methods at path: DELETE, GET
- SDK `PATCH /ssot/data-model-object-mappings/{mappingName}/field-mappings`; OpenAPI methods at path: DELETE
- SDK `DELETE /ssot/data-model-object-mappings/{mappingName}/field-mappings/{fieldMappingName}`; OpenAPI methods at path: PATCH
- SDK `PATCH /ssot/data-model-object-mappings/{mappingName}`; OpenAPI methods at path: DELETE, GET
- SDK `GET /ssot/data-kits/{dataKitId}`; OpenAPI methods at path: DELETE, PATCH, POST
- SDK `POST /ssot/machine-learning/configured-models`; OpenAPI methods at path: GET
- SDK `POST /ssot/machine-learning/jobs`; OpenAPI methods at path: GET

## SDK-only Connect endpoints

- `PATCH /ssot/data-action-targets/{dataActionTargetId}` → `activate.data_action_target.update`
- `DELETE /ssot/data-actions/{dataActionId}` → `activate.data_action.delete`
- `GET /ssot/data-actions/{dataActionId}` → `activate.data_action.get`
- `GET /personalization/engagement-signals` → `activate.personalization.engagement_signals.list`
- `POST /personalization/external-apps/{idOrAppSourceIdOrName}/personalization-experience-configs` → `activate.personalization.experience_config.create`
- `DELETE /personalization/external-apps/{idOrAppSourceIdOrName}/personalization-experience-configs/{nameParam}` → `activate.personalization.experience_config.delete`
- `GET /personalization/external-apps/{idOrAppSourceIdOrName}/personalization-experience-configs/{nameParam}` → `activate.personalization.experience_config.get`
- `GET /personalization/external-apps/{idOrAppSourceIdOrName}/personalization-experience-configs` → `activate.personalization.experience_config.list`
- `PUT /personalization/external-apps/{idOrAppSourceIdOrName}/personalization-experience-configs/{nameParam}` → `activate.personalization.experience_config.update`
- `POST /personalization/external-apps/mobile/live-preview-link` → `activate.personalization.mobile_preview.create`
- `GET /personalization/external-apps/org` → `activate.personalization.org_info.get`
- `POST /personalization/personalization-points` → `activate.personalization.point.create`
- `DELETE /personalization/personalization-points/{idOrName}` → `activate.personalization.point.delete`
- `GET /personalization/personalization-points/{idOrName}` → `activate.personalization.point.get`
- `PUT /personalization/personalization-points/{idOrName}` → `activate.personalization.point.update`
- `POST /personalization/personalization-schemas` → `activate.personalization.schema.create`
- `DELETE /personalization/personalization-schemas/{idOrName}` → `activate.personalization.schema.delete`
- `GET /personalization/personalization-schemas/{idOrName}` → `activate.personalization.schema.get`
- `PATCH /personalization/personalization-schemas/{idOrName}` → `activate.personalization.schema.update`
- `POST /personalization/external-apps/transformers` → `activate.personalization.transformer.create`
- `DELETE /personalization/external-apps/transformer` → `activate.personalization.transformer.delete`
- `GET /personalization/external-apps/transformer` → `activate.personalization.transformer.get`
- `GET /personalization/external-apps/transformers` → `activate.personalization.transformer.list`
- `PUT /personalization/external-apps/transformer` → `activate.personalization.transformer.update`
- `GET /ssot/connection-endpoints` → `connect.connection_endpoints`
- `PATCH /ssot/data-model-object-mappings/{mappingName}/field-mappings` → `harmonize.dmo_field_mapping.add`
- `DELETE /ssot/data-model-object-mappings/{mappingName}/field-mappings/{fieldMappingName}` → `harmonize.dmo_field_mapping.delete`
- `PATCH /ssot/data-model-object-mappings/{mappingName}` → `harmonize.dmo_mapping.update`
- `POST /local/event-date-recommend` → `harmonize.event_date_recommend`
- `POST /ssot/identity-resolutions/{identityResolutionId}/actions/publish` → `harmonize.ir.publish`
- `POST /local/preview-field-matches` → `harmonize.preview_field_matches`
- `POST /local/smart-datastream-create` → `harmonize.smart_datastream.create`
- `POST /local/smart-mapping-suggest` → `harmonize.smart_mapping.suggest`
- `GET /local/standard-mapping-preview` → `harmonize.standard_mapping.preview`
- `GET /ssot/data-kits/deployment-jobs/{jobId}` → `prepare.datakit_deploy.status`
- `GET /ssot/data-kits/{dataKitId}` → `prepare.datakit.get`
- `POST /connect/search/metadata/results` → `query.metadata.search`
- `POST /ssot/calculated-insights/{ciName}/actions/disable` → `segment.ci.disable`
- `POST /ssot/calculated-insights/{ciName}/actions/enable` → `segment.ci.enable`
- `POST /ssot/calculated-insights/{ciName}/actions/refresh-status` → `segment.ci.run.status`
- `POST /ssot/calculated-insights/actions/validate` → `segment.ci.validate`
- `POST /ssot/machine-learning/configured-models` → `semantic.ml.configured_model.create`
- `GET /ssot/machine-learning/configured-models/{idOrName}/histories/{historyId}` → `semantic.ml.configured_model.history.get`
- `GET /ssot/machine-learning/configured-models/{idOrName}/histories` → `semantic.ml.configured_model.history.list`
- `POST /ssot/machine-learning/model-setups` → `semantic.ml.model_setup.create`
- `DELETE /ssot/machine-learning/model-setups/{idOrName}` → `semantic.ml.model_setup.delete`
- `GET /ssot/machine-learning/model-setups/{idOrName}` → `semantic.ml.model_setup.get`
- `GET /ssot/machine-learning/model-setups` → `semantic.ml.model_setup.list`
- `PATCH /ssot/machine-learning/model-setups/{idOrName}` → `semantic.ml.model_setup.update`
- `POST /ssot/machine-learning/jobs` → `semantic.ml.prediction_job.run`
- `POST /ssot/machine-learning/query-data-profile` → `semantic.ml.query_data_profile`
- `POST /ssot/machine-learning/query-outcome` → `semantic.ml.query_outcome`
- `POST /ssot/machine-learning/query-row-count` → `semantic.ml.query_row_count`
- `POST /ssot/machine-learning/query-setup-fields` → `semantic.ml.query_setup_fields`
- `GET /ssot/machine-learning/model-setups/{idOrName}/setup-versions/{versionId}/inspector/metrics` → `semantic.ml.setup_version.inspector_metrics.get`
- `GET /ssot/search-index/{searchIndexApiNameOrId}/process-history` → `semantic.search_index.process_history`
- `POST /ssot/semantic/models/{modelApiNameOrId}/calculated-dimensions` → `semantic.semantic_model.calculated_dimension.create`
- `DELETE /ssot/semantic/models/{modelApiNameOrId}/calculated-dimensions/{calculatedDimensionId}` → `semantic.semantic_model.calculated_dimension.delete`
- `GET /ssot/semantic/models/{modelApiNameOrId}/calculated-dimensions/{calculatedDimensionId}` → `semantic.semantic_model.calculated_dimension.get`
- `GET /ssot/semantic/models/{modelApiNameOrId}/calculated-dimensions` → `semantic.semantic_model.calculated_dimension.list`
- `PUT /ssot/semantic/models/{modelApiNameOrId}/calculated-dimensions/{calculatedDimensionId}` → `semantic.semantic_model.calculated_dimension.update`
- `POST /ssot/semantic/models/{modelApiNameOrId}/calculated-measurements` → `semantic.semantic_model.calculated_measure.create`
- `DELETE /ssot/semantic/models/{modelApiNameOrId}/calculated-measurements/{calculatedMeasureId}` → `semantic.semantic_model.calculated_measure.delete`
- `GET /ssot/semantic/models/{modelApiNameOrId}/calculated-measurements/{calculatedMeasureId}` → `semantic.semantic_model.calculated_measure.get`
- `GET /ssot/semantic/models/{modelApiNameOrId}/calculated-measurements` → `semantic.semantic_model.calculated_measure.list`
- `PUT /ssot/semantic/models/{modelApiNameOrId}/calculated-measurements/{calculatedMeasureId}` → `semantic.semantic_model.calculated_measure.update`
- `POST /ssot/semantic/models/{modelApiNameOrId}/clone` → `semantic.semantic_model.clone`
- `POST /ssot/semantic/models` → `semantic.semantic_model.create`
- `POST /ssot/semantic/models/{modelApiNameOrId}/data-objects` → `semantic.semantic_model.data_object.create`
- `DELETE /ssot/semantic/models/{modelApiNameOrId}/data-objects/{dataObjectNameOrId}` → `semantic.semantic_model.data_object.delete`
- `GET /ssot/semantic/models/{modelApiNameOrId}/data-objects/{dataObjectNameOrId}` → `semantic.semantic_model.data_object.get`
- `GET /ssot/semantic/models/{modelApiNameOrId}/data-objects` → `semantic.semantic_model.data_object.list`
- `PUT /ssot/semantic/models/{modelApiNameOrId}/data-objects/{dataObjectNameOrId}` → `semantic.semantic_model.data_object.update`
- `DELETE /ssot/semantic/models/{modelApiNameOrId}` → `semantic.semantic_model.delete`
- `GET /ssot/semantic/models/{modelApiNameOrId}/external-dependencies` → `semantic.semantic_model.dependencies`
- `GET /ssot/semantic/models/{modelApiNameOrId}/data-objects/{dataObjectNameOrId}/dimensions` → `semantic.semantic_model.dimension.list`
- `GET /ssot/semantic/models/formula-metadata` → `semantic.semantic_model.formula_metadata`
- `GET /ssot/semantic/models/{modelApiNameOrId}` → `semantic.semantic_model.get`
- `GET /ssot/semantic/models` → `semantic.semantic_model.list`
- `GET /ssot/semantic/models/{modelApiNameOrId}/data-objects/{dataObjectNameOrId}/measurements` → `semantic.semantic_model.measurement.list`
- `POST /ssot/semantic/models/{modelApiNameOrId}/metrics` → `semantic.semantic_model.metric.create`
- `DELETE /ssot/semantic/models/{modelApiNameOrId}/metrics/{metricNameOrId}` → `semantic.semantic_model.metric.delete`
- `GET /ssot/semantic/models/{modelApiNameOrId}/metrics/{metricNameOrId}` → `semantic.semantic_model.metric.get`
- `GET /ssot/semantic/models/{modelApiNameOrId}/metrics` → `semantic.semantic_model.metric.list`
- `PUT /ssot/semantic/models/{modelApiNameOrId}/metrics/{metricNameOrId}` → `semantic.semantic_model.metric.update`
- `GET /ssot/semantic/permissions` → `semantic.semantic_model.permissions`
- `POST /semantic-engine/gateway` → `semantic.semantic_model.query`
- `POST /ssot/semantic/models/{modelApiNameOrId}/relationships` → `semantic.semantic_model.relationship.create`
- `DELETE /ssot/semantic/models/{modelApiNameOrId}/relationships/{relationshipId}` → `semantic.semantic_model.relationship.delete`
- `GET /ssot/semantic/models/{modelApiNameOrId}/relationships/{relationshipId}` → `semantic.semantic_model.relationship.get`
- `GET /ssot/semantic/models/{modelApiNameOrId}/relationships` → `semantic.semantic_model.relationship.list`
- `PUT /ssot/semantic/models/{modelApiNameOrId}/relationships/{relationshipId}` → `semantic.semantic_model.relationship.update`
- `PATCH /ssot/semantic/models/{modelApiNameOrId}` → `semantic.semantic_model.update`
- `GET /ssot/semantic/models/{modelApiNameOrId}/validate` → `semantic.semantic_model.validate`

## SDK-stricter parameters

- `GET /ssot/data-kits/available-components` → `prepare.datakit_components`: componentType: spec optional, SDK required, dataKitDevName: spec optional, SDK required
- `GET /ssot/metadata-entities` → `query.metadata.entities`: entityType: spec optional, SDK required
- `PATCH /ssot/data-lake-objects/{}` → `prepare.dlo.update`: body: spec optional, SDK required
- `PATCH /ssot/data-model-object-mappings/{}/field-mappings/{}` → `harmonize.dmo.field_mapping.update`: fieldSourceTargetMapDeveloperName: spec optional, SDK required
- `PATCH /ssot/data-model-objects/{}` → `harmonize.dmo.update`: body: spec optional, SDK required
- `PATCH /ssot/machine-learning/alerts/{}` → `semantic.ml.alert.update`: body: spec optional, SDK required
- `PATCH /ssot/machine-learning/model-setups/{}/setup-versions/{}` → `semantic.ml.setup_version.update`: body: spec optional, SDK required
- `PATCH /ssot/machine-learning/prediction-job-definitions/{}` → `semantic.ml.prediction_job_def.activate`: body: spec optional, SDK required
- `PATCH /ssot/machine-learning/prediction-job-definitions/{}` → `semantic.ml.prediction_job_def.deactivate`: body: spec optional, SDK required
- `PATCH /ssot/machine-learning/prediction-job-definitions/{}` → `semantic.ml.prediction_job_def.update`: body: spec optional, SDK required
- `PATCH /ssot/machine-learning/retrievers/{}` → `semantic.retriever.update`: body: spec optional, SDK required
- `PATCH /ssot/machine-learning/retrievers/{}/configurations/{}` → `semantic.retriever.config.update`: body: spec optional, SDK required
- `POST /ssot/connections/{}/database-schemas` → `connect.connection.db_schemas.list`: body: spec optional, SDK required
- `POST /ssot/connections/actions/test` → `connect.connection_test`: body: spec optional, SDK required
- `POST /ssot/data-clean-room/test-connection` → `activate.clean_room.connection.test`: body: spec optional, SDK required
- `POST /ssot/data-kits/{}` → `prepare.datakit.deploy`: body: spec optional, SDK required
- `POST /ssot/data-lake-objects` → `prepare.dlo.create`: body: spec optional, SDK required
- `POST /ssot/data-model-object-mappings` → `harmonize.dmo_mapping.create`: body: spec optional, SDK required
- `POST /ssot/data-model-object-mappings` → `harmonize.standard_mapping.create`: body: spec optional, SDK required
- `POST /ssot/data-model-objects` → `harmonize.dmo.create`: body: spec optional, SDK required
- `POST /ssot/machine-learning/alerts` → `semantic.ml.alerts.query`: body: spec optional, SDK required
- `POST /ssot/machine-learning/model-setups/{}/setup-versions` → `semantic.ml.setup_version.create`: body: spec optional, SDK required
- `POST /ssot/machine-learning/prediction-job-definitions` → `semantic.ml.prediction_job_def.create`: body: spec optional, SDK required
- `POST /ssot/machine-learning/prediction-job-definitions` → `semantic.ml.prediction_job_def.create_binary_classification`: body: spec optional, SDK required
- `POST /ssot/machine-learning/prediction-job-definitions` → `semantic.ml.prediction_job_def.create_clustering`: body: spec optional, SDK required
- `POST /ssot/machine-learning/prediction-job-definitions` → `semantic.ml.prediction_job_def.create_multiclass_classification`: body: spec optional, SDK required
- `POST /ssot/machine-learning/prediction-job-definitions` → `semantic.ml.prediction_job_def.create_regression`: body: spec optional, SDK required
- `POST /ssot/machine-learning/prediction-job-definitions` → `semantic.ml.prediction_job_def.create_sentiment_detection`: body: spec optional, SDK required
- `POST /ssot/machine-learning/prediction-job-definitions` → `semantic.ml.prediction_job_def.create_topic_classification`: body: spec optional, SDK required
- `POST /ssot/machine-learning/retrievers` → `semantic.retriever.create`: body: spec optional, SDK required
- `POST /ssot/machine-learning/retrievers/{}/configurations` → `semantic.retriever.config.create`: body: spec optional, SDK required
- `POST /ssot/search-index` → `semantic.search_index.create`: body: spec optional, SDK required

## Parameter drift

None.

## Interpretation

OpenAPI-only, SDK-only, adjusted, SDK-stricter, and drift classifications are evidence for review. SDK-stricter requirements are safer caller contracts, while drift means the SDK can still issue a request that omits an OpenAPI-required input. Live Salesforce behavior and reviewed SDK overlays remain explicit evidence when the published contract and service differ.
