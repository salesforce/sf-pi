<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Harmonize Reference

Model, map, and unify data into harmonized entities.

## Use this reference when

Data 360 Harmonize phase. Use when managing DMOs, mappings, standard mappings, identity resolution, smart mapping helpers, or semantic model definitions with sf-data360 tools.

## Tool discipline

1. Use `sf_data360` with an action in this business namespace.
2. Use `discover.action.search` when the exact action is unclear.
3. Use `discover.action.describe` and `discover.action.example` before complex mutations.
4. Use `dry_run: true` before mutations and review the resolved request.
5. Use `api.request` only as the exact REST escape hatch when no named action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested business actions or orchestrated journeys.

## Phase coverage

- **DMO** — Read Data Model Object catalog and schemas.
- **Data Governance** — Inspect Data 360 policies, classifications, taxonomies, tags, assignments, and governance jobs.
- **Identity Resolution** — Inspect identity resolution rulesets and profile unification setup.
- **Mappings** — Inspect DLO-to-DMO mappings and field mappings.
- **Semantic Retrieval** — Inspect retrievers, search indexes, and semantic data models for RAG and BI.
- **Smart** — Local helper algorithms for field matching, mapping suggestions, and data stream payload enhancement.
- **StandardMappings** — Create standard DLO-to-DMO mappings from predefined mapping definitions.

- Capabilities: 123 (0 runbook-backed)
- Safety mix: read=33, safe_post=5, confirmed=57, destructive=28

## Data 360 family actions

- `sf_data360` `harmonize.dmo_mapping.get` (harmonize, rest_operation, read) — Get mapping configuration.
- `sf_data360` `harmonize.dmo_mapping.list` (harmonize, rest_operation, read) — List mappings by DMO name or CRM source.
- `sf_data360` `harmonize.dmo.get` (harmonize, rest_operation, read) — Get full DMO schema including all fields.
- `sf_data360` `harmonize.dmo.list` (harmonize, rest_operation, read) — List all Data Model Objects. Filter by category.
- `sf_data360` `harmonize.dmo.relationship.list` (harmonize, rest_operation, read) — Get field source target relationships
- `sf_data360` `harmonize.governance.access_policy.get` (harmonize, rest_operation, read) — Get access policy
- `sf_data360` `harmonize.governance.access_policy.list` (harmonize, rest_operation, read) — Get access policies
- `sf_data360` `harmonize.governance.access_policy.rule.get` (harmonize, rest_operation, read) — Get access policy rule

## Cross-phase routing

| Phase       | Reference                          | Summary                                                                               |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| Connect     | `references/phases/connect.md`     | Set up and inspect Data 360 source connectivity.                                      |
| Prepare     | `references/phases/prepare.md`     | Prepare raw data structures and ingestion pipelines.                                  |
| Harmonize   | `references/phases/harmonize.md`   | Model, map, and unify data into harmonized entities.                                  |
| Segment     | `references/phases/segment.md`     | Build and inspect audience segments and calculated insights.                          |
| Act         | `references/phases/act.md`         | Deliver audiences and data-triggered actions downstream.                              |
| Retrieve    | `references/phases/retrieve.md`    | Query, search, and inspect Data 360 data and metadata.                                |
| Semantic    | `references/phases/semantic.md`    | Manage semantic models, search indexes, retrievers, and ML/prediction model surfaces. |
| Observe     | `references/phases/observe.md`     | Analyze Agentforce sessions and platform traces in Data 360.                          |
| Orchestrate | `references/phases/orchestrate.md` | Plan and troubleshoot cross-phase Data 360 workflows.                                 |

## Upstream reference fallback

If this generated reference and the local sf-data360 references are insufficient, inspect the official Data 360 API and hosted MCP contracts, then curate findings into the generated `sf_data360` action catalog.
