<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Generated from extensions/sf-data360/registry/phases.json and registry operation data. Do not edit by hand. -->

# Data 360 Orchestrate Reference

Plan and troubleshoot cross-phase Data 360 workflows.

## Use this reference when

Data 360 Orchestrate phase. Use for cross-phase Data 360 planning, pipeline setup, readiness triage, or troubleshooting that spans multiple sf-data360 phases.

## Tool discipline

1. Use the matching `data360_*` family tool for this phase.
2. Use `actions.search` when the exact action is unclear.
3. Use `action.describe` and `examples.get` before complex or mutating calls.
4. Use `dry_run: true` before confirmed/destructive actions and review the resolved request.
5. Use `data360_api` only as the raw REST escape hatch when no family action fits.
6. Keep broad results bounded with `output_mode: "summary"` or `"file_only"`.
7. Promote repeated fallback paths into tested Data 360 family actions or journeys.

## Phase coverage

- Cross-phase orchestration reference. Use the phase map below to route work.

- Capabilities: 0 (0 runbook-backed)
- Safety mix: read=0, safe_post=0, confirmed=0, destructive=0

## Data 360 family actions

- `data360_orchestrate` `cleanup.plan` (journey, read) — Plan cleanup of explicitly owned Data 360 resources.
- `data360_orchestrate` `ingest_csv.plan` (journey, read) — Plan Route A local CSV ingestion through Ingestion API source schema, data stream, tenant ingest job, and SQL verification.
- `data360_orchestrate` `manifest.plan` (journey, read) — Plan a multi-file Data 360 CSV ingestion manifest without mutation.
- `data360_orchestrate` `manifest.validate` (journey, read) — Validate a Data 360 CSV ingestion manifest.
- `data360_orchestrate` `cleanup.run` (journey, destructive) — Run cleanup of explicitly owned Data 360 resources after confirmation.
- `data360_orchestrate` `ingest_auth.pkce_interactive` (journey, confirmed) — Run an interactive localhost PKCE flow for Data Cloud ingest auth and return sanitized in-memory auth session metadata.
- `data360_orchestrate` `ingest_csv.run` (journey, confirmed) — Run a single CSV ingestion journey or dry-run its manifest-backed plan.
- `data360_orchestrate` `manifest.run` (journey, confirmed) — Run a Data 360 CSV ingestion manifest through source schema, streams, jobs, and verification.

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
