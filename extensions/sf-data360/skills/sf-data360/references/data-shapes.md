# SF Data 360 Data Shapes

Verified Connect REST request shapes for `d360_api`. Each entity lists
endpoint, required input fields, one canonical example, and lifecycle gotchas.
Verify against live org metadata before mutating; live errors are the
authority, not the Swagger description.

Conventions used in this file:

- "API name" segments shown in URLs are the post-create suffixed form
  (for example `MyDmo__dlm`).
- Bodies use the Connect REST DTO names. Upstream MCP examples sometimes
  use older or service-layer DTO names; prefer Swagger names when they
  conflict.

## DMO — `/ssot/data-model-objects`

Schema: `DataModelObjectInputRepresentation`.

- Required: `name` (without `__dlm` suffix), `label`, `category`,
  `fields[]`.
- `category` is uppercase enum: `PROFILE` | `ENGAGEMENT` | `OTHER`. Any
  other casing is rejected. Do not send `objectType`.
- Each field: `name`, `label`, `dataType`, `isPrimaryKey`,
  optional `isDynamicLookup`, `description`.
- The platform appends `__dlm` and adds system fields (`DataSource__c`,
  `DataSourceObject__c`, `InternalOrganization__c`, `KQ_Id__c`).

```json
{
  "name": "ProductReview",
  "label": "Product Review",
  "dataSpaceName": "default",
  "category": "PROFILE",
  "fields": [
    { "name": "Id__c", "label": "ID", "isPrimaryKey": true, "dataType": "Text" },
    { "name": "Rating__c", "label": "Rating", "dataType": "Number" }
  ]
}
```

Update: `PATCH /ssot/data-model-objects/{name}__dlm` with the same schema.
PATCH is **additive** for `fields[]` — listed fields not yet present are
appended; omitting a field does not remove it. Recreate the DMO to drop a
field.

Delete: `DELETE /ssot/data-model-objects/{name}__dlm`. A subsequent GET
returns `ITEM_NOT_FOUND`.

## DLO — `/ssot/data-lake-objects`

- Required: `name` (usually `__dll`), `label`, `category`,
  `dataLakeFieldInputRepresentations[]`.
- `dataspaceInfo: [{ "name": "default" }]` for data-space membership;
  prefer this over `dataSpaceName` on this endpoint.
- Avoid sending `description` unless the live API version accepts it.

```json
{
  "name": "ProductReview__dll",
  "label": "Product Review",
  "category": "Other",
  "dataspaceInfo": [{ "name": "default" }],
  "dataLakeFieldInputRepresentations": [
    { "name": "review_id__c", "label": "Review ID", "dataType": "Text", "isPrimaryKey": true },
    { "name": "rating__c", "label": "Rating", "dataType": "Number" }
  ]
}
```

## Data stream — `/ssot/data-streams`

- Required: `name`, `label`, `datastreamType`, `connectorInfo`,
  `dataLakeObjectInfo`.
- `datastreamType: "SFDC"` for Salesforce CRM streams; other types per
  connector catalog.
- For CRM streams, a minimal `dataLakeObjectInfo` lets the API
  auto-populate source fields from the source object.

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
    "name": "ProductStream",
    "label": "Product Stream",
    "category": "Other",
    "dataspaceInfo": [{ "name": "default" }]
  }
}
```

Lifecycle:

- Create returns the stream and an auto-built DLO named after `name`
  (suffix `__dll`).
- `POST /ssot/data-streams/{name}/actions/run` rejects `SalesforceDotCom`
  with `Connector type SalesforceDotCom is not allowed to run in
non-interactive mode`. CRM ingestion runs from the UI.
- `DELETE /ssot/data-streams/{name}?shouldDeleteDataLakeObject=true|false`
  is **required**; missing the query parameter returns
  `MALFORMED_QUERY: Required request parameter missing:
