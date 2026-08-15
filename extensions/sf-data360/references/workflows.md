# SF Data 360 V2 Workflows

## Read-only smoke matrix

Use this matrix to verify reachability without creating, editing, deleting, publishing, deploying, or running ingestion.

1. Run `data360_discover readiness.probe`.
2. Use `actions.search` and `action.describe` when an action contract is unclear.
3. Run one bounded list/read action through the owning family.
4. When populated, select one returned identifier and run the matching detail action.
5. Record empty and optional-feature results separately from failures.

| Phase     | Bounded list/read                                                                             | Optional detail                                                  |
| --------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Prepare   | `data360_prepare dataspace.list`, `dlo.list`, `stream.list`, `transform.list`, `datakit.list` | matching `*.get` action                                          |
| Harmonize | `data360_harmonize dmo.list`, `dmo_mapping.list`, `ir.list`                                   | matching `*.get` action                                          |
| Segment   | `data360_segment ci.list`, `segment.list`                                                     | matching `*.get` action                                          |
| Activate  | `data360_activate activation.list`, `activation_target.list`, `data_action.list`              | matching `*.get` action                                          |
| Query     | `data360_query metadata.entities` or bounded `sql.run` with `COUNT(*)`                        | `metadata.get`, `sql.status`, `sql.rows`                         |
| Semantic  | `data360_semantic semantic_model.list`, `search_index.list`, `retriever.list`                 | matching `*.get` action                                          |
| Observe   | bounded `stdm.find_sessions` or latency/error summary with an explicit time/session filter    | `stdm.session_timeline`, `stdm.session_otel`, `trace.trace_tree` |

Treat a not-found optional search index, retriever, model, or trace surface as feature/path evidence unless a core dependency also fails.

## Recursive family validation

1. Read [`action-coverage.md`](./action-coverage.md).
2. Build the checklist from `registry/v2/actions.json`, grouped by owning `data360_*` family.
3. Pass the intended non-production `target_org` explicitly.
4. Start each family with discovery, one bounded read, and safe-post validation where fixtures exist.
5. For every confirmed or destructive action, run `dry_run: true` or the matching plan first and verify target, API version, endpoint/action, safety, and cleanup ownership.
6. Execute only against sweep-owned resources with Guardrail approval and deterministic cleanup.
7. Persist action coverage and artifacts without treating optional org features as universal failures.

## Explore before querying

1. Use `data360_query metadata.search` or `metadata.entities`.
2. Inspect one entity with `metadata.get`, `dmo_describe`, or `dlo_describe`.
3. Run `data360_query sql.run` with `COUNT(*)` or a small `LIMIT`.
4. Use `sql.status` and `sql.rows` only when the initial action returns an asynchronous query id.

## Create or update a mapping

1. Inspect the source with `data360_prepare dlo.get` or `data360_query dlo_describe`.
2. Inspect the target with `data360_harmonize dmo.get` or `data360_query dmo_describe`.
3. Use `data360_harmonize standard_mapping.preview`, `preview_field_matches`, or `smart_mapping.suggest` when applicable.
4. Review `dmo_mapping.create` or `dmo_mapping.update` with `dry_run: true`.
5. Execute only after exact field names and compatible types are verified.

## Create a calculated insight and segment

1. Verify referenced DMO fields.
2. Draft fully qualified calculated-insight SQL.
3. Run `data360_segment ci.validate` before `ci.create` or `ci.update`.
4. Check CI run/status before using it in `segment.create`.
5. Use `data360_orchestrate build_segment.plan` before a multi-step build.
6. Publish only after counts and status are verified.

## Create a data stream

1. Use `data360_connect connector.list`, `connector.metadata`, and `connection_test` as applicable.
2. Inspect source fields and target DMO/mapping requirements.
3. Use a connector-specific `data360_prepare stream.create*` action.
4. Review with `dry_run: true`.
5. Run ingestion only after the stream and dependencies exist.

## Work with semantic models

1. Create or locate the semantic model shell.
2. Add data objects through `semantic_model.data_object.create`.
3. List dimensions and measurements before relationships or metrics.
4. Use semantic field names, not guessed raw DMO fields.
5. Run `semantic_model.validate` before `semantic_model.query` or downstream retrieval.
6. Use `data360_orchestrate semantic_retrieval.plan` for a multi-step search-index/retriever workflow.

## Recovery loop

1. Read the bounded error and artifact pointers.
2. Re-run `action.describe` for the failed action.
3. Fetch current resource state through the owning family.
4. Retry with the smallest corrected payload or narrower query.
5. Use `data360_api rest.request` only when no family action covers the verified endpoint.
