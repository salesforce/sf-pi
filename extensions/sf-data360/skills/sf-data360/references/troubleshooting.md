# SF Data 360 Troubleshooting

Each entry: symptom → cause → fix. Lifecycle-shape gotchas live in
`references/data-shapes.md`; this file covers cross-cutting failures.

## Auth and CLI

- **`sf` returns auth error.** Run `sf org login web --set-default --alias my-sandbox`. Then retry the `d360_api` call or pass `target_org` explicitly.
- **Raw `sf api request rest` rejected `--json`.** Don't pass `--json` for that subcommand; pipe stdout to `jq` and ignore beta warnings on stderr.
- **Raw DELETE failed with `No 'mode' found in 'body' entry`.** Some sf CLI versions need a body for DELETE. `d360_api` already sends `{}`. Raw fallback: `--body '{}'`.

## Output size and discovery

- **Endpoint returned too much data.** Use `output_mode: "summary"` or `"file_only"`. Add `limit`/`rowLimit`/`offset`/`batchSize` query parameters.
- **Metadata request is too broad.** Prefer `d360_metadata` `list_dmos`/`list_dlos` and `describe_dmo`/`describe_dlo`. Do not call `/ssot/data-model-objects` broadly. For other entities, use `POST /connect/search/metadata/results` or `GET /ssot/metadata-entities`.
- **Optional surface returns `NOT_FOUND`.** Search index, retrievers, some DataKit manifest paths can be absent in healthy orgs. Treat as feature gating unless core probes also fail.
- **DLO category filter returns no rows.** `list_dlos` filters on compact metadata categories from `/ssot/metadata-entities`, which can differ from detailed DLO categories. Retry without the category filter and inspect the helper output.

## Mapping list and connector lookup

- **Mapping list fails unfiltered.** Pass `dmoDeveloperName=<name>__dlm` or `sourceObjectName=<name>__dll`.
- **Connector detail returns `NOT_FOUND`.** Use the catalog `name` from `GET /ssot/connectors`, not a connection's `connectorType`. For example a Salesforce CRM connection lists `connectorType=SalesforceDotCom` while connector metadata is under `SalesforceCRM`.

## Connection action endpoints

- **`POST /ssot/connections/actions/test` returns `connectorType is required`.** Pass `connectorType` in the body, not only as a query parameter. Connection test also requires `method: "Ingress"|"Egress"` and per-parameter `paramName`+`value` pairs.
- **`/database-schemas`, `/databases`, `/objects/.../preview`, `/actions/test` return `INTERNAL_ERROR: Unable to query…`.** These surfaces are JDBC-shaped-connector only. Salesforce CRM and similar non-JDBC connections fail through these paths by design.
- **`/connections/{id}/schema` or `/sitemap` returns enum/parameter errors.** These are Web/website-connector specific. Do not retry on other connector kinds.
- **`/connections/{id}/endpoints` returns `INTERNAL_SERVER_ERROR`.** The connector lacks an OpenAPI definition; not a plugin issue.

## Query plane

- **`/ssot/query` or `/ssot/queryv2` returns `Unrecognized field "query"`.** Both endpoints accept `{ "sql": "..." }`. There is no `query` field on Connect REST query bodies.
- **`/ssot/profile/{name}` rejects `filter=...`.** The plural `filters` query parameter and bracketed equality syntax are required: `filters=[Field__c=Value]`. Combine with `fields=` to limit columns.
- **`/ssot/profile/{name}/{id}` returns `orderby is required with offset`.** Always pair `offset` with `orderby`.
- **`/ssot/calculated-insights/{name}` returns `apiName must end in __cio`.** Provide a CI apiName ending `__cio`.

## Lifecycle quirks

