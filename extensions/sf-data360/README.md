# SF Data 360 — Code Walkthrough

## What It Does

`sf-data360` gives agents a small, deterministic way to work with Salesforce
Data Cloud / Data 360 REST APIs without adding MCP support and without exposing
hundreds of endpoint-specific tools.

It registers four native tools:

- `d360` — a facade for deterministic Data 360 capabilities: search the
  registry, fetch examples, and execute REST, local-helper, or workflow-backed
  capabilities.
- `d360_api` — calls Data 360 REST endpoints directly via `@salesforce/core`
  Connection (no subprocess), reusing the active Salesforce CLI auth context.
- `d360_metadata` — compact list/describe helpers for common DMO and DLO
  discovery tasks, avoiding broad nested catalog payloads by default.
- `d360_probe` — runs read-only probes across core Data 360 surfaces and
  classifies org readiness as ready, ready-empty, partial, or blocked.

It is enabled by default and contributes an extension-owned `sf-data360` skill. The skill is only visible while this extension is enabled, so explicitly disabling the extension removes both the tools and the skill on `/reload` or new sessions.

## Design Rationale

The intended balance is:

- **Context-efficient:** four small tools plus a small skill description.
- **Composable:** the agent can still script REST workflows, pagination, and
  JSON transforms on the fly.
- **Deterministic:** the tool pins the API version, resolves the target org,
  builds query strings, handles JSON bodies, truncates large output, and gates
  risky writes.
- **Progressive disclosure:** large endpoint catalogs and examples live in skill
  reference files that the agent reads only when relevant.

## Runtime Flow

```
Extension loads
  ├─ register d360, d360_api, d360_metadata, and d360_probe
  ├─ register /sf-data360
  └─ resources_discover
       └─ contribute ./skills so /skill:sf-data360 exists only while enabled

Agent calls d360_api
  ├─ Resolve SF environment from shared sf-pi cache / sf CLI
  ├─ Normalize path to /services/data/v<active-api-version>/...
  ├─ Classify safety by method + path
  ├─ dry_run? → return resolved request, no network call
  ├─ confirmation required? → ask user or fail closed in headless mode
  └─ conn.request(method, path, body) via @salesforce/core
       └─ truncate large output and save full result to temp file
```

## Metadata Helper Shape

```json
{ "action": "list_dmos", "max_results": 25 }
```

```json
{ "action": "describe_dmo", "api_name": "ssot__Account__dlm", "max_fields": 25 }
```

Use `d360_metadata` for simple DMO/DLO lists and one-object descriptions. Use
`d360_api` for lower-level endpoints or advanced workflows. DLO `category`
filters apply to compact metadata categories, which can differ from detailed DLO
schema categories.

## Tool Shape

```json
{
  "method": "GET",
  "path": "/ssot/data-model-objects",
  "query": { "category": "Profile" },
  "target_org": "optional-alias",
  "dry_run": true,
  "output_mode": "summary"
}
```

`path` is relative to `/services/data/vXX.X`. If a caller supplies a full
`/services/data/vNN.N/...` path, `d360_api` rewrites it to the active org API
version.

## Behavior Matrix

| Event / trigger                                          | Condition                                 | Result                                                                         |
| -------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| Extension load                                           | Extension enabled                         | Register `d360`, `d360_api`, `d360_metadata`, `d360_probe`, and `/sf-data360`. |
| `resources_discover`                                     | Extension enabled                         | Contribute `./skills` so `/skill:sf-data360` is visible.                       |
| Extension explicitly disabled + `/reload` or new session | —                                         | No `d360_api`, no `d360_metadata`, no `d360_probe`, no `sf-data360` skill.     |
| `d360`                                                   | search/examples/execute request           | Use registry-backed deterministic D360 capability discovery and execution.     |
| `d360_probe`                                             | Org readiness is uncertain                | Run read-only surface probes and classify readiness.                           |
| `d360_metadata`                                          | list/describe DMO/DLO request             | Return compact metadata and save raw JSON to a temp file.                      |
| `d360_api`                                               | `dry_run: true`                           | Return resolved request and safety decision without calling Salesforce.        |
| `d360_api`                                               | Read/query/validate/test request          | Execute via `@salesforce/core` Connection (`conn.request`).                    |
| `d360_api`                                               | `output_mode: "summary"` or `"file_only"` | Save full output to a temp file and avoid large inline payloads.               |
| `d360_api`                                               | Confirmation required and UI is available | Prompt the user to allow once or block.                                        |
| `d360_api`                                               | Confirmation required and headless        | Fail closed unless `SF_D360_ALLOW_HEADLESS_WRITE=1`.                           |

