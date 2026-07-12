# SF Data 360 — Code Walkthrough

## What It Does

`sf-data360` gives agents a pi-native, workflow-oriented way to work with
Salesforce Data Cloud / Data 360 without exposing hundreds of endpoint-specific
tools.

It registers the v2 `data360_*` family tool surface:

- `data360_discover` — readiness, action discovery, examples, catalog, and
  routing explanation.
- `data360_connect` — connectors, connections, endpoints, source schemas, and
  auth preflight.
- `data360_prepare` — dataspaces, DLOs, data streams, ingest jobs, transforms,
  and DataKits.
- `data360_harmonize` — DMOs, mappings, standard mappings, smart mapping, and
  identity resolution.
- `data360_segment` — calculated insights, segment definitions, publish, and
  status.
- `data360_activate` — activations, activation targets, data actions, action
  targets, and personalization delivery/configuration.
- `data360_query` — SQL, metadata search/get, profile query, data graph,
  rows/count/sample, and verification.
- `data360_semantic` — semantic models, semantic objects, metrics, search
  indexes, retrievers, and ML/prediction model surfaces.
- `data360_observe` — Agentforce STDM sessions, platform tracing spans, trace
  trees, action failures, and latency analysis.
- `data360_orchestrate` — journeys, manifests, plans, multi-step workflows,
  sweeps, and cleanup.
- `data360_api` — raw REST escape hatch for endpoints not yet promoted to a
  family action.

Legacy `d360`, `d360_api`, `d360_metadata`, and `d360_probe` implementations stay
in the codebase as migration adapters and fallback references, but the visible
public tool surface is `data360_*`.

It is enabled by default and ships plain reference documentation under
`references/`. It does not contribute Agent Skills; explicitly disabling the
extension removes the tools on `/reload` or new sessions.

## Design Rationale

The intended balance is:

- **Agent-intuitive:** tools match Data 360 lifecycle families and user journeys,
  not raw endpoint families.
- **Context-efficient:** each tool has a compact schema; action catalogs and
  examples are disclosed on demand through `actions.search`, `action.describe`,
  and `examples.get`. Discovery results include bounded action previews and
  recovery hints so agents can choose the next action without loading the full
  catalog.
- **Composable:** agents can still chain family actions, journeys, pagination,
  and JSON transforms without loading the full 200+ operation catalog into the
  prompt.
- **Deterministic:** actions route through the generated registry, pin the API
  version, resolve the target org, build query strings, handle JSON bodies,
  truncate large output, and gate risky writes.
- **Pi-native:** no external server or Java subprocess is used; the v2 tools run
  through the existing `@salesforce/core` connection and SF Pi safety/rendering
  modules.

## Runtime Flow

```
Extension loads
  ├─ register data360_* family tools
  ├─ register /sf-data360
  └─ resources_discover
       └─ re-register tools on reload; no Agent Skill contribution

Agent calls a data360_* tool
  ├─ action.describe / actions.search? → local registry lookup, no network call
  ├─ Resolve SF environment from shared sf-pi cache / sf CLI
  ├─ Resolve action → capability / local helper / journey
  ├─ Normalize path to /services/data/v<active-api-version>/... when REST-backed
  ├─ Classify safety by action + method + path
  ├─ dry_run? → return resolved request/plan, no mutation
  ├─ confirmation required? → ask user or fail closed in headless mode
  └─ execute via existing adapters
       └─ truncate large output and save full result to temp file
```

## Tool Shape

Every v2 family tool uses the same compact envelope:

```json
{
  "action": "stream.create_ingest_api",
  "params": {},
  "target_org": "optional-alias",
  "dry_run": true,
  "allow_confirmed": false,
  "output_mode": "summary"
}
```

Use `actions.search` and `action.describe` to discover exact actions without
loading the whole catalog:

```json
{ "action": "actions.search", "params": { "query": "ingestion api stream" } }
```

```json
{ "action": "action.describe", "params": { "action": "stream.create_ingest_api" } }
```

## Behavior Matrix

| Event / trigger                                          | Condition                 | Result                                                                         |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| Extension load                                           | Extension enabled         | Register `data360_*` family tools and `/sf-data360`.                           |
| `resources_discover`                                     | Extension enabled         | Re-register tools on reload; no Agent Skill contribution.                      |
| Extension explicitly disabled + `/reload` or new session | —                         | No `data360_*` tools.                                                          |
| `actions.search` / `action.describe`                     | Any v2 family tool        | Query local v2 action registry without a network call.                         |
| REST-backed family action                                | `dry_run: true`           | Return resolved request, target org, API version, and safety without mutation. |
| REST-backed family action                                | Read/query/validate/test  | Execute via `@salesforce/core` Connection (`conn.request`).                    |
| REST-backed family action                                | Confirmed/destructive     | Require dry-run review and confirmation according to safety policy.            |
| `data360_orchestrate`                                    | `*.plan` action           | Return a cross-phase plan without mutation.                                    |
| `data360_api`                                            | Raw endpoint escape hatch | Use only when no family action exists yet.                                     |

