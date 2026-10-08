# SF Data 360 Agent Guide

Use the single `sf_data360` Pi system tool for Data 360 work. Its `action` selects one business namespace while `params` carries the exact API contract.

## Business routing

- `discover.*` — readiness, intent routing, action search, contracts, and examples.
- `connect.*` — connectors, connections, source schemas, and tenant authentication.
- `prepare.*` — dataspaces, DLOs, streams, ingestion jobs, transforms, and DataKits.
- `harmonize.*` — DMOs, mappings, relationships, identity resolution, and data graphs.
- `segment.*` — calculated insights and audience segments.
- `activate.*` — activations, targets, data actions, and personalization.
- `query.*` — Query API V3 SQL, metadata, profiles, graphs, counts, and samples.
- `semantic.*` — semantic models, metrics, search indexes, retrievers, and ML.
- `observe.*` — Agentforce STDM, traces, errors, and latency.
- `orchestrate.*` — multi-phase plans, manifests, journeys, and cleanup.
- `api.*` — exact endpoint escape hatch.

## Operating loop

1. Call `discover.route` or `discover.action.search` when the action is unclear.
2. Call `discover.action.describe` before a complex endpoint or mutation.
3. Establish readiness and inspect source/target schema before dependent work.
4. Use `dry_run: true` before mutation.
5. Pass `allow_mutation: true` only after reviewing the plan; Guardrail approval remains separate.
6. Prefer count, sample, or verification actions before broad reads.
7. Use `api.request` only for an exact endpoint that has no named action yet.

## API transports

- Connect REST uses the shared Salesforce Connection Module and versionless resource paths.
- `query.sql.*` uses Data 360 Query API V3 and a cached tenant token exchange.
- `prepare.ingest.*` uses the tenant Ingestion API.
- The hosted Data 360 MCP is a parity source, not a runtime dependency.

## Result contract

The model receives a compact semantic digest and stable structured content, including artifacts, next-step guidance, API calls, and pagination. Human Run Cards always put a five-row or bounded domain Preview after Outcome. Direct API cards add request metadata and an eight-line response preview; local Discover, derived Observe, and Orchestrate cards instead show useful criteria, matches, metrics, journeys, or steps. Expanded cards show the complete sanitized canonical payload up to 5,000 lines or 2 MB. Evidence and next-step sections stay model-only. Multi-call turns append one grounded Mermaid projection with versionless endpoint templates; independent calls fan out, while pagination and proven execution chains remain sequential.

## Recursive coverage

Use generated recursive test contracts to classify every action before live execution:

```bash
npm run generate-d360-test-contracts:check
```

For private non-production coverage, discover bounded org-local identifiers into an ignored fixture profile, then run reads and validation-only POSTs:

```bash
npm run e2e:data360:fixtures -- \
  --target-org <alias> \
  --output /tmp/data360-fixtures.json

npm run e2e:data360 -- \
  --target-org <alias> \
  --live-read \
  --live-safe-post \
  --contract-validate \
  --fixture-profile /tmp/data360-fixtures.json
```

Fixture profiles can contain org IDs and stay private with mode `0o600`; never commit them. `--contract-validate` checks Connect method, path, documented status, and recursive JSON request/response shapes; reviewed live-shape differences remain explicit overrides. OpenAPI-only coverage is promoted through `registry/connect-openapi-promotions.json`; every remaining operation must stay assigned to a reviewed wave. Mutating lifecycle coverage remains fixture-owned, dry-run first, exact-target gated, and reverse-cleaned.

## Boundaries

Use `sf_soql` for CRM SOQL. Use Agent Script tools for local agent development. Use `observe.*` for production Agentforce telemetry. Do not hand-roll REST or shell out when `sf_data360` owns the endpoint.
