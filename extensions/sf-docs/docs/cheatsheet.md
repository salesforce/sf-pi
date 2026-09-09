# SF Docs Cheatsheet

Use SF Docs when you need official Salesforce documentation inside pi. SF Docs is an SF Pi-native extension; it does not run a local MCP server and does not expose raw MCP tools.

## Agent workflow

1. Start with `sf_docs action="collections"` when the collection/version/locale is unclear.
2. For implementation-sensitive work, prefer `sf_docs action="search"` then `sf_docs action="fetch"` for the most relevant IDs.
3. Use `sf_docs action="answer"` for quick cited synthesis or broad explanatory questions.
4. Include visible citation URLs in final answers when SF Docs returns them.
5. For broad official-docs research, run 2–4 independent `search` calls in parallel with varied exact phrases, then fetch only the strongest 3–4 source candidates.

## Human vs LLM output

SF Docs separates human **Docs Result Cards** from model-facing **Docs Evidence Packets**. Result cards stay compact and show source URLs, counts, headings, bounded previews, and packet summaries. Evidence packets carry globally bounded source text for grounding model answers.

See [`result-mocks.md`](./result-mocks.md) for simple examples of what humans see versus what the LLM sees.

## Actions

| Action        | Use when                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| `status`      | Check endpoint configuration, defaults, and catalog-cache status.              |
| `collections` | Discover valid collections, versions, locales, formats, hints, and landmarks.  |
| `search`      | Find candidate docs. Omit `format` for a cheap first pass.                     |
| `fetch`       | Read full source text by `ids` or `urls`. Use the same slice used by search.   |
| `answer`      | Get a quick cited synthesis from one collection slice; citations are required. |
| `explain`     | Ask about one known document by `id` or `url`; citations are required.         |
| `cheatsheet`  | Load this reference only when SF Docs workflow guidance is needed.             |

## Collection defaults

Default settings are optimized for Salesforce development:

```text
collection: developer
version: current
locale: auto
format: markdown
pageSize: 5
```

Known collections include `developer`, `admin`, `architect`, `legacydeveloper`, `mulesoft`, and `tableau`.

Collection versions such as `current` are docs-service slices, not Salesforce seasonal releases. Search and answer omit locale when the effective value is `auto`, allowing service-side language detection. For Salesforce release-note lookups, keep `version="current"` and put seasonal releases in the query with retrieval language such as `+release:260`.

Collection routing quick guide:

- `admin` — Salesforce Help/Admin docs, latest product docs, and the latest three Salesforce release-note releases.
- `developer` — current developer guides and migrated reference material.
- `legacydeveloper` — deprecating Atlas-backed references such as Apex Reference, Metadata API, Tooling API, Object Reference, Visualforce, and Chatter REST. Reference searches retry the peer developer collection when the preferred collection has no matches.
- `architect` — architecture guidance and reference diagrams.
- `tableau` — Tableau product and API docs.
- `mulesoft` — MuleSoft and Anypoint Platform docs. Searches add `+latest:true` unless the query requests a component release.

## Search tips

- Quote exact phrases: `"Named Credentials"`.
- Include product names, API names, class names, error codes, and config keys verbatim.
- Use collection hints from `collections` before guessing `+guides:` filters or `+release:<n>` release filters. Current guide values are underscore-prefixed, for example `guides:_api_meta`.
- Retry with fewer terms or a different phrase when top results are weak.
- You can pass Salesforce-owned docs URLs directly to `search`; SF Docs distills supported docs locators into high-signal search terms before querying.
- Seasonal release-note queries such as `Spring '26 release notes` are distilled toward the matching Salesforce Help release notes in the admin collection using MCP-native `+release:<n>` filters. If the docs service has no matching release slice, SF Docs reports the coverage gap instead of broadening to unrelated docs.
- For product scoping, prefer bare `guides:_<slug>` boosts unless you explicitly need to restrict to one product area. Hard `+guides:_<slug>` can exclude broad release-note overview pages.

## Fetch tips

- Fetch IDs from the same `collection`, `version`, and `locale` that produced them.
- If a supported Salesforce-owned docs URL fetch returns no usable body, SF Docs can recover by distilled search and then fetch the strongest indexed document ID. Release-note URL recovery preserves the URL's `release=` parameter as an MCP-native `+release:<n>` filter.
- Prefer fetching the strongest 3–4 source candidates; `fetch` accepts more for compatibility, but the Docs Evidence Packet is globally bounded.
- Fetch results report retrieval as `complete`, `partial`, or `failed`, and report content truncation separately. A recovery is successful only after the recovered document body is usable.
- Fetch packets include safe source metadata such as filename, source path, base URL, product, guide, locale, and release. Opaque content hashes stay in structured details / expanded human render, not the default LLM packet text.
- Use `markdown` when headings, code blocks, lists, or tables matter.
- Use `text` for compact triage.
- Answer and explain always request citations and return at most 16,000 answer characters and 12 citation records to the model.
- Avoid caching fetched docs in project files unless the user explicitly asks.

## Setup

Primary setup lives in the SF Pi Manager detail page:

```text
/sf-docs
```

The detail page reports the endpoint configuration source and prepares native login. Interactive setup collects and persists only an internally supplied docs endpoint URL while Pi owns persistence and logout:

```text
/login sf-docs
```

For non-persisted automation, set the endpoint before starting Pi:

```text
SF_DOCS_MCP_ENDPOINT=https://docs.example.com/
```

No access token is required, stored, or transmitted. SF Docs ships with no default endpoint. Configure the internally supplied docs service URL through login or the environment variable.

## Safety boundaries

- `/login sf-docs` stores only the endpoint URL in Pi's provider-scoped configuration.
- The configured service endpoint is omitted from model-visible status output.
- Settings are non-secret preferences only.
- The catalog cache stores only collection metadata, never search results, answer text, or fetched document bodies.
- SF Docs uses the Salesforce Docs service as its retrieval surface; it does not scrape Salesforce websites, download documentation bundles, or build a local search index.
- The extension uses native HTTP fetch plus a small local SSE parser; no MCP package is required.