## DMO/DLO Discovery Defaults

For a simple "list DMOs" request, use `data360_harmonize` with the DMO list/get
actions or `data360_query` metadata actions such as `metadata.entities`. Do not
use `/ssot/data-model-objects` broadly unless the user explicitly needs full DMO
field definitions or the standard catalog.

List actions cap inline output by default and save the full raw response to a temp file. Use `category` and `max_results` to narrow the inline table.

For record queries, describe one selected DMO first, run `COUNT(*)`, then sample
a small number of verified non-sensitive fields.

## Safety Model

| Request shape                                                                  | Behavior                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET`                                                                          | Allowed as read-only.                                                     |
| Safe `POST` paths such as metadata search, query, validate, or connection test | Allowed.                                                                  |
| `POST` run/publish/deploy/undeploy action paths                                | Confirmed.                                                                |
| `PATCH` / `PUT`                                                                | Confirmed for production or unresolved orgs.                              |
| `DELETE`                                                                       | Always confirmed.                                                         |
| Headless mutating call requiring confirmation                                  | Blocked unless the central Guardrail headless override is explicitly set. |

Use `dry_run: true` before mutating calls to inspect the exact action, method,
path, target org, org type, and safety decision. For v2 family actions with
`safety: "confirmed"`, actual execution also requires `allow_confirmed: true`;
dry-run and `allow_confirmed` express execution intent, while SF Guardrail owns
the approval boundary for high-value mutations. Mutating journeys disclose the
child mutation families covered in the Guardrail approval detail and record the
executed child chain as a `sf-data360-execution-chain` session entry. That chain
is intentionally separate from the `sf-guardrail-decision` approval ledger and is
surfaced alongside `/sf-guardrail audit` output for review.

## V2 Action Coverage

The v2 action registry is generated from the existing operation registry plus
curated ownership and rename overlays under `registry/v2/`. Every operation must
resolve to exactly one primary `data360_*` tool/action unless an explicit tested
exception exists. The current coverage matrix, confirmed-capability workflow,
and per-family "what to run first" checklist live in
`references/facade-coverage.md` while the v2 action map stabilizes.

## References

Plain reference files under `references/` cover endpoint families, workflow
recipes, action coverage, request-body shapes, query patterns, examples, safety
rules, Agentforce Session Tracing (STDM), and Agent Platform Tracing. These are
not Agent Skills; agents should read the specific reference file when deeper
guidance is needed.

Payload examples remain capability-shaped internally. V2 tools expose them
through `examples.get` on the relevant family action, while registry entries in
`registry/examples.json` continue to carry canonical capability names and variant
metadata such as `{ "capability": "d360_dmo_create", "variant": "profile" }`.

The phase reference pages under `references/phases/` are generated from
`registry/phases.json`, the v2 action map, and registry operation data. Run
`npm run generate-d360-references` after changing phase mappings or capability
coverage.

When local references are not enough, use the public upstream Data 360 reference
repository before broad web search: <https://github.com/forcedotcom/d360-mcp-server>.
SF Data360 periodically imports public operation and payload-shape metadata from
that repository, then curates it into Pi-native `data360_*` family actions.

Do not duplicate large endpoint catalogs in prompt injection. Keep large content
behind file references so the agent loads it only when needed.

## Settings Panel

`sf-data360` is enabled by default and marked configurable so it appears with a standardized drill-down panel in the `/sf-pi` extension manager. The Manager Settings page shows enablement, runtime backend, tools, safety behavior, reference paths, and one low-risk preference stored in Pi settings under `sfPi.data360`:

- **Default output mode** (`defaultOutputMode`) — used by `data360_*` family tools when the caller omits `output_mode`. Values: `summary` (default), `inline`, or `file_only`.

Explicit tool arguments still win. For example, passing `output_mode: "inline"` overrides the saved default for that call.

Result digests remain artifact-first, but discovery actions include bounded previews: `actions.search` shows matching action names and parameters, `action.describe` shows exact required/optional parameters plus curated examples when available, and unknown actions return fuzzy suggestions without auto-routing.

## Commands

- `/sf-data360` — open the standardized command panel (status, help, close).
- `/sf-data360 status` — print enablement, registered tools, target org, and API version.
- `/sf-data360 help` — show usage guidance.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-data360/
  lib/
    agent-observability/
      platform-tracing.ts   ← implementation module
    display/
      api-card.ts           ← implementation module
      card.ts               ← implementation module
      facade-card.ts        ← implementation module
      metadata-card.ts      ← implementation module
      probe-card.ts         ← implementation module
      render.ts             ← implementation module
    facade/
      agent-observability.ts← implementation module
      local-helpers.ts      ← implementation module
      registry.ts           ← implementation module
      sql.ts                ← implementation module
    v2/
      ingest/
        auth.ts             ← implementation module
        interactive-auth.ts ← implementation module
        tenant-client.ts    ← implementation module
        types.ts            ← implementation module
      action-registry.ts    ← implementation module
      action-types.ts       ← implementation module
      cleanup.ts            ← implementation module
      csv-schema.ts         ← implementation module
      dispatcher.ts         ← implementation module
      journey-catalog.ts    ← implementation module
      manifest.ts           ← implementation module
      render.ts             ← implementation module
      result-presenter.ts   ← implementation module
      tools.ts              ← implementation module
    api-tool.ts             ← implementation module
    config-panel.ts         ← implementation module
    extension-doctor.ts     ← implementation module
    facade-tool.ts          ← implementation module
    metadata-tool.ts        ← implementation module
    path.ts                 ← implementation module
    probe-tool.ts           ← implementation module
    safety.ts               ← implementation module
    settings.ts             ← implementation module
    target-org.ts           ← implementation module
    truncation.ts           ← implementation module
    v2-tool-names.ts        ← implementation module
  tests/
    agent-observability-runbooks.test.ts← unit / smoke test
    api-card.test.ts        ← unit / smoke test
    api-tool.test.ts        ← unit / smoke test
    capability-sweep.test.ts← unit / smoke test
    config-panel.test.ts    ← unit / smoke test
    display-card.test.ts    ← unit / smoke test
    facade-capabilities.test.ts← unit / smoke test
    facade-card.test.ts     ← unit / smoke test
    facade-registry.test.ts ← unit / smoke test
    facade-safety.test.ts   ← unit / smoke test
    local-helpers.test.ts   ← unit / smoke test
    metadata-card.test.ts   ← unit / smoke test
    metadata-tool.test.ts   ← unit / smoke test
    path.test.ts            ← unit / smoke test
    payload-examples.test.ts← unit / smoke test
    phase-skills.test.ts    ← unit / smoke test
    platform-tracing.test.ts← unit / smoke test
    probe-card.test.ts      ← unit / smoke test
    probe-tool.test.ts      ← unit / smoke test
    render-snapshot.test.ts ← unit / smoke test
    safety.test.ts          ← unit / smoke test
    settings.test.ts        ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    target-org.test.ts      ← unit / smoke test
    truncation.test.ts      ← unit / smoke test
    v2-action-curation.test.ts← unit / smoke test
    v2-action-registry.test.ts← unit / smoke test
    v2-action-sweep.test.ts ← unit / smoke test
    v2-activate-plan-recommendation.test.ts← unit / smoke test
    v2-agent-behavior-run.test.ts← unit / smoke test
    v2-auth-sessions-cleanup.test.ts← unit / smoke test
    v2-cleanup-discover-owned.test.ts← unit / smoke test
    v2-dispatcher.test.ts   ← unit / smoke test
    v2-execute-parity.test.ts← unit / smoke test
    v2-ingest-auth-exchange.test.ts← unit / smoke test
    v2-ingest-auth-interactive.test.ts← unit / smoke test
    v2-ingest-auth.test.ts  ← unit / smoke test
    v2-ingest-jobs.test.ts  ← unit / smoke test
    v2-intent-plan.test.ts  ← unit / smoke test
    v2-journey-hardening.test.ts← unit / smoke test
    v2-journey-run-actions.test.ts← unit / smoke test
    v2-legacy-compatibility.test.ts← unit / smoke test
    v2-make-data-usable-run.test.ts← unit / smoke test
    v2-orchestrate-manifest.test.ts← unit / smoke test
    v2-result-presenter.test.ts← unit / smoke test
    v2-result-ux.test.ts    ← unit / smoke test
    v2-segment-activate-plan.test.ts← unit / smoke test
    v2-semantic-retrieval-plan.test.ts← unit / smoke test
    v2-tools.test.ts        ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  ROADMAP.md                ← extension-specific phased roadmap
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run targeted tests:

```bash
npm test -- extensions/sf-data360/tests
```

Run the facade-first capability sweep against a disposable Data 360 org:

```bash
npm run e2e:d360-sweep -- --target-org AgentforceSTDM --dry-run-only
npm run e2e:d360-sweep -- --target-org AgentforceSTDM --max-live 20
```

Run the sweep-owned DMO, DLO, DLO-to-DMO mapping, semantic model shell, semantic data-object, semantic calculated-field, semantic metric, semantic relationship, data transform, data action, calculated insight, segment, activation target, and activation mutation lifecycles only against the disposable sweep org:

```bash
D360_SWEEP_ALLOW_DESTRUCTIVE=AgentforceSTDM npm run e2e:d360-sweep -- \
  --target-org AgentforceSTDM \
  --dry-run-only \
  --mutate
