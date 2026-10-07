---
id: "0141"
status: accepted
date: 2026-10-06
supersedes: ["0027", "0067", "0106"]
---

# Data 360 is one Pi-native SDK tool with a hard cutover

## Context

The eleven public `data360_*` family tools improved lifecycle routing but duplicated one schema and one registration per business phase. Their V2 dispatcher still delegated most execution through retained V1 facade, API, metadata, probe, and card Modules. The public surface was V2-only, but the implementation was not a completed migration. The retained generic Result Card layer hid useful collection and query data behind HTTP summaries, escaped payload strings, and unconditional artifacts.

Salesforce users already understand Discover, Connect, Prepare, Harmonize, Segment, Activate, Query, Semantic, Observe, Orchestrate, and API as Data 360 business terminology. Those concepts are valuable routing language but do not need to be separate Pi tools. Pi custom system tools can keep one static schema while resolving a large action catalog after intent.

## Decision

`sf-data360` exposes exactly one Pi tool: `sf_data360`.

Every public action begins with one business namespace:

```text
discover connect prepare harmonize segment activate
query semantic observe orchestrate api
```

The tool uses one compact envelope: `action`, `params`, `target_org`, `dry_run`, `allow_mutation`, `timeout_ms`, and `output_mode`. Action-specific endpoint, safety, and parameter contracts are generated and disclosed through `discover.action.search`, `discover.action.describe`, and `discover.action.example`.

The action registry is a thin SDK contract over Data 360 APIs. Connect REST uses the shared Salesforce Connection Module. `query.sql.*` uses Data 360 Query API V3 and tenant-token exchange. Tenant ingestion uses the direct Ingestion API. `api.request` is a guarded exact-endpoint escape hatch and never accepts an arbitrary host.

The transition is a hard cutover. The old `d360`, `d360_api`, `d360_metadata`, `d360_probe`, and eleven `data360_*` tools are deleted with their registration, facade, card, compatibility, and fallback code. There are no runtime aliases or dual surfaces. Official `d360_*` operation identifiers remain private parity metadata because they identify upstream operations, not Pi tools.

Results use a Data 360 Run Digest with two projections: compact semantic `content` plus stable `structuredContent` for models/programmatic callers, and a rich human Run Card rendered from `details.digest`. Run Cards use namespace-specific icons, full API URL rails, readable SQL, bounded request/response payloads, domain tables, transport fallbacks, evidence, and next steps. Raw artifacts are persisted only for broad, diagnostic, orchestrated, mutating, or explicitly file-only evidence.

The hosted Data 360 MCP remains parity and contract evidence, not a runtime fallback. The generated parity report compares upstream operations directly with `sf_data360` actions.

## Consequences

- Pi sees one stable Data 360 tool regardless of endpoint count.
- Users and agents retain the product lifecycle vocabulary through action namespaces.
- All known upstream operations have one primary action or canonical operation alias; new endpoints remain reachable through `api.request` until promoted.
- V1, multi-tool migration code, and the legacy generic-card implementation are deleted rather than deprecated in place.
- Query API V3 becomes the preferred SQL transport while exact Connect query operations remain catalogued.
- Execution remains a thin SDK contract; Run Cards are a pure presentation projection and never own API behavior.
- Mutations require dry-run review, `allow_mutation=true`, and Guardrail mediation.
- Runtime surface attestation, action parity, namespace routing, direct transport, live sweep, and cleanup proof replace facade compatibility evidence.
