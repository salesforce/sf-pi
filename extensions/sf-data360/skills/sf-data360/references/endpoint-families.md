# SF Data 360 Endpoint Families

This is a compact endpoint map for common Data 360 REST workflows. Paths are
relative to `/services/data/vXX.X`.

## Query and metadata

- `GET /ssot/data-spaces` — list data spaces.
- `GET /ssot/data-spaces/{name}` — inspect one data space.
- `POST /ssot/query-sql` — run preferred Data 360 SQL queries.
- `GET /ssot/query-sql/{queryId}` — check query status.
- `GET /ssot/query-sql/{queryId}/rows` — fetch query rows.
- `DELETE /ssot/query-sql/{queryId}` — cancel query.
- `POST /connect/search/metadata/results` — natural-language metadata search. Treat backend index errors as search-plane readiness issues, not proof that catalog APIs are unavailable.
- `GET /ssot/metadata` — fetch metadata for a specific entity. Use `entityName`.
- `GET /ssot/metadata-entities` — list metadata entities with filters/pagination.

## DMO and DLO

- `GET /ssot/data-model-objects` — list DMOs.
- `GET /ssot/data-model-objects/{dmoName}` — get DMO schema.
- `POST /ssot/data-model-objects` — create DMO.
- `PATCH /ssot/data-model-objects/{dmoName}` — update DMO.
- `DELETE /ssot/data-model-objects/{dmoName}` — delete DMO.
- `GET /ssot/data-lake-objects` — list DLOs.
- `GET /ssot/data-lake-objects/{dloName}` — get DLO schema.

## Mappings and data streams

- `GET /ssot/data-model-object-mappings` — list mappings. Provide `dmoDeveloperName` or `sourceObjectName`; an unfiltered list can fail.
- `GET /ssot/data-model-object-mappings/{mappingName}` — get mapping.
- `POST /ssot/data-model-object-mappings` — create mapping.
- `PATCH /ssot/data-model-object-mappings/{mappingName}` — update mapping.
- `DELETE /ssot/data-model-object-mappings/{mappingName}` — delete mapping.
- `GET /ssot/data-streams` — list data streams.
- `GET /ssot/data-streams/{id}` — get data stream. The stream `name` from list responses is often the correct path segment.
- `POST /ssot/data-streams` — create data stream.
- `PATCH /ssot/data-streams/{id}` — update data stream.
- `DELETE /ssot/data-streams/{id}` — delete data stream.
- `POST /ssot/data-streams/{id}/run` — trigger ingestion.

## Connections

- `GET /ssot/connectors` — list connector types.
- `GET /ssot/connectors/{name}` — inspect connector metadata. Use the connector catalog `name`; it can differ from connection `connectorType` values.
- `GET /ssot/connections` — list connections; pass `connectorType`.
- `GET /ssot/connections/{id}` — get connection.
- `POST /ssot/connections/actions/test` — test connection configuration.
- `POST /ssot/connections` — create connection.
- `PATCH /ssot/connections/{id}` — update connection.
- `DELETE /ssot/connections/{id}` — delete connection.

## Calculated insights and segments

- `GET /ssot/calculated-insights` — list calculated insights.
- `GET /ssot/calculated-insights/{ciName}` — get calculated insight.
- `POST /ssot/calculated-insights/actions/validate` — validate CI.
- `POST /ssot/calculated-insights` — create CI.
- `PATCH /ssot/calculated-insights/{ciName}` — update CI.
- `DELETE /ssot/calculated-insights/{ciName}` — delete CI.
- `POST /ssot/calculated-insights/{ciName}/actions/run` — run CI.
- `GET /ssot/segments` — list segments.
- `GET /ssot/segments/{id}` — get segment.
- `POST /ssot/segments` — create segment.
- `POST /ssot/segments/{id}/actions/publish` — publish/calculate segment.

## Activation, actions, and DataKit