```

Useful sweep controls:

```bash
# Run only one or more mutation lifecycles.
D360_SWEEP_ALLOW_DESTRUCTIVE=AgentforceSTDM npm run e2e:d360-sweep -- \
  --target-org AgentforceSTDM \
  --dry-run-only \
  --mutate \
  --only-lifecycle \
  --lifecycle transform \
  --lifecycle data-action \
  --lifecycle calculated-insight \
  --lifecycle segment \
  --lifecycle activation-target \
  --lifecycle activation

# Enforce coverage expectations directly or through a preset.
npm run e2e:d360-sweep -- \
  --target-org AgentforceSTDM \
  --preset agentforce-stdm-mutate \
  --require-outcome d360_transform_create=mutation_ok \
  --min-mutation-ok 10

# Cleanup known sweep-owned resources for a previous run id or discover stale sweep-owned resources.
D360_SWEEP_ALLOW_DESTRUCTIVE=AgentforceSTDM npm run e2e:d360-sweep -- \
  --target-org AgentforceSTDM \
  --cleanup-run-id 20260519170330
D360_SWEEP_ALLOW_DESTRUCTIVE=AgentforceSTDM npm run e2e:d360-sweep -- \
  --target-org AgentforceSTDM \
  --cleanup-stale
```

The sweep writes JSON and Markdown artifacts to a temp directory and reports expected org-state limitations as structured non-failing outcomes. Pending lifecycle work is tracked in [`ROADMAP.md`](./ROADMAP.md).

Covered by unit tests:

- Compact metadata helper builds safe list/describe paths and summarizes DMO/DLO list and field payloads.
- Path normalization strips caller-supplied `/services/data/vNN.N` prefixes so the active API version wins.
- Query-string construction handles repeated values and skips nullish values.
- Safety classification allows reads/search/query/validation/count/test/preview calls, confirms deletes and operational action paths, and treats unresolved target orgs conservatively.
- Request resolution chooses the target org API version, resolves explicit non-default target orgs before execution, and fails closed if that resolution fails.
- HTTP errors from `Connection.request` surface as `{ status, body }` and are classified by `responseLooksLikeError`; the tool emits an error envelope instead of throwing.
- Salesforce REST error arrays embedded in 2xx responses are still classified as failed calls.
- Generated phase references are committed, reproducible from `registry/phases.json`, and checked in the normal lint path.
- The capability sweep plans dry-run coverage for every facade capability, runs bounded read/safe-post live checks, dynamically follows list responses into detail reads when public-safe identifiers are available, can run focused sweep-owned mutation lifecycles behind an explicit destructive gate, writes a family summary table, supports coverage thresholds, and includes run-id cleanup helpers.

## Troubleshooting

**A simple DMO list returns too much data:** Use `d360_metadata` with `action: "list_dmos"`, `category`, and `max_results` instead of broad `/ssot/data-model-objects` calls.

**Metadata search fails but DMO/DLO lists work:** Treat this as search-plane readiness. Fall back to `d360_metadata` or `/ssot/metadata-entities`, then fetch one entity with `/ssot/metadata` or the DMO/DLO describe endpoint.

**Connector detail returns `NOT_FOUND`:** Use the connector catalog `name` from `GET /ssot/connectors`, not necessarily the `connectorType` shown on a connection.

**`data360_*` tools are missing:** `sf-data360` is enabled by default, so first check whether it was explicitly disabled in `/sf-pi`, then run `/reload`. The extension registers tools directly and does not contribute Agent Skills.

**A mutating call is blocked in headless mode:** Re-run with `dry_run: true` and
review the resolved request. If automation should be allowed, set
`SF_D360_ALLOW_HEADLESS_WRITE=1` for that process.

**The wrong API version appears in my path:** Pass only the resource path, for
example `/ssot/data-model-objects`. If you pass `/services/data/vNN.N/...`, the
tool intentionally normalizes the version to the active org/project API version.
