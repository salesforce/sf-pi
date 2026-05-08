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
- `GET /ssot/data-kits` — list DataKits. Responses can be broad; prefer `output_mode: "summary"` or `"file_only"`.
- `GET /ssot/data-kits/{id}/manifest` — get DataKit manifest when the org exposes a manifest identifier/path. A DataKit `developerName` from the list response is not always accepted here.
- `POST /ssot/data-kits/update-components` — deploy/update DataKit components.
- `POST /ssot/data-kits/{id}/undeploy` — undeploy DataKit components.

## Semantic data models, search indexes, and retrievers

- `GET /ssot/data-transforms` — list data transforms.
- `GET /ssot/data-transforms/{id}` — inspect one data transform.
- `GET /ssot/semantic/models` — list semantic models.
- `POST /ssot/semantic/models` — create semantic model shell.
- `POST /ssot/semantic/models/{id}/data-objects` — add data object.
- `POST /ssot/semantic/models/{id}/relationships` — create relationship.
- `POST /ssot/semantic/models/{id}/validate` — validate semantic model.
- `POST /semantic-engine/gateway` — run semantic query.
- `GET /ssot/search-indexes` — list search indexes. This can return not found in otherwise healthy orgs; do not use as a core readiness gate.
- `POST /ssot/search-indexes` — create search index.
- `GET /machine-learning/retrievers` — list retrievers. This can return not found when retriever APIs are not provisioned or use a different path.
- `POST /machine-learning/retrievers` — create retriever.
