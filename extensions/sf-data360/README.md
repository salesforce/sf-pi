# SF Data 360

## What It Does

SF Data 360 is a Pi-native SDK surface over Salesforce Data 360 APIs. It exposes one custom system tool, `sf_data360`, and keeps the complete endpoint catalog behind business-namespaced actions.

### Business namespaces

```text
discover.*     readiness, routing, contracts, examples
connect.*      connectors, connections, source schemas, authentication
prepare.*      dataspaces, DLOs, streams, ingestion, transforms, DataKits
harmonize.*    DMOs, mappings, identity resolution, relationships
segment.*      calculated insights and audience lifecycle
activate.*     activation targets, activations, data actions, personalization
query.*        Query API V3 SQL, metadata, profiles, graphs, verification
semantic.*     semantic models, search indexes, retrievers, ML
observe.*      Agentforce STDM and platform tracing
orchestrate.*  multi-phase plans, journeys, manifests, cleanup
api.*          exact endpoint escape hatch
```

## Examples

```json
{
  "action": "discover.route",
  "params": { "intent": "connect Snowflake and make customer data queryable" }
}
```

```json
{
  "action": "prepare.dlo.list",
  "params": { "limit": 10 },
  "target_org": "my-data360-sandbox"
}
```

```json
{
  "action": "query.sql.run",
  "params": {
    "sql": "SELECT COUNT(*) AS total FROM Example__dlm",
    "transferMode": "ADAPTIVE",
    "queryRowLimit": 10
  },
  "target_org": "my-data360-sandbox"
}
```

```json
{
  "action": "segment.publish",
  "params": { "segmentApiName": "ExampleSegment" },
  "target_org": "my-data360-sandbox",
  "dry_run": true
}
```

## How It Works

- One static Pi tool schema keeps startup and prompt footprint bounded.
- A generated action catalog provides full known endpoint coverage without registering one tool per endpoint.
- A normalized snapshot of the official Data 360 Connect OpenAPI document provides independent method, path, parameter, recursive request/response schema, and source-drift evidence. Reviewed promotion waves cover all 414 OpenAPI operations as generated named actions without hand-editing the runtime registry.
- Connect REST uses the shared Salesforce Connection Module.
- SQL uses Data 360 Query API V3 by default.
- Tenant ingestion uses the Data 360 Ingestion API.
- `api.request` provides day-zero reach for an exact unpromoted endpoint.
- The official Connect OpenAPI document, hosted Data 360 MCP, and public reference repository provide complementary parity evidence; none is a runtime dependency.
- Results use rich Data 360 Run Cards modeled after SF Apex: API rails, readable SQL, always-visible request/response previews, domain tables, transport fallbacks, prominent pagination, and grounded orchestration traces.

## Run Cards

Every business namespace has a distinct icon and title. Collapsed and expanded cards always show the API rail, outcome, complete request metadata, and a response preview capped at eight JSON lines. Offset pagination is promoted from a query-string detail into an explicit page, item range, batch size, offset, limit, and returned-count annotation. Domain-specific SQL, metadata, and result tables remain additive.

Evidence artifacts and next-step guidance remain in the semantic digest and stable `structuredContent` for models and programmatic callers, but they are not rendered as human card sections. `summary` returns the compact model digest and normal human card. `inline` adds a bounded semantic preview instead of dumping raw JSON. `file_only` preserves the same card and stores the full response as an artifact.

When one assistant turn observes two or more non-local Data 360 API calls, SF Data 360 appends one bounded, top-level Mermaid trace grouped by business namespace. The trace is a projection of observed calls, pagination, and outcomes; it does not infer unexecuted dependencies or embed raw utterances and URLs.

## Commands

- `/sf-data360` — open the Manager detail page.
- `/sf-data360 status` — show enablement, the single tool, target, and API policy.
- `/sf-data360 help` — show tool and namespace guidance.

## Configuration

**SF Pi Manager → SF Data 360 → Settings** controls `sfPi.data360.defaultOutputMode`: `summary` (default), `inline`, or `file_only`. An explicit `output_mode` wins for one call. Target org and API versions come from the shared Salesforce connection context unless `target_org` is explicit.

Query API V3 requires a tenant token with `cdp_query_api`. The `connect.auth.*` PKCE flow requests both `cdp_query_api` and `cdp_ingest_api` and returns an in-memory `authSessionId` that Query and Ingestion actions can share. Without a usable V3 tenant session, `query.sql.*` uses the equivalent Connect API endpoint and reports that fallback; set `transport: "query_v3"` to fail instead.

## Safety and Data Boundaries

Read and recognized safe-query actions execute directly. Mutations require a reviewed `dry_run`, `allow_mutation: true`, and SF Guardrail mediation. Destructive execution additionally requires a verified non-production target and human confirmation, except for exact sweep-owned cleanup fixtures. Operator-approved unattended mutation uses the central `SF_GUARDRAIL_ALLOW_HEADLESS=1` path; hard blocks remain authoritative.

## References

Start at [`references/README.md`](./references/README.md). Generated phase references describe endpoint coverage without expanding the runtime tool surface.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-data360/
  lib/                        ← implementation modules
  references/                 ← progressive reference material
  registry/                   ← generated and curated registry data
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
