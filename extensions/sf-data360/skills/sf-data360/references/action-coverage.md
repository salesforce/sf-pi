# Data 360 Action Coverage and Recursive Validation

Operational reference for validating `sf-data360` against the broad Data 360
Connect REST surface. Read this when planning recursive coverage or before
shipping plugin/safety changes.

## Source order

1. Local `sf-data360` references in this directory.
2. Public upstream repo: <https://github.com/forcedotcom/d360-mcp-server>
   — `README.md` for facade rationale, `runtime/FamilyCatalog.java` for
   action families, `metadata/payload-examples.json` for payload source
   material.
3. Official Salesforce docs or web search only after local + upstream
   don't answer the question.

Do not run or embed the upstream Java MCP server from this extension.

## Design target

Data 360 exposes ~180 REST operations. `sf-data360` keeps three native
tools (`d360_probe`, `d360_metadata`, `d360_api`) instead of one tool per
endpoint. Upstream MCP solves the same problem with three facade tools
(`search`, `payload_examples`, `execute`); the equivalents here are:

| Upstream                  | sf-data360 equivalent                                                       |
| ------------------------- | --------------------------------------------------------------------------- | --------- | ------------ | -------------- |
| `search`                  | Read `endpoint-families.md`, `workflows.md`, upstream `FamilyCatalog.java`. |
| `payload_examples`        | Read `data-shapes.md`, `examples.md`, upstream `payload-examples.json`.     |
| `execute`                 | `d360_api` (with `dry_run: true` first for any mutation).                   |
| facade-discovered DMO/DLO | `d360_metadata list_dmos                                                    | list_dlos | describe_dmo | describe_dlo`. |

## Recursive validation recipe

1. Pass the disposable target org explicitly on every `d360_probe`,
   `d360_metadata`, and `d360_api` call.
2. Probe readiness; classify as `ready` / `ready_empty` / `partial` / `blocked`.
3. Build the family checklist from upstream `FamilyCatalog.java` + any local
   OpenAPI/Swagger file.
4. For each family:
   - One list/read endpoint with a small limit.
   - If non-empty, one detail GET.
   - Safe POST endpoints (query/search/validate/count/preview/test/predict)
     with small payloads.
   - `dry_run: true` for every create/update/delete/run/publish/deploy/
     undeploy/deactivate/cancel/retry/refresh/signing-key action.
   - Live mutating calls only with isolated test prefixes and a cleanup
     step that verifies removal.
5. Record results as `reachable | empty | feature_gated | not_found_optional |
dry_run_ok | skipped_needs_payload | failed`.
6. Treat empty collections and optional-feature 404s as coverage signals,
   not failures.

## Verified sweep summary (Connect REST v66.0, 194 ops)

| Outcome                           | Count |
| --------------------------------- | ----: |
| `passed` (live)                   |    46 |
| `dry_run_ok`                      |    93 |
| `feature_or_resource_unavailable` |    25 |
| `route_checked_payload_required`  |    18 |
| `transient_internal_error`        |    12 |
| `failed`                          |     0 |

Bar: every Swagger operation resolves to a normalized path, hits the
intended target org, and is classified live / safe-post / dry-run before
any network call.

## Verified live-mutation lifecycles

Each of these has been executed end-to-end on a disposable demo org and
cleaned up. Use as canonical proof patterns when extending the plugin or
the skill.

- **DMO** — `POST` (Connect REST shape: `category` uppercase, no
  `objectType`) → `GET` → `PATCH` (additive on `fields[]`) → `DELETE` →
  `ITEM_NOT_FOUND`.
- **Calculated insight** — `POST` (apiName ends `__cio`) → `GET` confirms
  `ACTIVE` → `POST .../actions/run` → `{"success":true}` → `DELETE` →
  `DELETING` (transient) → `ITEM_NOT_FOUND`.
- **Data action + target** — webhook target with minimal
  `config.targetEndpoint` → data action referencing it via
  `dataActionTargetNames[]` → cleanup data action first, then target →
  post-delete GET on the target may report
  `DataActionTarget Id can not be null or empty` (confirm via list).
- **Segment** — `segmentType: "Dbt"`, `segmentCreationFlow: "Visual"`,
  double-nested `includeDbt.models.models[]`, DBT SQL projecting
  unaliased fully-qualified primary key + key qualifier → `GET` returns
  `segments[0]` → `actions/count|deactivate` only after PROCESSING →
  `DELETE` → `ITEM_NOT_FOUND`.
- **Data stream (CRM)** — `datastreamType: "SFDC"` with
  `connectorInfo`+`dataLakeObjectInfo` → `GET` → `actions/run` rejects
  CRM in non-interactive mode (expected) → `DELETE` requires
  `?shouldDeleteDataLakeObject=true|false` → eventually-consistent
  `DataStream found null` confirmation.
- **Semantic data model** — shell create →
  `POST /ssot/semantic/models/{name}/data-objects` auto-discovers
  semantic dimensions from the source DMO → `validate` is `GET`, not
  `POST` → `DELETE` → `SEMANTIC_ENTITY_NOT_EXIST`.
- **DataKit** — create with `dataKitDevName`/`label`/`dataKitType`/
  `components[]` → response uses `devName` → `PATCH` accepts only
  `components[]` → `DELETE` → idempotent
  `PackageKitDefinition does not exist` on second `DELETE`.
- **Identity resolution** — feature gated: an unmapped target DMO returns
  `INVALID_INPUT: Objects can only be used in identity resolution after
required fields are mapped`. Validate IR payload in dry-run + readiness
  context only when the org has mapped profile DMOs.
- **Search index** — feature gated: requires
  `vectorEmbeddingConfiguration.embeddingModel.id` and an embedding
  model artifact in `GET /ssot/machine-learning/model-artifacts`.
  Chat-completion-only orgs cannot create search indexes.

## Safety expectations

A clean recursive run must prove these properties before broad live mutation:

- Explicit `target_org` on every call.
- Paths normalized to the active target API version.
- GET = read-only.
- POST safe-list narrow; unknown `actions/...` POSTs are confirmed.
- DELETE always confirmed.
- Large responses use `output_mode: "summary"` or `"file_only"`.
