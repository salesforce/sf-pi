# SF Data 360 Data Shapes

These notes condense public Data 360 API examples and request DTO shapes into
API-first guidance for `d360_api`. Treat them as starting points; verify against
live org metadata before mutating.

## DMO create shape

Endpoint: `POST /ssot/data-model-objects`

Use the Connect REST schema, not the upstream MCP DTO names. The Swagger
`DataModelObjectInputRepresentation` field names that the org accepts are:

- `name` — custom DMO API name root. Do not include `__dlm`; the API
  appends the suffix. Do not start custom names with `ssot`.
- `label` — display label.
- `description` — optional.
- `dataSpaceName` — optional; default is `default`.
- `category` — uppercase enum, for example `PROFILE`, `ENGAGEMENT`, or
  `OTHER`. Connect REST rejects the upstream MCP value `objectCategory`
  and the value casing `Profile`/`Other` for create payloads.
- `fields[]` — each field uses `name`, `label`, `dataType`,
  `isPrimaryKey`, optional `isDynamicLookup`, and `description`. Do not
  send `objectType` or `precision`/`scale` unless the live API version
  documents them.

Example skeleton:

```json
{
  "name": "ProductReview",
  "label": "Product Review",
  "description": "Custom DMO for product reviews.",
  "dataSpaceName": "default",
  "category": "PROFILE",
  "fields": [
    {
      "name": "Id__c",
      "label": "ID",
      "isPrimaryKey": true,
      "isDynamicLookup": false,
      "dataType": "Text"
    },
    {
      "name": "Rating__c",
      "label": "Rating",
      "isPrimaryKey": false,
      "isDynamicLookup": false,
      "dataType": "Number"
    }
  ]
}
```

The response includes the auto-generated `__dlm` suffix on `name`, plus
system-managed fields such as `DataSource__c`, `DataSourceObject__c`,
`InternalOrganization__c`, and `KQ_Id__c`. Do not echo these back into a
later PATCH unless you intend to keep them.

## DMO update shape

Endpoint: `PATCH /ssot/data-model-objects/{dataModelObjectName}`

- The `{dataModelObjectName}` path segment uses the suffixed DMO API name
  (for example `Pi_D360_Sweep__dlm`).
- The body uses the same `DataModelObjectInputRepresentation` schema as
  create. `label`, `description`, and `category` updates take effect.
- `fields[]` is additive: any field listed that does not already exist is
  appended. Existing fields are not removed by omitting them, and a
  PATCH that lists an existing field name with different metadata can be
  rejected.
- To remove a field, treat the DMO as immutable for that field and
  recreate the object, or use a dedicated mapping/relationship cleanup
  flow when supported.

Example additive PATCH:

```json
{
  "name": "ProductReview__dlm",
  "label": "Product Review",
  "description": "Updated description.",
  "dataSpaceName": "default",
  "category": "PROFILE",
  "fields": [
    {
      "name": "NewField__c",
      "label": "New Field",
      "isPrimaryKey": false,
      "isDynamicLookup": false,
      "dataType": "Text"
    }
  ]
}
```

## DLO create shape

Endpoint: `POST /ssot/data-lake-objects`

Common fields:

- `name` — DLO API name, usually ending in `__dll`.
- `label`
- `category` — for example `Other`, `Engagement`, or `Profile`.
- `dataspaceInfo[]` — include `{ "name": "default" }` or another data space when the DLO must be usable from data-space-scoped workflows such as mappings.
- `dataLakeFieldInputRepresentations[]` — each field should include `name`, `label`, `dataType`, and `isPrimaryKey`.

Avoid sending `description` or `dataSpaceName` in DLO create payloads unless the live API version accepts them; some orgs reject those fields for this endpoint. Prefer `dataspaceInfo` for data-space membership.

Example skeleton:

```json
{
  "name": "ProductReview__dll",
  "label": "Product Review",
  "category": "Other",
  "dataspaceInfo": [{ "name": "default" }],
  "dataLakeFieldInputRepresentations": [
    { "name": "review_id__c", "label": "Review ID", "dataType": "Text", "isPrimaryKey": true },
    { "name": "rating__c", "label": "Rating", "dataType": "Number", "isPrimaryKey": false }
  ]
}
```