- **`DELETE /ssot/data-streams/{name}` returns `MALFORMED_QUERY: shouldDeleteDataLakeObject`.** Add the query parameter explicitly: `?shouldDeleteDataLakeObject=true|false`.
- **`POST /ssot/data-streams/{name}/actions/run` rejects `SalesforceDotCom`.** CRM streams cannot be run from the API in non-interactive mode; trigger from the UI.
- **`POST /ssot/semantic/models/{name}/validate` returns `METHOD_NOT_ALLOWED: GET,HEAD`.** Validate is GET for semantic models, not POST.
- **`POST /ssot/data-transforms-validation` returns `TARGET_DLO_NOT_FOUND` or `DLO_NAME_DOES_NOT_EXIST: ... neither exists nor can be created`.** Pre-create the output DLO that the STL `outputD360` node references, then re-validate.
- **`PUT /ssot/data-transforms/{name}/schedule` rejects `timezone` field.** Use camelCase `timeZone`. The Swagger lists only `frequency`+`time` as required; the platform also requires `interval` (1–31). Use `frequency: "None"` to clear the schedule.
- **`POST /ssot/data-model-object-mappings` returns auto-inflated `fieldMappings[]`.** Expected: the platform adds system field mappings (DataSource, DataSourceObject, InternalOrganization, KQ\_\*) on top of explicit ones. Do not echo system mappings back.
- **`PATCH /ssot/data-model-object-mappings/{name}/field-mappings/{field}` does not insert.** That endpoint updates an existing field mapping by developer name. To add a new mapping, recreate the parent mapping with the full set.
- **`DELETE /ssot/data-model-object-mappings/{name}/field-mappings` returns `Field Source Target Name is missing`.** No zero-argument bulk wipe; identify a specific field mapping.
- **`DELETE /ssot/data-model-object-mappings/{name}` returns `DMO is mapped to only one DLO ... cannot be removed`.** Orphan-protection. Cleanup workaround: `DELETE` the target DMO instead; the platform cascades and removes the mapping.
- **`POST /ssot/data-lake-objects` returns `Data Lake fields cannot start with KQ_`.** The `KQ_` prefix is reserved for key qualifiers. Drop it; the platform auto-generates `KQ_<name>__c` for fields you mark `isPrimaryKey: true`.
- **`POST /ssot/segments/{name}/actions/count|deactivate` returns `INTERNAL_ERROR: We couldn't trigger…`.** The segment is still `PROCESSING`. Poll status before action calls.
- **CI GET returns `DELETING` after a DELETE.** Async delete; both `DELETING` (transient) and `ITEM_NOT_FOUND` count as successful cleanup.
- **Data action target GET returns `Id can not be null or empty` after delete.** The path expects an internal id, not apiName, on that code path. Confirm cleanup with the filtered list call.
- **Second DataKit DELETE returns `INTERNAL_SERVER_ERROR: PackageKitDefinition does not exist`.** Idempotent error; the kit is gone.
- **DataKit list does not show a freshly-created kit.** List visibility is delayed; verify with the create response or DELETE for cleanup.
- **`PATCH /ssot/data-kits/{name}` rejects `dataKitDevName` or `label`.** PATCH only accepts `components[]`. Recreate the kit to change the label/type.
- **Identity resolution create fails with `Objects can only be used in identity resolution after required fields are mapped`.** Feature gating, not a payload issue. Map source DLOs to the target profile DMOs first.
- **Search index create fails with `INVALID_INPUT: required fields [...] vectorEmbeddingConfiguration.embeddingModel.id`.** The org needs an embedding model artifact. Verify with `GET /ssot/machine-learning/model-artifacts`. Chat-completion-only orgs cannot create search indexes.

## Schema-shape gotchas

- **`POST /ssot/data-model-objects` rejects `objectType` or `Profile` (titlecase).** Connect REST takes uppercase enum (`PROFILE|ENGAGEMENT|OTHER`) and uses `dataType` per field. Drop `objectType`/`objectCategory` from upstream MCP examples.
- **DMO PATCH does not remove omitted fields.** PATCH is additive. Recreate the DMO to drop a field.
- **Segment `segmentType: "Ui"` rejected.** Use the current enum: `Dbt|Dynamic|EinsteinGptSegmentsUI|Lookalike|Realtimez|Waterfall`.
- **Segment `includeDbt.models[]` flat array rejected with `unexpected array`.** Wrap in `includeDbt.models.models[]`.
- **DBT model SQL aliases rejected.** Use unaliased fully-qualified identifiers in the primary projection and project the primary key plus key qualifier.
- **`POST /ssot/machine-learning/predict` returns `JSON_PARSER_ERROR ... missing property 'type'`.** Polymorphic body needs a `type` discriminator.

## Mutation safety

- **Mutating call blocked.** Re-run with `dry_run: true` and review the safety decision. Run interactively so the confirmation dialog can appear, or set `SF_D360_ALLOW_HEADLESS_WRITE=1` only for vetted automation.
