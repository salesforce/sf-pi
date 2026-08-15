# SF Docs

## What It Does

SF Docs gives agents and humans a first-class Salesforce documentation lookup
surface inside SF Pi. The `sf_docs` family supports status, collection
discovery, search, fetch, cited answers, single-document explanations, and a
lazy cheatsheet.

It calls the Salesforce Docs service through direct HTTP JSON-RPC/SSE. It does
not run a local MCP server, scrape Salesforce sites, build a local document
index, or cache fetched document bodies.

## Collection coverage

Collection versions such as `current` are service slices, not Salesforce
seasonal releases. Seasonal release-note filters belong in the query, for
example `+release:260`.

- `admin` covers Salesforce Help/Admin docs and a bounded release-note window.
- `developer` covers current non-Atlas developer guides.
- `legacydeveloper` covers Atlas-backed reference material such as Apex,
  Metadata API, Tooling API, Object Reference, and Visualforce.
- `architect`, `tableau`, and `mulesoft` cover their corresponding sites.

Implementation-sensitive work should search, inspect the selected source, then
answer from that evidence. Release-specific answers fail closed when matching
official evidence is unavailable.

## Commands

| Command            | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `/sf-docs`         | Open SF Docs in the SF Pi Manager             |
| `/sf-docs connect` | Prepare the native `/login sf-docs` flow      |
| `/sf-docs refresh` | Refresh identity and collection catalog state |
| `/sf-docs status`  | Print credential and service readiness        |
| `/sf-docs help`    | Print usage guidance                          |

## Configuration

The Manager stores non-secret defaults for collection, version, locale, fetch
format, page size, citations, display density, and collection-catalog caching.
Project values override global values, then extension defaults.

Use `/login sf-docs` for masked interactive credential entry. Pi owns credential
persistence and logout. `SF_DOCS_MCP_TOKEN` and `SF_DOCS_MCP_ENDPOINT` remain
non-persisted automation overrides.

## Safety and Data Boundaries

- Only the collection catalog can be cached; search results, answers, citations,
  prompts, and document bodies are not cached.
- Token-bearing values are redacted from errors and UI surfaces.
- URLs and citations remain visible so evidence can be reviewed.
- The extension uses native fetch and a small SSE parser, with no extra MCP
  runtime or server process.

## References

Use [`docs/README.md`](./docs/README.md) to choose collection/query guidance,
result-card examples, or the lazy cheatsheet. Agent search/fetch ordering and
release-note recovery live in [`AGENT_GUIDE.md`](./AGENT_GUIDE.md).

## Troubleshooting

**SF Docs is not connected:** Run `/sf-docs connect`, submit the prefilled native
login command, and enter the token in the fixed-mask component. For automation,
set `SF_DOCS_MCP_TOKEN` before starting Pi.

**Collections look stale:** Run `/sf-docs refresh` or request `collections` with
`refresh=true`.

**Fetch returns the wrong locale or version:** Reuse the collection, version,
and locale returned by search; collection document IDs are not always portable
across slices.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-docs/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
