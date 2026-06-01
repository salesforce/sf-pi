<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Harmonize Reference

Model, map, and unify data into harmonized entities.

## Use this reference when

Data 360 Harmonize phase. Use when managing DMOs, mappings, standard mappings, identity resolution, smart mapping helpers, or semantic model definitions with sf-data360 tools.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- **DMO** — Read Data Model Object catalog and schemas.
- **Identity Resolution** — Inspect identity resolution rulesets and profile unification setup.
- **Mappings** — Inspect DLO-to-DMO mappings and field mappings.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.
- **Smart** — Local helper algorithms for field matching, mapping suggestions, and data stream payload enhancement.
- **StandardMappings** — Create standard DLO-to-DMO mappings from predefined mapping definitions.

- Capabilities: 46 (0 runbook-backed)
- Safety mix: read=7, safe_post=5, confirmed=24, destructive=10

## Data 360 family actions

- `data360_harmonize` `dmo_mapping.get` (rest_operation, read) — Get one DLO-to-DMO mapping configuration.
- `data360_harmonize` `dmo_mapping.list` (rest_operation, read) — List DLO-to-DMO mappings. Prefer filtering by DMO or source object.
- `data360_harmonize` `dmo.get` (rest_operation, read) — Get one Data Model Object schema.
- `data360_harmonize` `dmo.list` (rest_operation, read) — List Data Model Objects.
- `data360_harmonize` `identity.list` (rest_operation, read) — List identity resolution rulesets.
- `data360_harmonize` `ir.get` (rest_operation, read) — Get one identity resolution ruleset by id.
- `data360_harmonize` `ir.list` (rest_operation, read) — List identity resolution rulesets.
- `data360_harmonize` `event_date_recommend` (rest_operation, safe_post) — Recommend the best event date field for engagement streams.

## Cross-phase routing

| Phase       | Reference                          | Summary                                                      |
| ----------- | ---------------------------------- | ------------------------------------------------------------ |
| Connect     | `references/phases/connect.md`     | Set up and inspect Data 360 source connectivity.             |
| Prepare     | `references/phases/prepare.md`     | Prepare raw data structures and ingestion pipelines.         |
| Harmonize   | `references/phases/harmonize.md`   | Model, map, and unify data into harmonized entities.         |
| Segment     | `references/phases/segment.md`     | Build and inspect audience segments and calculated insights. |
| Act         | `references/phases/act.md`         | Deliver audiences and data-triggered actions downstream.     |
| Retrieve    | `references/phases/retrieve.md`    | Query, search, and inspect Data 360 data and metadata.       |
| Observe     | `references/phases/observe.md`     | Analyze Agentforce sessions and platform traces in Data 360. |
| Orchestrate | `references/phases/orchestrate.md` | Plan and troubleshoot cross-phase Data 360 workflows.        |

## Upstream reference fallback

If this generated reference and the local sf-data360 references are insufficient, inspect the public upstream Data 360 MCP server repository for reference material. Do not run or embed the upstream Java MCP server from this extension.