## DMO/DLO Discovery Defaults

For a simple "list DMOs" request, use `d360_metadata` with `action:
"list_dmos"` or the compact metadata endpoint
`/ssot/metadata-entities?entityType=DataModelObject`. Do not use
`/ssot/data-model-objects` broadly unless the user explicitly needs full DMO
field definitions or the standard catalog.

List actions cap inline output by default and save the full raw response to a temp file. Use `category` and `max_results` to narrow the inline table.

For record queries, describe one selected DMO first, run `COUNT(*)`, then sample
a small number of verified non-sensitive fields.

## Safety Model

| Request shape                                                                  | Behavior                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `GET`                                                                          | Allowed as read-only.                            |
| Safe `POST` paths such as metadata search, query, validate, or connection test | Allowed.                                         |
| `POST` run/publish/deploy/undeploy action paths                                | Confirmed.                                       |
| `PATCH` / `PUT`                                                                | Confirmed for production or unresolved orgs.     |
| `DELETE`                                                                       | Always confirmed.                                |
| Headless mutating call requiring confirmation                                  | Blocked unless `SF_D360_ALLOW_HEADLESS_WRITE=1`. |

Use `dry_run: true` before mutating calls to inspect the exact method, path,
target org, org type, and safety decision. For registry-backed `d360 execute`
capabilities with `safety: "confirmed"`, actual execution also requires
`allow_confirmed: true`; dry-run is the default review step, not the approval.

## Facade Capability Coverage

The `d360` facade registry is intentionally progressive: read-only capabilities
first, safe validation/test/search/query POST capabilities second,
non-destructive confirmed lifecycle capabilities third, and destructive capabilities
last only after stricter review UX exists.

The current coverage matrix, confirmed-capability workflow, and per-family
"what to run first" checklist live in
`skills/sf-data360/references/facade-coverage.md`.

## Skill and References

The bundled `sf-data360` skill is intentionally short. It points agents to
reference files under `skills/sf-data360/references/` for endpoint families,
workflow recipes, action coverage, facade coverage, request-body shapes, query patterns, examples,
safety rules, Agentforce Session Tracing (STDM), and Agent Platform Tracing.

Payload examples are capability-shaped. Some upstream payload examples are
variants of one executable capability instead of separate capabilities:

```json
{ "action": "examples", "capability": "d360_dmo_create" }
```

returns variants such as `profile`, `engagement`, and `other`, while:

```json
{ "action": "examples", "capability": "d360_dmo_create", "variant": "profile" }
```

returns the profile payload variant. Variant entries in `registry/examples.json`
carry their source key, for example `{ "capability": "d360_dmo_create", "variant": "profile" }`.

The phase skill pack (`sf-data360-connect`, `sf-data360-prepare`,
`sf-data360-harmonize`, `sf-data360-segment`, `sf-data360-act`,
`sf-data360-retrieve`, `sf-data360-observe`, and `sf-data360-orchestrate`) is
generated from `registry/phases.json` and the facade registry. These generated
`SKILL.md` files are committed so pi discovers them through the normal
extension-owned `resources_discover` skill path; run `npm run
generate-d360-skills` after changing phase mappings or capability coverage.

