# SF Data 360 Troubleshooting

## `sf` authentication failed

Run:

```bash
sf org login web --set-default --alias my-sandbox
```

Then retry the `d360_api` call or pass `target_org` explicitly.

## Endpoint returned too much data

Use filters, `limit`, `rowLimit`, `offset`, or endpoint-specific pagination.
Prefer `output_mode: "summary"` or `output_mode: "file_only"` for broad responses. `d360_api` truncates oversized inline output and saves the full response to a temp file.

## Metadata request is too broad

For simple DMO/DLO lists, prefer `d360_metadata` first. List actions show a capped inline table and save the full response to a temp file:

```json
{ "action": "list_dmos", "max_results": 25 }
```

For one object's fields, describe that single object:

```json
{ "action": "describe_dmo", "api_name": "SomeObject__dlm" }
```

Do not call `/ssot/data-model-objects` broadly unless the user explicitly needs the full standard catalog or field inventory.

For other metadata, prefer metadata search first when the search plane is available:

```json
{
  "method": "POST",
  "path": "/connect/search/metadata/results",
  "body": { "query": "the entity you need", "pagination": { "limit": 10 } }
}
```

Then fetch one entity with `/ssot/metadata` and an `entityName` query parameter. If metadata search returns a backend index error, fall back to `/ssot/metadata-entities` or `d360_metadata`; catalog APIs can still be healthy.

## Optional surface returned `NOT_FOUND`

Search indexes, retrievers, and some DataKit manifest paths can return `NOT_FOUND` in an otherwise healthy Data 360 org. Treat these as feature/path availability issues unless core catalog, stream, query, or metadata probes also fail.

## Connector detail returned `NOT_FOUND`

Use the connector catalog `name` from `GET /ssot/connectors` for `/ssot/connectors/{name}`. Do not assume the connection list's `connectorType` is accepted by the connector metadata endpoint. For example, a Salesforce CRM connection can list as `connectorType=SalesforceDotCom`, while connector metadata can be exposed under catalog name `SalesforceCRM`.

## DLO category filter returned no rows

`d360_metadata list_dlos` filters on compact metadata categories from `/ssot/metadata-entities`. A detailed DLO description can report a different category. If a category filter returns zero rows, retry without the category filter and inspect the available categories in the helper output.

## Create/update failed with schema errors

1. Fetch the current resource state with a `GET` call.
2. Re-read `examples.md` for a similar payload shape.
3. Remove read-only fields copied from a GET response.
4. Retry with the smallest possible body.

## Raw `sf api request rest` rejected `--json`

Prefer `d360_api`. If you must call raw `sf api request rest`, do not add `--json`; pipe stdout to `jq` and redirect beta warnings from stderr when needed.

## DELETE failed with `No 'mode' found in 'body' entry`

Some sf CLI versions require an explicit request body for `sf api request rest --method DELETE`. `d360_api` sends an empty JSON body for DELETE calls to avoid this CLI-side failure. If you must use raw CLI fallback, pass a small body such as `--body '{}'` or use a request file with `body.mode: "raw"`.

## Endpoint returned `METHOD_NOT_ALLOWED`

Treat this as live API evidence for that org/API version. Some cataloged mutating paths can be read-only or can require a different identifier shape. Re-check the resource returned by `GET`; for example, if deleting by an ID is rejected, the same endpoint family can require a developer/API name instead.

## Create failed after copying a list response

Data 360 create/update DTOs can use different field names than list/get responses. Do not copy response payloads wholesale into create/update calls. Common examples:

- DLO create can accept `dataLakeFieldInputRepresentations[]`, while GET returns `dataLakeFieldInfoRepresentation[]` and `fields[]`.
- Mapping create/add can require `fieldMapping[]` with `sourceFieldDeveloperName` and `targetFieldDeveloperName`.
- Data action create can reject response-only fields from `dataActionSources`. Use create fields such as `sourceName`, `sourceType`, and `sourceCdcSubscriptions`; the response returns them as `objectDevName`, `objectType`, and `subscriptionModes`.
- Connection test requires `connectorType` in the request body, not only as a query parameter. It also requires `method` with values such as `Ingress` or `Egress`, and parameter entries use `paramName` plus `value`.
- Activation target create is polymorphic by `platformType`; a missing or wrong `connector` object can fail at JSON parsing before business validation. For `DataCloud` targets, `connector: {}` is valid, but activation target DELETE may not be exposed.

