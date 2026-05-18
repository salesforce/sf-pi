# Data 360 Facade Coverage and Safe Execution

This reference summarizes what the `d360` facade currently exposes, how to use
confirmed operations safely, and what to check before each mutating family.

The facade intentionally keeps the Pi tool surface small. New endpoint coverage
should be added to the JSON registry, not as new Pi tools.

## Operation coverage matrix

Current generated registry size: **164 operations**.

| Family                 | Read | Safe POST | Confirmed | Destructive |
| ---------------------- | ---: | --------: | --------: | ----------: |
| Query                  |    2 |         1 |         0 |           0 |
| Metadata               |    5 |         1 |         0 |           0 |
| Agent Observability    |    0 |         0 |         0 |           0 |
| Segment                |    2 |         0 |         4 |           0 |
| Activation             |    4 |         0 |         4 |           0 |
| Calculated Insights    |    3 |         1 |         5 |           0 |
| Ingestion              |    3 |         0 |         0 |           0 |
| Transforms and Actions |    2 |         0 |         0 |           0 |
| Identity Resolution    |    3 |         0 |         5 |           0 |
| Semantic Retrieval     |   30 |         3 |        19 |           0 |
| DataKit                |    7 |         0 |         0 |           0 |
| DMO                    |    2 |         0 |         2 |           0 |
| DLO                    |    2 |         0 |         2 |           0 |
| Mappings               |    2 |         0 |         3 |           0 |
| DataStreams            |    2 |         0 |         6 |           0 |
| Connection             |    6 |         1 |         3 |           0 |
| Dataspace              |    3 |         0 |         3 |           0 |
| DataTransform          |    3 |         1 |         4 |           0 |
| DataAction             |    4 |         0 |         3 |           0 |
| Profile and Data Graph |    8 |         0 |         0 |           0 |

Destructive operations are intentionally omitted until the facade has explicit
review workflows for delete/deploy/undeploy style actions.

## Confirmed operation workflow

For any operation with `safety: "confirmed"`:

1. Search for the operation by intent.
2. Fetch the example payload.
3. Execute with `dry_run: true` and inspect the resolved request.
4. Only after review and clear user intent, execute with `allow_confirmed: true`.

Dry-run example:

```json
{
  "action": "execute",
  "operation": "d360_segment_publish",
  "target_org": "AgentforceSTDM",
  "dry_run": true,
  "params": {
    "segmentId": "ExampleSegmentId"
  }
}
```

Explicit execution example:

```json
{
  "action": "execute",
  "operation": "d360_segment_publish",
  "target_org": "AgentforceSTDM",
  "allow_confirmed": true,
  "params": {
    "segmentId": "ReviewedRealSegmentId"
  }
}
```

Never add `allow_confirmed: true` to a placeholder payload.

## Family pre-flight checklist

### Calculated Insights

1. Verify source DMO/CIO fields with `d360_metadata describe_dmo` or
   `d360 execute d360_dmo_get`.
2. Run `d360_ci_validate` with the candidate SQL.
3. Dry-run create/update/run/enable/disable.
4. Execute only after the SQL, `apiName`, and dependencies have been reviewed.

### Segments

1. Verify segment-on DMO and referenced CI/DMO fields.
2. Confirm prerequisite CIs are active when the segment depends on them.
3. Dry-run create/update/publish/deactivate.
4. Use API name for deactivate and internal id for publish/update when required.

### Activations and Activation Targets

1. Verify segment status and activation target requirements.
2. Verify connection/connector target details before target create/update.
3. Dry-run activation target create/update before activation create/update.
4. Avoid destructive activation cleanup in the facade until delete operations have
   a dedicated review flow.

### Data Transforms

1. Validate with `d360_transform_validate` before create/update.
2. Verify source and target DLO/DMO names.
3. Dry-run create/update/schedule/run.
4. Treat run and schedule changes as operational: they can consume compute and
   update downstream data.

### Data Actions

1. Create or verify a data action target first.
2. Distinguish data action targets from activation targets.
3. Verify source objects, conditions, projected fields, and target names.
4. Dry-run data action and target create/update.

### Identity Resolution

1. List/get existing rulesets before changing them.
2. Verify source DMOs, matching fields, match methods, and reconciliation rules.
3. Prefer PATCH update over full replacement unless you have compared the full
   current ruleset definition.
4. Dry-run create/update/full-update/publish/run. Publish and run operations can
   update unified profile behavior and consume compute.

### Search Indexes and Retrievers

1. Call `d360_search_index_config` before search index create/update.
2. Verify source DMO, chunk DMO, vector DMO, embedding config, and transform
   config ids.
3. List/search indexes before retriever create.
4. For retriever configurations, verify `queryType`, input search index,
   output fields, and `isActive` behavior.

### Semantic Data Models

1. Create the semantic model shell first, then add data objects and relationships.
2. Verify every referenced DMO, DLO, CIO, data object, field, metric, and
   relationship id before mutation.
3. Use `d360_sdm_formula_metadata` before calculated dimensions or calculated
   measurements.
4. Use `d360_sdm_validate` before semantic queries or downstream BI/RAG use.
5. Dry-run create/update/clone/data-object/calculated-field/metric/relationship
   operations. Delete operations remain omitted until destructive review UX
   exists.

### Dataspaces

1. List/get the existing data spaces first.
2. Confirm naming, ownership, and whether downstream assets need explicit
   dataspace references.
3. For member changes, verify member names and filter configuration before
   granting access.
4. Dry-run create/update/member-add. Dataspace delete and member remove remain
   omitted until destructive review UX exists.

### Data Streams

1. List/test the connection first.
2. Inspect connector metadata for source-specific required parameters.
3. Verify source fields, DLO fields, mappings, refresh mode, category, and
   engagement event date field when applicable.
4. Dry-run connector-specific create operations where possible.
5. Remember Salesforce CRM streams cannot be manually triggered.

### DMO, DLO, and Mappings

1. Describe the source DLO and target DMO before creating mappings.
2. Verify exact field API names and compatible field types.
3. For DMO create, do not include the `__dlm` suffix in body `name`.
4. For Engagement objects, verify the event date/time field.
5. Dry-run schema and mapping changes; these can affect data streams,
   calculated insights, segments, search indexes, and activations.

### Connections

1. Inspect connector metadata.
2. Run `d360_connection_test` when a test endpoint supports the connector.
3. Dry-run create/update.
4. For Snowflake, pass private key content only when actually executing and only
   after reviewing the resolved request shape. Keep docs/examples placeholder-only.

## Expansion rule for the 190-operation goal

To grow toward the full upstream Data 360 operation surface:

1. Add read-only operations first.
2. Add validation/test/search/query safe POST operations second.
3. Add non-destructive confirmed lifecycle operations third.
4. Add destructive operations last, only with explicit review UX and tests.

Every confirmed operation must have:

- `requiredParams`
- `tips`
- a public-safe example payload in `examples.json`

Every destructive operation must remain absent until a stricter policy is added.