shouldDeleteDataLakeObject`.
- DELETE is eventually consistent. Immediate GET can still return the
  record before settling on `INTERNAL_ERROR: DataStream found null`.

## DMO mapping — `/ssot/data-model-object-mappings`

Schema uses `Entity`/`Field` developer-name properties, not `Object`/`Field`
names from list responses.

```json
{
  "sourceEntityDeveloperName": "SourceObject__dll",
  "targetEntityDeveloperName": "TargetObject__dlm",
  "fieldMapping": [
    { "sourceFieldDeveloperName": "source_id__c", "targetFieldDeveloperName": "TargetId__c" }
  ]
}
```

- List requires a filter; an unfiltered list can fail. Pass
  `dmoDeveloperName=<name>__dlm` or `sourceObjectName=<name>__dll`.
- For `PATCH .../{mappingName}/field-mappings` use the same shape; some
  API versions reject a wrapper named `fieldMappings` on that
  subresource.

## Calculated insight — `/ssot/calculated-insights`

- Required: `apiName` (must end `__cio`), `displayName`, `definitionType`,
  `expression`.
- `publishScheduleInterval`: `SYSTEM_MANAGED` for create-only flows or
  `Six` | `Twelve` | `TwentyFour` for scheduled refresh.
- Do not send dimensions/measures arrays; the platform derives them from
  the expression (verified: `SELECT dim, COUNT(*) FROM dmo GROUP BY dim`
  yields one dimension and one measure automatically).

```json
{
  "apiName": "Customer_Order_Summary__cio",
  "displayName": "Customer Order Summary",
  "definitionType": "CALCULATED_METRIC",
  "dataSpaceName": "default",
  "publishScheduleInterval": "SYSTEM_MANAGED",
  "expression": "SELECT Order__dlm.CustomerId__c AS customer_id__c, SUM(Order__dlm.Total__c) AS total__c FROM Order__dlm GROUP BY Order__dlm.CustomerId__c"
}
```

Lifecycle:

- Create returns `calculatedInsightStatus: "PROCESSING"`; quickly transitions to `ACTIVE`.
- `POST .../{apiName}/actions/run` returns `{ "success": true, "errors": [] }` synchronously.
- `DELETE .../{apiName}` returns 204. A follow-up GET briefly returns the
  record with `calculatedInsightStatus: "DELETING"` before final
  `ITEM_NOT_FOUND`. Treat both transient `DELETING` and `ITEM_NOT_FOUND`
  as successful cleanup.

## Data action — `/ssot/data-actions`

- Required: `developerName`, `dataActionName`, `masterLabel`,
  `dataspace`, `dataActionTargetNames[]`, `dataActionSources[]`.
- Source input field names differ from list response field names. For
  create use `sourceName` / `sourceType` / `sourceCdcSubscriptions`; the
  response renames them to `objectDevName` / `objectType` /
  `subscriptionModes`.

```json
{
  "developerName": "example_data_action",
  "dataActionName": "example_data_action",
  "masterLabel": "Example Data Action",
  "description": "Example event-triggered data action.",
  "dataspace": "default",
  "dataActionTargetNames": ["example_webhook_target"],
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

Cleanup ordering: delete the data action before the data action target it
references.

## Data action target — `/ssot/data-action-targets`

- Required: `apiName`, `label`, `type`, `config`.
- Webhook targets accept a minimal `config: { "targetEndpoint": "..." }`.
  Do not include `subType`, `externalRecordIdentifier`, or `apiContract`
  unless the live target type documents them.
- Response normalizes `type` to uppercase (`WebHook` becomes `WEBHOOK`).

```json
{
  "apiName": "example_webhook_target",
  "label": "Example Webhook Target",
  "type": "WebHook",
  "config": { "targetEndpoint": "https://example.invalid/data-action" }
}
```

Lifecycle:

- Create returns `status: "PROCESSING"`; transitions to `ACTIVE` shortly after.
- `DELETE .../{apiName}` returns 204. A follow-up `GET .../{apiName}` may
  return `ILLEGAL_QUERY_PARAMETER_VALUE: DataActionTarget Id can not be
null or empty` instead of a clean `ITEM_NOT_FOUND`. Confirm cleanup with
  a list call.

## Activation target — `/ssot/activation-targets`

Polymorphic by `platformType`. For Data Cloud targets, `connector` is
required but can be empty.

```json
{
  "name": "example_data_cloud_target",
  "platformType": "DataCloud",
  "dataSpaceName": "default",
  "connector": {}
}
```

- Update by ID; updating by name can fail.
- The Connect API spec for activation targets does not expose DELETE.
  Only create disposable targets in throwaway orgs.

## Segment — `/ssot/segments`

- Required for create: `developerName`, `displayName`, `description`,
  `segmentOnApiName`, `segmentType`.
- `segmentType` enum: `Dbt` | `Dynamic` | `EinsteinGptSegmentsUI` |
  `Lookalike` | `Realtimez` | `Waterfall`. The legacy upstream value
  `Ui` is rejected on current API versions.
- `segmentCreationFlow` enum: `Datakit` | `EinsteinGpt` | `Visual`. Use
  `Visual` for SQL-only segments without datakit dependency.
- `segmentOnApiName` must be a DMO with `isSegmentable: true`.
- `publishSchedule` enum: `NoRefresh` | `One` | `Two` | `Four` | `Six` |
  `Twelve` | `TwentyFour`.
- `includeDbt.models.models[]` is **double-nested**; a flat `models[]`
  is rejected with `Can not deserialize: unexpected array` even though
  the Swagger description suggests flat.
- DBT model SQL must:
  - Use unaliased fully-qualified identifiers in the primary projection
    (`SELECT DISTINCT dmo.field`, not `field AS x`).
  - Project both the primary key and the key qualifier of the segmentOn
    entity (for example `ssot__Id__c` and `KQ_Id__c`).

```json
{
  "developerName": "Example_Segment",
  "displayName": "Example Segment",
  "description": "Example segment.",
  "segmentOnApiName": "ssot__SomeProfile__dlm",
  "segmentType": "Dbt",
  "publishSchedule": "NoRefresh",
  "segmentCreationFlow": "Visual",
  "includeDbt": {
    "models": {
      "models": [
        {
          "name": "example_segment",
          "sql": "SELECT DISTINCT ssot__SomeProfile__dlm.ssot__Id__c, ssot__SomeProfile__dlm.KQ_Id__c FROM ssot__SomeProfile__dlm"
        }
      ]
    }
  }
}
```

Lifecycle:

- Create returns `segmentStatus: "PROCESSING"`. `actions/count` and
  `actions/deactivate` reject early calls with
  `INTERNAL_ERROR: We couldn't trigger async count` or `We couldn't publish your segment`. Poll status before action calls.
- `GET .../{apiName}` returns the record wrapped in a `segments[]` array.
- `DELETE .../{apiName}` returns 204 even while the segment is still
  PROCESSING.

## Identity resolution — `/ssot/identity-resolutions`

- Required: `label`, `description`, `configurationType`, `rulesetId`,
  `matchRules[]`, `reconciliationRules[]`, `doesRunAutomatically`.
- `configurationType` is enum-like: `individual` | `account`.
- Each `reconciliationRule` must carry a `ruleType`
  (`lastupdated` | `mostfrequent` | `sourcesequence`); omitting it can
  produce a server 500.
- `matchMethodType` values include `exact`, `exactnormalized`, `fuzzy`,
  `fuzzyhigh`, `fuzzylow`. Some API versions accept the upper-snake
  variants (`EXACT_NORMALIZED`); prefer lowercase when uncertain.

Prerequisite: the `entityName` DMOs must be **mapped** to source DLOs.
An unmapped target DMO returns
`INVALID_INPUT: Objects can only be used in identity resolution after required fields are mapped`,
which is feature gating, not a payload issue.

```json
{
  "label": "Email and Name Matching",
  "description": "Match individuals by email and name.",
  "configurationType": "individual",
  "rulesetId": "pid",
  "doesRunAutomatically": false,
  "matchRules": [
    {
      "label": "Normalized Email",
      "criteria": [
        {
          "entityName": "ssot__ContactPointEmail__dlm",
          "fieldName": "ssot__EmailAddress__c",
          "matchMethodType": "exactnormalized",
          "shouldMatchOnBlank": false
        }
      ]
    }
  ],
  "reconciliationRules": [
    {
      "entityName": "ssot__Individual__dlm",
      "ruleType": "mostfrequent",
      "shouldIgnoreEmptyValue": true
    }
  ]
}
```

## Semantic data model — `/ssot/semantic/models`

Multi-step. The Swagger Connect REST file does not include semantic-model
paths; treat them as a separate Data 360 surface.

1. Create the shell with `apiName`, `label`, `description`, `dataspace`.
2. The response includes subresource URLs
   (`semanticDataObjectsUrl`, `semanticCalculatedDimensionsUrl`,
   `semanticCalculatedMeasurementsUrl`,
   `semanticMetricsUrl`, `semanticGroupingsUrl`).
3. Add data objects with
   `POST /ssot/semantic/models/{apiName}/data-objects` using
   `{ "apiName", "label", "dataObjectType": "Dmo|Dlo|Cio",
"dataObjectName": "<dmo>__dlm" }`. The platform auto-discovers semantic
   dimensions from DMO fields.
4. Validate with `GET /ssot/semantic/models/{apiName}/validate`.
   `POST` to validate returns `METHOD_NOT_ALLOWED: GET,HEAD`.
5. `DELETE /ssot/semantic/models/{apiName}` returns 204; a subsequent GET
   returns `SemanticAuthoringError: Semantic object not found` with
   `errorName: "SEMANTIC_ENTITY_NOT_EXIST"`.

Shell create body:

```json
{
  "apiName": "AccountRevenue",
  "label": "Account Revenue Model",
  "description": "Semantic model for account and revenue analysis.",
  "dataspace": "default"
}
```

Add data object body:

```json
{
  "apiName": "Account_DO",
  "label": "Account",
  "dataObjectType": "Dmo",
  "dataObjectName": "ssot__Account__dlm"
}
```

## Search index — `/ssot/search-index`

- Required: `label`, `developerName`, `sourceDmoDeveloperName`,
  `chunkDmoName`, `chunkDmoDeveloperName`, `vectorDmoName`,
  `vectorDmoDeveloperName`, `chunkingConfiguration`,
  `vectorEmbeddingConfiguration.embeddingModel.id`.
- The org must have an embedding model artifact provisioned. Verify with
  `GET /ssot/machine-learning/model-artifacts`. Orgs that only have chat
  completion models cannot create search indexes.
- A missing required field returns a precise
  `INVALID_INPUT: Search index have following required fields [...]`
  which lists every missing field.

```json
{
  "label": "Case search index",
  "developerName": "Case_search_index",
  "sourceDmoDeveloperName": "ssot__Case__dlm",
  "chunkDmoName": "Case search index chunk",
  "chunkDmoDeveloperName": "Case_search_index_chunk",
  "vectorDmoName": "Case search index index",
  "vectorDmoDeveloperName": "Case_search_index_index",
  "vectorEmbeddingConfiguration": {
    "embeddingModel": { "id": "OpenAITextEmbeddingAda_002" }
  },
  "chunkingConfiguration": {
    "fieldLevelConfigurations": [
      {
        "sourceDmoDeveloperName": "ssot__Case__dlm",
        "sourceDmoFieldDeveloperName": "ssot__Subject__c",
        "decorators": [],
        "config": {
          "id": "passage_extraction",
          "userValues": [
            { "id": "strip_html", "value": "true" },
            { "id": "max_tokens", "value": "512" }
          ]
        }
      }
    ]
  }
}
```

## DataKit — `/ssot/data-kits`

- Required for create: `dataKitDevName`, `label`, `dataKitType`,
  `components[]`. `components` may be empty for an initial create.
- Response uses `devName`, not `dataKitDevName`.
- PATCH schema is `DataKitPatchInputRepresentation` and accepts only
  `components[]`. `label` and `dataKitType` are not patchable.
- DELETE 204; a subsequent DELETE on the same name returns
  `INTERNAL_SERVER_ERROR: PackageKitDefinition does not exist`.
- The list endpoint may not show recently-created datakits immediately.

Create:

```json
{
  "dataKitDevName": "ExampleKit",
  "label": "Example DataKit",
  "dataKitType": "None",
  "components": []
}
```

Patch (add components):

```json
{
  "components": [{ "name": "Revenue_By_Region__cio", "type": "CI", "action": "CREATE" }]
}
```

## Semantic engine query — `/semantic-engine/gateway`

Use `tableField` for fields on a semantic data object; use `semanticField`
for model-level calculated fields, dimensions, or metrics.

```json
{
  "semanticModelId": "MODEL_ID_OR_API_NAME",
  "structuredSemanticQuery": {
    "fields": [
      {
        "expression": { "tableField": { "tableName": "Account_DO", "name": "AccountName" } },
        "alias": "account_name"
      },
      {
        "expression": { "semanticField": { "name": "TotalRevenue" } },
        "alias": "total_revenue",
        "semanticAggregationMethod": "SEMANTIC_AGGREGATION_METHOD_SUM"
      }
    ],
    "options": { "limitOptions": { "limit": 10 } }
  }
}
```