## Connection action and connector metadata calls

- `POST /ssot/connections/actions/test` and
  `POST /ssot/connections/actions/{command}` require `connectorType` in the
  body, not only as a query parameter. Without it, the response is
  `INVALID_INPUT: connectorType is required`.
- `POST /ssot/connections/{connectionId}/database-schemas`,
  `/databases`, `/objects/{resourceName}/preview`, and
  `/connections/{connectionId}/actions/test` only work for connector kinds
  that expose those surfaces (for example JDBC-shaped connectors). For
  Salesforce CRM and similar connections they can return
  `INTERNAL_ERROR: Unable to query database schemas` or
  `UNKNOWN_EXCEPTION`. This is feature gating, not a plugin failure.
- `GET /ssot/connections/{connectionId}/schema` and `/sitemap` are
  Web/website-connector specific. With other connector types the API
  returns enum/parameter errors.
- `GET /ssot/connections/{connectionId}/endpoints` requires the connector
  to expose an OpenAPI definition and may return `INTERNAL_SERVER_ERROR`
  when none is available.

## DataKit and machine-learning gotchas

- `GET /ssot/datakit/{dataKitDevName}/manifest` is namespace-gated and
  refuses spidering with
  `DataKitSpidering is not allowed for this DataKit as orgnamespace is not
same as datakit namespace`. Work with manifests for DataKits installed in
  the same namespace as the org or use the listed component endpoints.
- `GET /ssot/data-kits/{dataKitName}/components/{componentName}/dependencies`
  requires the `componentType` query parameter; without it the response is
  `Component Type property is missing`.
- `GET /ssot/machine-learning/configured-models` rejects the generic
  `connectorType` query value. Call it without query parameters to list
  models, then filter client-side.
- `POST /ssot/machine-learning/predict` requires a polymorphic body with a
  discriminator (`type`) field. Without it the API returns
  `JSON_PARSER_ERROR ... missing property 'type'`.

## Segment create rejected by the platform

Verified shapes for SQL-defined (`Dbt`) segments on current API versions:

- `developerName` is required; without it the platform reports a vague
  validation error.
- `segmentType` must come from
  `Dbt|Dynamic|EinsteinGptSegmentsUI|Lookalike|Realtimez|Waterfall`. The
  legacy upstream value `Ui` is rejected.
- `includeDbt.models.models[]` is double-nested; a flat `models[]` is
  rejected with `Can not deserialize: unexpected array`.
- DBT model SQL must use unaliased fully-qualified identifiers in the
  primary projection (`SELECT DISTINCT dmo.field`, not `field AS x`).
- DBT model SQL must project both the primary key and the key qualifier
  of the segmentOn entity (for example, both `ssot__Id__c` and
  `KQ_Id__c`).

If `actions/count` or `actions/deactivate` returns `INTERNAL_ERROR: We
couldn't trigger async count on your segment` or `We couldn't publish
your segment`, the segment is still in `PROCESSING` status. Poll the
status before retrying.

## CI status reads `DELETING` after delete

`DELETE /ssot/calculated-insights/{apiName}` returns 204 with an empty
body. A follow-up GET briefly returns the record with
`calculatedInsightStatus: "DELETING"` before the resource is fully gone
(`ITEM_NOT_FOUND`). Treat both transient `DELETING` and `ITEM_NOT_FOUND`
as successful cleanup.

## Data action target GET says `Id can not be null or empty`

After deleting a data-action target, a GET on the target apiName can
return `ILLEGAL_QUERY_PARAMETER_VALUE: DataActionTarget Id can not be
null or empty` instead of `ITEM_NOT_FOUND`. The path appears to expect
an internal id, not the apiName, on this code path. Confirm cleanup with
`GET /ssot/data-action-targets` and a filter, or by checking that no row
in the list response has a matching `apiName`.

## Mutating call was blocked

Re-run with `dry_run: true` and inspect the safety decision. If the operation is
intended, run interactively so the confirmation dialog can appear.
