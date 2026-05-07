# SF Data 360 — Code Walkthrough

## What It Does

`sf-data360` gives agents a small, deterministic way to work with Salesforce
Data Cloud / Data 360 REST APIs without adding MCP support and without exposing
hundreds of endpoint-specific tools.

It registers three native tools:

- `d360_api` — calls Data 360 REST endpoints through `sf api request rest` using the
  active Salesforce CLI auth context.
- `d360_metadata` — compact list/describe helpers for common DMO and DLO
  discovery tasks, avoiding broad nested catalog payloads by default.
- `d360_probe` — runs read-only probes across core Data 360 surfaces and
  classifies org readiness as ready, ready-empty, partial, or blocked.

It is enabled by default and contributes an extension-owned `sf-data360` skill. The skill is only visible while this extension is enabled, so explicitly disabling the extension removes both the tools and the skill on `/reload` or new sessions.

## Design Rationale

The intended balance is:

- **Context-efficient:** three small tools plus a small skill description.
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
  ├─ register d360_api, d360_metadata, and d360_probe
  ├─ register /sf-data360
  └─ resources_discover
       └─ contribute ./skills so /skill:sf-data360 exists only while enabled

Agent calls d360_api
  ├─ Resolve SF environment from shared sf-pi cache / sf CLI
  ├─ Normalize path to /services/data/v<active-api-version>/...
  ├─ Classify safety by method + path
  ├─ dry_run? → return resolved request, no network call
  ├─ confirmation required? → ask user or fail closed in headless mode
  └─ sf api request rest ...
       └─ truncate large output and save full result to temp file
```

## Metadata Helper Shape

```json
{ "action": "list_dmos" }
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

| Event / trigger                                          | Condition                                 | Result                                                                     |
| -------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Extension load                                           | Extension enabled                         | Register `d360_api`, `d360_metadata`, `d360_probe`, and `/sf-data360`.     |
| `resources_discover`                                     | Extension enabled                         | Contribute `./skills` so `/skill:sf-data360` is visible.                   |
| Extension explicitly disabled + `/reload` or new session | —                                         | No `d360_api`, no `d360_metadata`, no `d360_probe`, no `sf-data360` skill. |
| `d360_probe`                                             | Org readiness is uncertain                | Run read-only surface probes and classify readiness.                       |
| `d360_metadata`                                          | list/describe DMO/DLO request             | Return compact metadata and save raw JSON to a temp file.                  |
| `d360_api`                                               | `dry_run: true`                           | Return resolved request and safety decision without calling Salesforce.    |
| `d360_api`                                               | Read/query/validate/test request          | Execute via `sf api request rest`.                                         |
| `d360_api`                                               | `output_mode: "summary"` or `"file_only"` | Save full output to a temp file and avoid large inline payloads.           |
| `d360_api`                                               | Confirmation required and UI is available | Prompt the user to allow once or block.                                    |
| `d360_api`                                               | Confirmation required and headless        | Fail closed unless `SF_D360_ALLOW_HEADLESS_WRITE=1`.                       |

## DMO/DLO Discovery Defaults

For a simple "list DMOs" request, use `d360_metadata` with `action:
"list_dmos"` or the compact metadata endpoint
`/ssot/metadata-entities?entityType=DataModelObject`. Do not use
`/ssot/data-model-objects` broadly unless the user explicitly needs full DMO
field definitions or the standard catalog.

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
target org, org type, and safety decision.

## Skill and References

The bundled `sf-data360` skill is intentionally short. It points agents to
reference files under `skills/sf-data360/references/` for endpoint families,
workflow recipes, request-body shapes, query patterns, examples, and safety rules.

Do not duplicate large endpoint catalogs in prompt injection. Keep large content
behind file references so the agent loads it only when needed.

## Settings Panel

`sf-data360` is enabled by default and marked configurable so it appears with a standardized drill-down panel in the `/sf-pi` extension manager. The v1 panel is read-only by design: it shows enablement, runtime backend, tools, safety behavior, and reference paths. There are no persistent preferences yet.

## Commands

- `/sf-data360` — show status.
- `/sf-data360 help` — show usage guidance.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-data360/
  lib/
    api-tool.ts             ← implementation module
    config-panel.ts         ← implementation module
    metadata-tool.ts        ← implementation module
    path.ts                 ← implementation module
    probe-tool.ts           ← implementation module
    safety.ts               ← implementation module
    truncation.ts           ← implementation module
  tests/
    api-tool.test.ts        ← unit / smoke test
    metadata-tool.test.ts   ← unit / smoke test
    path.test.ts            ← unit / smoke test
    probe-tool.test.ts      ← unit / smoke test
    safety.test.ts          ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
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

Covered by unit tests:

- Compact metadata helper builds safe list/describe paths and summarizes DMO/DLO list and field payloads.
- Path normalization strips caller-supplied `/services/data/vNN.N` prefixes so the active API version wins.
- Query-string construction handles repeated values and skips nullish values.
- Safety classification allows reads/search/query/validation calls, confirms deletes and action paths, and treats unknown target orgs conservatively.
- Request resolution chooses the active org API version and fails closed for non-default target orgs.

## Troubleshooting

**A simple DMO list returns too much data:** Use `d360_metadata` with `action: "list_dmos"` instead of broad `/ssot/data-model-objects` calls.

**`/skill:sf-data360` is missing:** `sf-data360` is enabled by default, so first check whether it was explicitly disabled in `/sf-pi`, then run `/reload`. The skill is contributed by the extension, not registered as a standalone package skill.

**A mutating call is blocked in headless mode:** Re-run with `dry_run: true` and
review the resolved request. If automation should be allowed, set
`SF_D360_ALLOW_HEADLESS_WRITE=1` for that process.

**The wrong API version appears in my path:** Pass only the resource path, for
example `/ssot/data-model-objects`. If you pass `/services/data/vNN.N/...`, the
tool intentionally normalizes the version to the active org/project API version.