When local references are not enough, use the public upstream Data 360 MCP server
repo before broad web search: <https://github.com/forcedotcom/d360-mcp-server>.
It is reference material for the broad Data 360 capability surface, facade workflow,
action families, and public payload examples. This extension still does not run
or embed the Java MCP server.

Do not duplicate large endpoint catalogs in prompt injection. Keep large content
behind file references so the agent loads it only when needed.

## Settings Panel

`sf-data360` is enabled by default and marked configurable so it appears with a standardized drill-down panel in the `/sf-pi` extension manager. The v1 panel is read-only by design: it shows enablement, runtime backend, tools, safety behavior, and reference paths. There are no persistent preferences yet.

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
    api-tool.ts             ← implementation module
    config-panel.ts         ← implementation module
    extension-doctor.ts     ← implementation module
    facade-tool.ts          ← implementation module
    metadata-tool.ts        ← implementation module
    path.ts                 ← implementation module
    probe-tool.ts           ← implementation module
    safety.ts               ← implementation module
    target-org.ts           ← implementation module
    truncation.ts           ← implementation module
  tests/
    agent-observability-runbooks.test.ts← unit / smoke test
    api-card.test.ts        ← unit / smoke test
    api-tool.test.ts        ← unit / smoke test
    capability-sweep.test.ts← unit / smoke test
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
    smoke.test.ts           ← unit / smoke test
    target-org.test.ts      ← unit / smoke test
    truncation.test.ts      ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
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

The sweep writes JSON and Markdown artifacts to a temp directory and reports expected org-state limitations as structured non-failing outcomes.

Covered by unit tests:

- Compact metadata helper builds safe list/describe paths and summarizes DMO/DLO list and field payloads.
- Path normalization strips caller-supplied `/services/data/vNN.N` prefixes so the active API version wins.
- Query-string construction handles repeated values and skips nullish values.
- Safety classification allows reads/search/query/validation/count/test/preview calls, confirms deletes and operational action paths, and treats unresolved target orgs conservatively.
- Request resolution chooses the target org API version, resolves explicit non-default target orgs before execution, and fails closed if that resolution fails.
- HTTP errors from `Connection.request` surface as `{ status, body }` and are classified by `responseLooksLikeError`; the tool emits an error envelope instead of throwing.
- Salesforce REST error arrays embedded in 2xx responses are still classified as failed calls.
- Generated phase skills are committed, reproducible from `registry/phases.json`, and checked in the normal lint path.
- The capability sweep plans dry-run coverage for every facade capability, runs bounded read/safe-post live checks, dynamically follows list responses into detail reads when public-safe identifiers are available, can run focused sweep-owned mutation lifecycles behind an explicit destructive gate, writes a family summary table, supports coverage thresholds, and includes run-id cleanup helpers.

## Troubleshooting

**A simple DMO list returns too much data:** Use `d360_metadata` with `action: "list_dmos"`, `category`, and `max_results` instead of broad `/ssot/data-model-objects` calls.

**Metadata search fails but DMO/DLO lists work:** Treat this as search-plane readiness. Fall back to `d360_metadata` or `/ssot/metadata-entities`, then fetch one entity with `/ssot/metadata` or the DMO/DLO describe endpoint.

**Connector detail returns `NOT_FOUND`:** Use the connector catalog `name` from `GET /ssot/connectors`, not necessarily the `connectorType` shown on a connection.

**`/skill:sf-data360` is missing:** `sf-data360` is enabled by default, so first check whether it was explicitly disabled in `/sf-pi`, then run `/reload`. The skill is contributed by the extension, not registered as a standalone package skill.

**A mutating call is blocked in headless mode:** Re-run with `dry_run: true` and
review the resolved request. If automation should be allowed, set
`SF_D360_ALLOW_HEADLESS_WRITE=1` for that process.

**The wrong API version appears in my path:** Pass only the resource path, for
example `/ssot/data-model-objects`. If you pass `/services/data/vNN.N/...`, the
tool intentionally normalizes the version to the active org/project API version.
