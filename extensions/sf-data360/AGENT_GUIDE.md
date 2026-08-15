# SF Data 360 Agent Guide

Use the Data 360 family tool that owns the current phase. Every family shares action discovery, dry-run/confirmation, target-org resolution, bounded transport, and compact result artifacts.

## Phase routing

- Discover readiness and catalog actions: `data360_discover`
- Connections, connectors, endpoints, source schemas: `data360_connect`
- Data spaces, DLOs, streams, ingest jobs, transforms, DataKits: `data360_prepare`
- DMOs, mappings, relationships, identity resolution, unified profiles: `data360_harmonize`
- Calculated insights and segments: `data360_segment`
- Activations, targets, data actions, personalization: `data360_activate`
- SQL, metadata, profile, graph, count, sample, verification: `data360_query`
- Semantic models, search indexes, retrievers, metrics, ML: `data360_semantic`
- Agentforce STDM sessions, spans, trace trees, errors, latency: `data360_observe`
- Cross-phase journeys, manifests, sweeps, cleanup: `data360_orchestrate`
- Known unsupported endpoint escape hatch: `data360_api`

## Operating loop

1. Use `actions.search` and `action.describe` when the action contract is unclear.
2. Probe readiness before workflows whose org capability is uncertain.
3. Inspect source and target fields before mappings.
4. Validate calculated insights and check segment status before activation.
5. Use plan/dry-run for confirmed or destructive actions; review the returned operation before `allow_confirmed=true`.
6. Prefer count, sample, and row verification before broad reads.
7. Keep full responses and journey evidence in Data 360 Artifacts.

## Focused references

Use [`references/README.md`](./references/README.md) to select one current
workflow reference. Material under `references/compatibility/` is legacy facade
evidence and must not drive public tool selection.

## Boundaries

Use standard `sf_soql` for CRM SOQL. Use `data360_observe` for production Agentforce telemetry and Agent Script tools for local authoring/preview/eval. Do not hand-roll REST calls when a family action exists.