- `GET /ssot/activations` — list activations.
- `POST /ssot/activations` — create activation.
- `GET /ssot/activation-targets` — list activation targets.
- `POST /ssot/activation-targets` — create activation target.
- `GET /ssot/data-actions` — list data actions.
- `POST /ssot/data-actions` — create data action.
- `DELETE /ssot/data-actions/{developerName}` — delete data action when the org exposes cleanup support; this path can be absent from some published operation summaries, so verify after calling.
- `GET /ssot/data-kits` — list DataKits. Responses can be broad; prefer `output_mode: "summary"` or `"file_only"`.
- `GET /ssot/data-kits/{id}/manifest` — get DataKit manifest when the org exposes a manifest identifier/path. A DataKit `developerName` from the list response is not always accepted here.
- `POST /ssot/data-kits/update-components` — deploy/update DataKit components.
- `POST /ssot/data-kits/{id}/undeploy` — undeploy DataKit components.

## Profile, insight, and data graph reads

- `GET /ssot/profile/metadata` — profile-enabled DMOs with relationships.
- `GET /ssot/profile/metadata/{dataModelName}` — relationships and fields for one profile DMO; `dataModelName` is the full DMO API name with the `__dlm` suffix.
- `GET /ssot/profile/{dataModelName}` — record reads; require profile filter parameters.
- `GET /ssot/profile/{dataModelName}/{id}` and child/CI variants — require `orderby` when `offset` is supplied.
- `GET /ssot/insight/metadata` and `/ssot/insight/metadata/{ciName}` — calculated insight metadata; need an existing CI.
- `GET /ssot/insight/calculated-insights/{ciName}` — calculated insight rows; need an existing CI.
- `GET /ssot/data-graphs` — list data graphs.
- `GET /ssot/data-graphs/data/{dataGraphEntityName}` and `/{id}` — record reads on a data graph entity; require additional query parameters such as field IDs.

## Document AI and machine learning

- `GET /ssot/document-processing/configurations` and detail/manifest reads.
- `POST /ssot/document-processing/actions/extract-data` and `actions/generate-schema` — operational and require structured inputs.
- `GET /ssot/machine-learning/alerts`, `model-setups`, `model-artifacts`, and `configured-models` — list endpoints; do not pass an unknown `connectorType` query value.
- `POST /ssot/machine-learning/predict` — inference endpoint with a polymorphic body; the JSON requires a `type` discriminator and prediction-specific fields.

## Data clean room and private network routes

- `GET /ssot/data-clean-room/collaborations`, `providers`, `specifications`, `templates` — list endpoints; details require an existing collaboration/provider/specification.
- `PUT /ssot/data-clean-room/collaborations/{id}/actions/accept-invitation` and `reject-invitation` — operational; treat as mutating.
- `POST /ssot/data-clean-room/collaborations/{id}/actions/run` — runs a clean room query; mutating.
- `GET /ssot/private-network-routes` and detail — feature gated; can return internal errors when the org has no routes.

## Data transforms

- `GET /ssot/data-transforms` — list data transforms.
- `GET /ssot/data-transforms/{id}` — inspect one data transform.
- `POST /ssot/data-transforms-validation` — validate.
- `POST /ssot/data-transforms/{id}/actions/run|cancel|retry|refresh-status` — operational.

## Semantic data models

- `GET /ssot/semantic/models` — list semantic models.
- `POST /ssot/semantic/models` — create model shell.
- The shell response returns subresource URLs; use them rather than
  guessing paths. Common ones: `semanticDataObjectsUrl`,
  `semanticCalculatedDimensionsUrl`, `semanticCalculatedMeasurementsUrl`,
  `semanticMetricsUrl`, `semanticGroupingsUrl`.
- `POST /ssot/semantic/models/{name}/data-objects` — add data object;
  platform auto-discovers semantic dimensions from the source DMO.
- `GET  /ssot/semantic/models/{name}/validate` — validate (GET, **not** POST).
- `DELETE /ssot/semantic/models/{name}` — cleanup; subsequent GET returns
  `SemanticAuthoringError: SEMANTIC_ENTITY_NOT_EXIST`.
- `POST /semantic-engine/gateway` — run a semantic query.

## Search index and retrievers

- `GET /ssot/search-index` (singular) and `POST /ssot/search-index` — list and create.
- Create requires `vectorEmbeddingConfiguration.embeddingModel.id`; the
  org must have an embedding model artifact. Verify with
  `GET /ssot/machine-learning/model-artifacts`.
- `GET /machine-learning/retrievers` — list retrievers; can return
  not-found when retriever APIs are not provisioned. Do not use as a
  core readiness gate.
