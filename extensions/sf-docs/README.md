# SF Docs — Code Walkthrough

## What It Does

SF Docs gives agents and humans a first-class Salesforce documentation lookup surface inside SF Pi. It exposes one `sf_docs` family tool for collection discovery, search, fetch, cited answers, single-document explanations, status, and a lazy cheatsheet.

SF Docs calls the Salesforce Docs service through direct HTTP JSON-RPC/SSE. It does not run a local MCP server and does not install MCP packages.

## Runtime Flow

```
Extension loads
  ├─ registers provider auth entry `sf-docs`
  ├─ registers the `sf_docs` family tool
  ├─ registers `/sf-docs`
  └─ registers Manager detail actions

Agent asks for official docs
  ├─ sf_docs resolves token from Pi auth, then env fallback
  ├─ sf_docs resolves endpoint default, then env override
  ├─ client POSTs tools/call to the docs service
  ├─ SSE parser extracts the JSON-RPC response
  └─ renderers return compact LLM content + polished human output
```

## Key Architecture Decisions

- **Credential storage:** The token lives in Pi's auth store under provider id `sf-docs`. `SF_DOCS_MCP_TOKEN` is an automation fallback.
- **Transport:** `lib/client.ts` and `lib/sse.ts` implement the narrow HTTP JSON-RPC/SSE protocol directly.
- **Tool shape:** `sf_docs` is one family tool instead of one public tool per remote action.
- **Cache boundary:** `lib/catalog-cache.ts` stores only the collection catalog. Search results, answers, and document bodies are never cached.
- **Evidence workflow:** For implementation-sensitive answers, agents should search, fetch source documents, and then answer from inspected evidence. The `answer` action remains available for quick cited synthesis.
- **Docs Query Distillation:** Salesforce-owned docs URLs, article-like locators, and seasonal release-note requests are turned into compact MCP-native search variants before `search`; failed URL `fetch` calls can recover by fetching the strongest indexed result ID.
- **MCP-native retrieval:** The wrapper uses documented service retrieval language such as `+release:<n>` and bare `guides:<slug>` boosts instead of maintaining a local docs index or release-note resolver.
- **Evidence gates:** Release-specific answer paths must find matching official evidence before synthesis; if the docs service has no matching release slice, SF Docs reports the coverage gap instead of silently broadening to unrelated docs.
- **Human output:** The tool separates compact Docs Result Cards from bounded Docs Evidence Packets, and compiled lookups include a visible query plan so humans can catch retrieval drift.

## Behavior Matrix

| Event/Trigger          | Condition            | Result                                                                                                                                                                     |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| extension load         | always               | Registers auth provider, command, tool, and Manager actions.                                                                                                               |
| `/sf-docs`             | interactive, no args | Opens SF Pi Manager at SF Docs detail page.                                                                                                                                |
| `/sf-docs status`      | any                  | Shows auth source, endpoint, defaults, and cache status.                                                                                                                   |
| `/sf-docs connect`     | interactive          | Prompts for token and stores it in Pi auth.                                                                                                                                |
| `/sf-docs disconnect`  | any                  | Clears saved Pi auth credential; env vars are untouched.                                                                                                                   |
| `/sf-docs collections` | connected            | Lists docs collections with balanced capability summaries, using the catalog cache when valid.                                                                             |
| `/sf-docs refresh`     | connected            | Refetches and caches the collection catalog.                                                                                                                               |
| `/sf-docs cheatsheet`  | any                  | Shows the lazy extension-owned usage guide.                                                                                                                                |
| `sf_docs search`       | connected            | Searches one collection/version/locale slice; Salesforce-owned docs locators and seasonal release-note requests are distilled into high-signal MCP-native search variants. |
| `sf_docs fetch`        | connected            | Fetches source text by IDs or URLs; failed Salesforce-owned docs URL fetches can recover through distilled search and indexed IDs while preserving release filters.        |
| `sf_docs answer`       | connected            | Returns a cited synthesized answer; release-specific answers first pass an evidence gate.                                                                                  |

## Settings

The Manager settings page stores only non-secret preferences:

- default collection
- default version
- default locale
- default fetch format
- default search page size
- include citations
- cache catalog

Preferences are scoped as project > global > extension default. The token is not a setting; use Connect or `SF_DOCS_MCP_TOKEN`.

## Result Mocks

See [`docs/result-mocks.md`](./docs/result-mocks.md) for lightweight examples of what humans see in the TUI versus what the LLM receives for each `sf_docs` action.

## Cheatsheet

See [`docs/cheatsheet.md`](./docs/cheatsheet.md). It is an extension-owned reference, not a Pi skill, and is loaded only when requested.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-docs/
  lib/
    auth.ts                 ← implementation module
    catalog-cache.ts        ← implementation module
    client.ts               ← implementation module
    command-surface.ts      ← implementation module
    config-panel.ts         ← implementation module
    manager-action-panels.ts← implementation module
    preferences.ts          ← implementation module
    query-distillation.ts   ← implementation module
    render.ts               ← implementation module
    sf_docs-tool.ts         ← implementation module
    sse.ts                  ← implementation module
    status.ts               ← implementation module
    types.ts                ← implementation module
  tests/
    auth.test.ts            ← unit / smoke test
    catalog-cache.test.ts   ← unit / smoke test
    client.test.ts          ← unit / smoke test
    preferences.test.ts     ← unit / smoke test
    query-distillation.test.ts← unit / smoke test
    render.test.ts          ← unit / smoke test
    sf_docs-tool.test.ts    ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    sse.test.ts             ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Targeted tests cover parser, client, auth, preferences, cache, tool routing, and render output. Live docs-service smoke tests are opt-in and should not run in the default suite because they require a real token.

Run:

```bash
npm test -- extensions/sf-docs
```

## Troubleshooting

**SF Docs says it is not connected:**
Run `/sf-docs connect` in interactive mode, or set `SF_DOCS_MCP_TOKEN` for automation.

**Collections look stale:**
Run `/sf-docs refresh` or call `sf_docs` with `action="collections"` and `refresh=true`.

**A fetch returned the wrong locale or version:**
Fetch IDs using the same collection, version, and locale returned by search. Some collections do not share IDs across locales.
