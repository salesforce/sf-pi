# Data 360 Action Coverage and Recursive Validation

Use this reference when validating `sf-data360` against the broad Data 360 Connect REST surface.

## Source order

1. Local `sf-data360` references in this directory.
2. The public upstream repo: <https://github.com/forcedotcom/d360-mcp-server>.
   - Inspect `README.md` for the facade-tool rationale.
   - Inspect `src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java` for current action-family names.
   - Inspect `src/main/resources/metadata/payload-examples.json` for public example payload source material.
3. Official Salesforce docs or broader web search only after the local references and upstream repo do not answer the question.

Do not run or embed the upstream Java MCP server from this extension. Use it as public reference material for action families, workflow shape, and payload examples.

## Design target

Data 360 exposes roughly 180+ REST operations. `sf-data360` must not register one always-on Pi tool per operation. Keep the public surface small:

- `d360_probe` for read-only readiness.
- `d360_metadata` for compact DMO/DLO discovery.
- `d360_api` for direct REST execution with explicit method/path/query/body, API-version normalization, output controls, and safety classification.

The upstream MCP server reaches the same goal with three facade tools: `search`, `payload_examples`, and `execute`. In `sf-data360`, the equivalent flow is:

| Upstream concept   | `sf-data360` equivalent                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `search`           | Read `endpoint-families.md`, `workflows.md`, and upstream `FamilyCatalog.java`.                                                  |
| `payload_examples` | Read `examples.md`, `data-shapes.md`, and upstream `payload-examples.json`; rewrite examples into generic, public-safe payloads. |
| `execute`          | Call `d360_api` with `dry_run: true` first for mutating operations, then execute only against the intended target org.           |

## Recursive validation recipe

1. Choose a disposable Data 360 org and pass its alias explicitly on every call, including reads.
2. Run `d360_probe` and classify the org as `ready`, `ready-empty`, `partial`, or `blocked`.
3. Build the family checklist from upstream `FamilyCatalog.java` and the local OpenAPI/Swagger file if one is available.
4. For each family:
   - Run one list/read endpoint with a small limit.
   - If the list returns a record, run one detail read for that record.
   - Run safe POST endpoints only when the payload is small and read-like: query, search, validate, count, preview, connection test, or prediction.
   - Run `dry_run: true` for create, update, delete, run, publish, deploy, undeploy, enable, disable, deactivate, cancel, retry, clone, signing-key, extract, and generate actions.
   - Execute mutating actions only when the test creates isolated resources with a unique test prefix and has a cleanup step.
5. Record each action as one of: `reachable`, `empty`, `feature_gated`, `not_found_optional`, `dry_run_ok`, `skipped_needs_payload`, `failed`.
6. Treat empty collections and optional feature 404s as coverage signals, not automatic failures.

## Family checklist

Use approximate counts only; upstream action counts can drift between releases.

- Query and metadata — SQL/query status/rows/cancel, metadata search, metadata entities, profile, calculated insight query, and data graph query.
- DMO and DLO — list, get, create, update, delete.
- Mappings and standard mappings — DLO-to-DMO mappings, field mapping changes, standard mapping preview/create.
- Data streams — generic streams plus connector-specific stream create/run/read/update/delete.
- Connections — connector catalog, connection CRUD, test actions, endpoint/object/schema/preview discovery.
- Calculated insights — CRUD, validate, run, status, enable/disable where available.
- Identity resolution — CRUD, publish, run-now.
- Segments — CRUD, count, publish, deactivate.
- Data spaces — spaces plus member management.
- Activations — activation and activation target CRUD plus publish/data reads.
- Data transforms — CRUD, validate, run, schedule, status/cancel/retry actions.
- DataKit — list/get/manifest, deploy, undeploy, status, dependency and component reads.
- Data actions — action and target lifecycle, including signing-key generation where available.
- Semantic data models — model lifecycle, data objects, relationships, dimensions, measurements, calculated fields, metrics, permissions, validation, semantic query.
- Search index and retrievers — lifecycle, config/version reads, process history, query where available.
- Machine learning, Document AI, Data Clean Room, Data Graphs, Private Network Routes, Universal ID Lookup — validate with the OpenAPI/Swagger file and treat feature-gated surfaces as optional unless the org is expected to have them.

