# SF Data 360

## What It Does

SF Data 360 gives agents a Pi-native, lifecycle-oriented Data 360 surface without
loading hundreds of endpoint-specific tools into every prompt:

- `data360_discover` — readiness, action discovery, examples, and routing.
- `data360_connect` — connectors, connections, endpoints, and source schemas.
- `data360_prepare` — dataspaces, DLOs, streams, ingest jobs, transforms, and DataKits.
- `data360_harmonize` — DMOs, mappings, relationships, identity resolution, and data graphs.
- `data360_segment` — calculated insights and segment lifecycle.
- `data360_activate` — activations, targets, data actions, and personalization.
- `data360_query` — SQL, metadata, profiles, graphs, counts, samples, and verification.
- `data360_semantic` — semantic models, metrics, search indexes, retrievers, and ML surfaces.
- `data360_observe` — Agentforce sessions, spans, errors, traces, and latency.
- `data360_orchestrate` — journeys, manifests, plans, sweeps, and cleanup.
- `data360_api` — a raw REST escape hatch for unpromoted endpoints.

Current workflows use only these family tools and their actions. Retained legacy
modules support explicitly labeled compatibility proof and selected adapters;
they are not the public operating surface.

## Discovering actions

Every family uses the same envelope: `action`, `params`, `target_org`, `dry_run`,
`allow_confirmed`, and `output_mode`. Start with `actions.search` or
`action.describe` when the exact action is unknown.

For DMO/DLO work, list narrowly, inspect the selected object, count rows, then
sample verified non-sensitive fields. Large responses remain artifact-first;
`summary`, `inline`, and `file_only` control prompt-visible detail.

## Commands

- `/sf-data360` — open SF Data 360 in the Manager, or print concise status in
  non-interactive mode.
- `/sf-data360 status` — print enablement, tools, target, and API version.
- `/sf-data360 help` — show command and family guidance.

## Configuration

**SF Pi Manager → SF Data 360 → Settings** stores one low-risk default under
`sfPi.data360`:

- `defaultOutputMode`: `summary` (default), `inline`, or `file_only`.

An explicit `output_mode` always wins for the current call.

## Safety and Data Boundaries

- No MCP runtime or Java subprocess is used. Family actions route through the
  shared Salesforce Connection Module and generated action registry.
- Read-only `GET` and recognized safe query/search/validate/test `POST` paths can
  run directly. Publish, deploy, run, update, and delete shapes are classified
  for confirmation.
- Use `dry_run: true` before mutation to inspect the action, method, path, target,
  org type, and safety decision.
- Confirmed family actions also require `allow_confirmed: true`; this expresses
  intent but never replaces SF Guardrail approval. Headless confirmation remains
  blocked unless the process explicitly sets `SF_GUARDRAIL_ALLOW_HEADLESS=1`.
- Mutating journeys disclose child mutation families and retain a separate
  execution-chain session entry for audit.
- Plain references are progressively disclosed and do not become Agent Skills or
  always-on prompt content.

## References

Use [`references/README.md`](./references/README.md) to choose the current
workflow, action-coverage, data-shape, query, tracing, or phase reference.
Generated phase material names its generator. Retained facade evidence is
isolated under `references/compatibility/` and is not normal operating guidance.

The public upstream reference repository remains available at
<https://github.com/forcedotcom/d360-mcp-server>. SF Pi imports public operation
and payload-shape metadata, then curates it into the family surface.

## Troubleshooting

**A DMO list returns too much data:** Use `data360_harmonize` with `dmo.list`, a
category filter, and a bounded output mode.

**Metadata search fails while DMO/DLO lists work:** Treat this as search-plane
readiness. Use `data360_query` metadata actions or the corresponding harmonize
or prepare get action.

**A connector detail returns `NOT_FOUND`:** Use the connector catalog `name`,
which can differ from the connection's `connectorType`.

**The family tools are missing:** Check whether `sf-data360` was disabled in the
Manager, then run `/reload`.

**A mutation is blocked headlessly:** Re-run as a dry run and review the resolved
request. Unattended automation requires the central Guardrail operator path;
hard blocks still apply.

**A versioned path is rejected:** Pass a versionless resource. Shared connection
logic selects the target's advertised API version or an explicit configured
fallback and otherwise fails before the business request.

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
