# ADR 0027: Data 360 v2 uses pi-native family tools over a shared action registry

## Status

Accepted

## Context

SF Data 360 has a broad operation catalog with parity coverage across the public Data 360 surface. ADR 0009 kept that coverage pi-native, generated, and phase-guided, and originally placed repeated REST operations, local helpers, and runbooks behind one public `d360` facade. That shape kept prompt footprint low, but real agent workflows increasingly need a more intuitive first choice than generic search/examples/execute or raw REST.

## Decision

`sf-data360` keeps the extension id, `/sf-data360` command, generated capability registry, safety model, examples, renderers, truncation, and sweep coverage. It introduces a new v2 public tool surface named with the `data360_*` prefix:

```text
data360_discover
data360_connect
data360_prepare
data360_harmonize
data360_segment
data360_activate
data360_query
data360_semantic
data360_observe
data360_orchestrate
data360_api
```

The v2 tools are pi-native family tools, not MCP tools, Agent Skills, or endpoint-per-tool wrappers. Each tool uses a compact shared envelope with an action string such as `stream.create_ingest_api`, `sql.verify_rows`, or `ingest_csv.plan`, plus `params`, `target_org`, `dry_run`, `allow_confirmed`, `output_mode`, and timeout controls. Action catalogs, examples, endpoint details, safety, and next-step guidance are disclosed on demand through local meta actions such as `actions.search`, `action.describe`, and `examples.get` instead of being embedded in always-visible tool schemas.

All v2 tools route through a shared action registry and dispatcher over the existing operation registry, local helpers, runbooks, target-org resolution, safety gates, execution adapters, rendering, and artifact/truncation behavior. The v2 action map is generated from existing operation data plus curated ownership/rename overlays: mapping rules provide endpoint-complete coverage, while curated overrides keep the agent-facing action names intuitive. Every existing operation must resolve to exactly one primary `data360_*` tool/action unless explicitly exempted and tested.

The v2 registry files live under `extensions/sf-data360/registry/v2/`:

```text
action-rules.json       # curated phase/family/resource ownership rules
action-overrides.json   # curated names, aliases, descriptions, examples hints
actions.json            # generated final action map, committed and consumed at runtime
journeys.json           # curated cross-phase orchestrated journeys
```

The `data360_*` tools become the default public agent interface immediately. Legacy `d360`, `d360_metadata`, `d360_probe`, and `d360_api` implementations remain in the codebase as migration adapters and fallback references, but they should be hidden from the default public tool surface once the v2 registration lands. `data360_api` is the v2 raw REST escape hatch, while repeated workflows should be promoted into family actions or orchestrated journeys.

`sf-data360` uses plain reference documentation under `extensions/sf-data360/references/` instead of contributing extension-owned Agent Skills. Agents should use the `data360_*` tools first, then read specific reference files when deeper workflow guidance is needed.

`data360_orchestrate` owns outcome-oriented journeys and manifests such as loading a CSV, making new data usable, building an audience, or configuring semantic retrieval. Mutating journeys are plan-first: a plan resolves concrete family actions, endpoints, resources, safety decisions, and verification steps before execution. Journey execution reuses the same safety and confirmation model as lower-level family actions.

## Consequences

- The public Data 360 agent interface becomes more intuitive without exposing 200+ endpoint tools or collapsing every workflow into one opaque mega-tool.
- The atomic capability catalog remains the source of truth for parity; a generated v2 action map plus curated overlays assigns every supported operation one primary v2 tool/action owner or an explicit documented exception.
- Tool schemas stay small. Broad action lists, request bodies, endpoint details, and examples are loaded only after user intent through discovery/meta actions or explicit reference-doc reads.
- The v2 surface intentionally refines ADR 0009's single public `d360 execute` path while preserving its deeper constraints: pi-native execution, generated/data-driven coverage, no MCP runtime dependency, bounded startup footprint, and centralized safety/rendering behavior.
- Legacy implementations are retained for reuse and rollback during the transition, but the visible public tool surface should switch boldly to `data360_*` rather than running old and new tools side by side by default.
- Safety is not relaxed by the new surface. Confirmed/destructive actions still require dry-run review and explicit acknowledgement where appropriate, and raw outputs remain bounded with artifacts for large responses.
- Data 360 reference material is kept as docs, not skills, to avoid adding another routing layer on top of the first-class `data360_*` tools.