## Verified sweep summary

A full Swagger-driven sweep of all 194 operations in `Salesforce Data 360
Connect REST API v66.0` against a populated demo org produced:

- 46 live `GET`/safe `POST` calls passed.
- 93 mutating operations passed dry-run validation (path, target org, API
  version, and safety classification verified).
- 25 operations marked as feature/resource not present in the org (empty
  collections or `NOT_FOUND` on optional surfaces).
- 18 operations reachable but require structured payload parameters
  (filters, discriminators, or required fields).
- 12 operations returned org-side `INTERNAL_ERROR`/`UNKNOWN_EXCEPTION`
  tied to feature gating (connection schema/sitemap/preview, datakit
  available-components/manifest, data-graphs without field IDs).
- 0 plugin-side failures.

This is the bar for "recursive validation passes": every Swagger operation
resolves to a normalized path, hits the intended target org, and is
classified as live/safe-post/dry-run before any network call.

## Live mutation lifecycle proof

For end-to-end mutation coverage in a disposable demo org, run a single
DMO lifecycle and confirm cleanup:

1. `POST /ssot/data-model-objects` with the Swagger
   `DataModelObjectInputRepresentation` shape (`category` uppercase,
   `dataType` per field, no `objectType`).
2. `GET /ssot/data-model-objects/{name}__dlm` to verify the
   auto-suffixed identifier and the system-managed fields.
3. `PATCH /ssot/data-model-objects/{name}__dlm` to update label,
   description, and append a new field. PATCH is additive: existing
   fields are not removed by omitting them.
4. `DELETE /ssot/data-model-objects/{name}__dlm` to clean up. A
   subsequent GET returns `ITEM_NOT_FOUND`.

Use a unique, sandbox-only prefix (for example `Pi_D360_Sweep`) and run
this pattern only against orgs the user has marked disposable. Verify
before and after via `GET` or `d360_metadata describe_dmo`.

Three additional lifecycles have been verified end-to-end through the
`d360_api` execution path:

- **Calculated insight** — `POST /ssot/calculated-insights` (apiName ends
  in `__cio`) → `GET` confirms `ACTIVE` →
  `POST /ssot/calculated-insights/{apiName}/actions/run` returns
  `{ "success": true }` → `DELETE` 204 → follow-up GET briefly returns
  `calculatedInsightStatus: "DELETING"` then `ITEM_NOT_FOUND`.
- **Data action + target** — `POST /ssot/data-action-targets`
  (`type: "WebHook"`, minimal `config.targetEndpoint`) →
  `POST /ssot/data-actions` referencing that target via
  `dataActionTargetNames[]` → cleanup runs the data action DELETE first,
  then the target DELETE. After deletion, GET on the target apiName may
  return `DataActionTarget Id can not be null or empty`; confirm with a
  filtered list.
- **Segment** — `POST /ssot/segments` with `segmentType: "Dbt"`,
  `segmentCreationFlow: "Visual"`, double-nested
  `includeDbt.models.models[]`, and SQL that projects unaliased
  fully-qualified primary key and key qualifier of the segmentOn entity
  → read via `GET .../segments/{name}` (response wraps in `segments[0]`)
  → `actions/count` and `actions/deactivate` only work after the
  segment leaves `PROCESSING` → `DELETE` 204 → `ITEM_NOT_FOUND`.

## Safety expectations

A recursive run should prove these design properties before executing broad live tests:

- Every call includes an explicit intended target org.
- API paths are normalized to the active target API version.
- GET requests are read-only.
- Read-like POST requests are safe-listed narrowly.
- Unknown or operational `POST .../actions/...` requests are confirmed or dry-run only by default.
- DELETE always requires confirmation.
- Large responses use `output_mode: "summary"` or `"file_only"`.