## Data stream create shape

Endpoint: `POST /ssot/data-streams`

Common fields:

- `name`, `label`
- `datastreamType` — for Salesforce CRM streams, `SFDC`.
- `connectorInfo.connectorType`
- `connectorInfo.connectorDetails` for connector-specific values such as source object or connection name.
- `dataLakeObjectInfo` for DLO label/name/category/dataspace/fields.
- `sourceFields[]` for source-side field names/types.
- `mappings[]` for source-to-DLO mappings when required.
- `refreshConfig` for refresh behavior.
- `dataAccessMode`, often an ingest/direct-access value depending on connector.
- `advancedAttributes` for connector-specific values such as file/parser/directory settings.

For Salesforce CRM streams, first list connections with `connectorType=SalesforceDotCom`. A minimal CRM stream can let the API populate source fields from the CRM object:

```json
{
  "name": "ProductStream",
  "label": "Product Stream",
  "datastreamType": "SFDC",
  "connectorInfo": {
    "connectorType": "SalesforceDotCom",
    "connectorDetails": {
      "name": "SalesforceDotCom_Home",
      "sourceObject": "Product2"
    }
  },
  "dataLakeObjectInfo": {
    "name": "ProductStreamDlo",
    "category": "Other",
    "dataspaceInfo": [{ "name": "default" }]
  }
}
```

Guidance:

1. Inspect connector metadata first. Connector metadata uses connector catalog names such as `SalesforceCRM`; connection lists can use connector types such as `SalesforceDotCom`.
2. Inspect or test the connection before stream creation.
3. For Engagement streams, choose an immutable event time field.
4. Do not assume every connector supports full stream creation through the API.
5. Delete disposable streams with `shouldDeleteDataLakeObject=true` when the test DLO should also be removed.

## DMO mapping shape

Endpoint: `POST /ssot/data-model-object-mappings`

Common API shape:

```json
{
  "sourceEntityDeveloperName": "SourceObject__dll",
  "targetEntityDeveloperName": "TargetObject__dlm",
  "fieldMapping": [
    {
      "sourceFieldDeveloperName": "source_id__c",
      "targetFieldDeveloperName": "TargetId__c"
    }
  ]
}
```

Live-listing note: mapping list usually needs a filter such as `dmoDeveloperName`
or `sourceObjectName`. Do not use an unfiltered list as a readiness probe.

For `PATCH /ssot/data-model-object-mappings/{mappingName}/field-mappings`, use
the same `sourceEntityDeveloperName`, `targetEntityDeveloperName`, and
`fieldMapping[]` shape. Some API versions reject a wrapper named
`fieldMappings` on that subresource.

## Calculated insight create shape

Endpoint: `POST /ssot/calculated-insights`

Common fields:

- `apiName` — must end with `__cio`.
- `displayName`
- `definitionType` — usually `CALCULATED_METRIC` for calculated metrics.
- `publishScheduleInterval`
- `expression` — CI SQL.
- optional `dataSpaceName`, `description`, schedule start/end, draft flags.

Do not include explicit dimensions/measures arrays unless the current API
documentation requires them; the platform can derive them from the expression.

## Data action shape

Endpoint: `POST /ssot/data-actions`

Data action request shapes are strict and differ from list response property names. Do not blindly copy `GET /ssot/data-actions` output into a create request; response fields such as `objectDevName`, `objectId`, `objectType`, and `subscriptionModes` are output fields. For create, use source input fields such as `sourceName`, `sourceType`, and `sourceCdcSubscriptions`.

Example skeleton:

```json
{
  "dataActionTargetNames": ["example_webhook_target"],
  "dataspace": "default",
  "dataActionName": "example_data_action",
  "developerName": "example_data_action",
  "description": "Example event-triggered data action.",
  "masterLabel": "Example Data Action",
  "dataActionSources": [
    {
      "sourceName": "SomeObject__dlm",
      "sourceType": "DataModelEntity",
      "sourceCdcSubscriptions": ["CREATE", "UPDATE"]
    }
  ],
  "actionConditionExpression": "",
  "actionConditions": [],
  "dataActionEnrichmentProperties": [],
  "dataActionProjectedFields": []
}
```

