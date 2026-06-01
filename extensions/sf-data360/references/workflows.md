# SF Data 360 Workflows

## Read-only smoke test matrix

Use this when validating whether Data 360 surfaces are reachable without creating, editing, deleting, publishing, deploying, or running ingestion.

1. Run `d360_probe` and classify each sampled surface as populated, empty, gated, not found, or failed.
2. For populated list endpoints, select one returned identifier and run the matching single-resource `GET`.
3. For DMOs/DLOs, use `d360_metadata` list/describe first, then run `COUNT(*)` before any row sampling.
4. For semantic models, follow the URLs returned by the model detail response for read-only subresources such as data objects, relationships, calculated measurements, and parameters.
5. Record empty endpoints as reachable-empty, not failed. Record `NOT_FOUND` on optional surfaces such as search indexes or retrievers as feature/path unavailable unless a core dependency also fails.

Suggested read-only coverage:

| Family                       | List/read probe                                                      | Optional detail probe                                                   |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Data spaces                  | `GET /ssot/data-spaces`                                              | `GET /ssot/data-spaces/{name}`                                          |
| DMO/DLO catalog              | `d360_metadata list_dmos/list_dlos`                                  | `d360_metadata describe_dmo/describe_dlo`                               |
| Query plane                  | `POST /ssot/query-sql` with `COUNT(*)`                               | `GET /ssot/query-sql/{queryId}` and `/rows` only when async             |
| Mappings                     | `GET /ssot/data-model-object-mappings?dmoDeveloperName={dmo}`        | `GET /ssot/data-model-object-mappings/{mappingName}` when returned      |
| Streams                      | `GET /ssot/data-streams?limit=1`                                     | `GET /ssot/data-streams/{name}`                                         |
| Connectors/connections       | `GET /ssot/connectors`, `GET /ssot/connections?connectorType={type}` | `GET /ssot/connectors/{catalogName}`, `GET /ssot/connections/{id}`      |
| Calculated insights          | `GET /ssot/calculated-insights`                                      | `GET /ssot/calculated-insights/{apiName}`                               |
| Segments/activations/actions | List endpoints with small limits                                     | Detail reads only when list returns IDs                                 |
| Transforms                   | `GET /ssot/data-transforms?limit=1`                                  | `GET /ssot/data-transforms/{id}`                                        |
| Semantic models              | `GET /ssot/semantic/models?limit=1`                                  | `GET /ssot/semantic/models/{idOrApiName}` and returned subresource URLs |
| DataKits                     | `GET /ssot/data-kits`                                                | Manifest reads only after verifying the accepted identifier/path        |
| Search indexes/retrievers    | List endpoints                                                       | Treat `NOT_FOUND` as optional-surface unavailable                       |

## Recursive family validation

Use this when validating the broad 180+ operation surface.

1. Read `action-coverage.md` and build a checklist from the public upstream
   `FamilyCatalog.java` plus any local OpenAPI/Swagger file.
2. Pass the intended target org explicitly on every `d360_api`, `d360_metadata`,
   and `d360_probe` call. Do not rely on the default org during recursive tests.
3. Start every family with read-only list/detail coverage and safe POSTs such as
   query, search, validate, count, preview, prediction, and connection test.
4. For every create/update/delete/run/publish/deploy/undeploy/deactivate/cancel/retry/signing-key
   action, first call `d360_api` with `dry_run: true` and verify the resolved
   target org, API version, path, and safety level.
5. Execute mutating calls only in disposable orgs with isolated test resources and cleanup steps.
6. Record results as `reachable`, `empty`, `feature_gated`, `not_found_optional`, `dry_run_ok`, `skipped_needs_payload`, or `failed`.

## Explore before querying

1. Search metadata with `/connect/search/metadata/results`.
2. Fetch one entity's metadata with `/ssot/metadata` using `entityName`.
3. Run a small `/ssot/query-sql` query with `rowLimit`.
4. Use query status and rows endpoints for pagination when needed.

## Create or update a mapping

1. Get source DLO schema: `GET /ssot/data-lake-objects/{dloName}`.
2. Get target DMO schema: `GET /ssot/data-model-objects/{dmoName}`.
3. Preview or inspect examples for mapping payload shape.
4. Use `dry_run: true` for the create/update call.
5. Create or update mapping only after field API names are verified.

## Create a calculated insight

1. Discover referenced DMO/CI fields.
2. Draft SQL with fully qualified field names.
3. Validate with `POST /ssot/calculated-insights/actions/validate`.
4. Create or update the CI.
5. Run or enable only after validation succeeds.
6. Check run/status before using the CI in segments.

## Create a data stream

1. List connectors and connector metadata.
2. List or test the connection.
3. Inspect target DMO and mapping requirements.
4. Prefer connector-specific create shapes when available.
5. Dry-run the create request.
6. Trigger ingestion only after create succeeds and dependencies are verified.

## Work with semantic data models

1. Create or locate the semantic model shell.
2. Add data objects.
3. List dimensions/measurements to get semantic field names.
4. Add relationships using semantic field names, not raw DMO field names.
5. Add calculated dimensions/measures and metrics.
6. Validate the model before semantic queries.

## Recovery loop

When a REST call fails:

1. Read the error body carefully.
2. Re-read the relevant reference/example file.
3. Fetch current resource state with a GET call.
4. Retry with the smallest corrected payload.
5. If the response is too large, request fewer rows or use pagination.
