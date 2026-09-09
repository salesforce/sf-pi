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
- `developer` covers current developer guides and migrated reference material.
- `legacydeveloper` is the deprecating Atlas-backed reference collection. Reference
  searches retry the peer developer collection when the preferred collection has
  no matches.
- `architect`, `tableau`, and `mulesoft` cover their corresponding sites. MuleSoft
  searches prefer `+latest:true` unless a component release is requested.

Implementation-sensitive work should search, inspect the selected source, then
answer from that evidence. Release-specific answers fail closed when matching
official evidence is unavailable.

## Commands

| Command            | Purpose                               |
| ------------------ | ------------------------------------- |
| `/sf-docs`         | Open SF Docs in the SF Pi Manager     |
| `/sf-docs connect` | Prepare native endpoint configuration |
| `/sf-docs refresh` | Refresh the collection catalog        |
| `/sf-docs status`  | Print endpoint and service readiness  |
| `/sf-docs help`    | Print usage guidance                  |

## Configuration

The Manager stores non-secret defaults for collection, version, locale, fetch
format, page size, display density, and collection-catalog caching. Answer and
explain actions always request citations.
Project values override global values, then extension defaults.

Use `/login sf-docs` to enter an internally supplied docs endpoint URL. Pi
persists only that endpoint and owns logout. No access token is required, stored,
or transmitted. SF Docs ships with no default endpoint.
`SF_DOCS_MCP_ENDPOINT` remains the non-persisted automation override.

## Safety and Data Boundaries

- Only the collection catalog can be cached; search results, answers, citations,
  prompts, and document bodies are not cached.
- The configured service endpoint stays out of model-visible status output.
- Documentation source URLs and citations remain visible so evidence can be reviewed.
- Answer and explain responses are bounded to 16,000 characters and 12 citations.
- Fetch results distinguish complete, partial, and failed retrieval from content truncation.
- The extension uses native fetch and a small SSE parser, with no extra MCP
  runtime or server process.

## References

Use [`docs/README.md`](./docs/README.md) to choose collection/query guidance,
result-card examples, or the lazy cheatsheet. Agent search/fetch ordering and
release-note recovery live in [`AGENT_GUIDE.md`](./AGENT_GUIDE.md).

## Troubleshooting

**SF Docs is not configured:** Run `/sf-docs connect`, submit the prefilled
native login command, and enter the internally supplied docs endpoint URL. No
access token is required. For automation, set `SF_DOCS_MCP_ENDPOINT` before
starting Pi.

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