Although the public operation list may omit it, `DELETE /ssot/data-actions/{developerName}` can be available for cleanup in some orgs/API versions. Verify with a follow-up list.

## Data action target shape

Endpoint: `POST /ssot/data-action-targets`

A minimal webhook-style target can use:

```json
{
  "apiName": "example_webhook_target",
  "label": "Example Webhook Target",
  "type": "WebHook",
  "subType": "Rest",
  "externalRecordIdentifier": "example-webhook-target",
  "config": {
    "targetEndpoint": "https://example.invalid/data-action",
    "apiContract": "{}"
  }
}
```

Delete with `DELETE /ssot/data-action-targets/{apiName}` after ensuring no data actions reference it. PATCH support can be org/API-version-specific; verify by re-reading or list-filtering after update attempts.

## Activation target shape

Endpoint: `POST /ssot/activation-targets`

Activation target payloads are polymorphic by `platformType`. The live API requires a `connector` object and can reject connector fields that are accepted by other endpoint families. For a Data 360 activation target, the connector object can be empty:

```json
{
  "name": "example_data_cloud_target",
  "description": "Example Data 360 activation target.",
  "platformType": "DataCloud",
  "dataSpaceName": "default",
  "isCappingEnabled": false,
  "connector": {}
}
```

Use the returned activation target ID for PATCH updates; updating by name can fail even when `GET` accepts ID or developer name. The Connect API spec for activation targets does not expose DELETE, so only create disposable activation targets in throwaway orgs or when a manual cleanup path is acceptable.

## Segment create shape

Endpoint: `POST /ssot/segments`

Common fields:

- `displayName`
- `segmentOnApiName` — entity being segmented, often a unified DMO.
- `segmentType`
- `segmentCreationFlow`
- `publishSchedule*` fields when scheduled publishing is needed.
- `includeDbt.models.models[].sql` for SQL/dbt-style segment definitions.

Segment SQL is Data Cloud SQL, not CRM SOQL. Verify referenced calculated
insights are active before segment creation.

For SQL/dbt-style segments, a common API pattern is `segmentType: "Ui"`,
`segmentCreationFlow: "Datakit"`, `publishSchedule: "NoRefresh"`, and nested
`includeDbt.models.models[].sql`. When deleting a segment, prefer the segment
API/developer name if deleting by the returned `marketSegmentId` reports that
only `GET`/`HEAD` are allowed.

## Identity resolution shape

Endpoint: `POST /ssot/identity-resolutions`

Common fields:

- `label`, `description`
- `configurationType` — for example individual/account style configurations.
- `rulesetId`
- `doesRunAutomatically`
- `matchRules[].criteria[]` with `entityName`, `fieldName`, `matchMethodType`, and blank/case behavior.
- `reconciliationRules[]` with `entityName`, `ruleType`, source precedence, and optional field-level rules.

Rule of thumb: include an explicit `ruleType` for each reconciliation rule and
choose a rule compatible with fields that are actually mapped.

## Semantic model shape

Semantic model workflows are multi-step:

1. `POST /ssot/semantic/models` — create model shell with `apiName`, `label`, `dataspace`.
2. `POST /ssot/semantic/models/{id}/data-objects` — add DMO/DLO/CI objects. Use `dataObjectType` values like `Dmo`, `Dlo`, or `Cio`.
3. List data objects/dimensions/measurements to discover semantic field names.
4. Create relationships using semantic field API names, not raw DMO field names.
5. Add calculated dimensions/measures/metrics.
6. Validate before query.

Semantic formula syntax uses bracketed semantic references such as
`[DataObject].[Field]`.

## Search index shape

Search index creation is configuration-heavy. Before create/update:

1. Fetch search-index configuration options for the org when that surface exists.
2. Retrieve an existing index if updating.
3. Populate only values supported by the org, such as chunking strategy,
   embedding model, search type, similarity metric, transformation settings,
   and per-file or field-level settings.

Do not use search-index availability as the only Data Cloud readiness signal;
it can be absent in otherwise healthy orgs.
