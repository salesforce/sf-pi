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

| Action        | Use when                                                                      |
| ------------- | ----------------------------------------------------------------------------- |
| `status`      | Check auth, endpoint, defaults, and catalog-cache status.                     |
| `collections` | Discover valid collections, versions, locales, formats, hints, and landmarks. |
| `search`      | Find candidate docs. Omit `format` for a cheap first pass.                    |
| `fetch`       | Read full source text by `ids` or `urls`. Use the same slice used by search.  |
| `answer`      | Get a quick cited synthesis from one collection slice.                        |
| `explain`     | Ask about one known document by `id` or `url`.                                |
| `cheatsheet`  | Load this reference only when SF Docs workflow guidance is needed.            |

## Collection defaults

Default settings are optimized for Salesforce development:

```text
collection: developer
version: current
locale: en-us
format: markdown
pageSize: 5
```

Known collections include `developer`, `admin`, `architect`, `legacydeveloper`, `mulesoft`, and `tableau`.

## Search tips

- Quote exact phrases: `"Named Credentials"`.
- Include product names, API names, class names, error codes, and config keys verbatim.
- Use collection hints from `collections` before guessing `+guides:` filters.
- Retry with fewer terms or a different phrase when top results are weak.

## Fetch tips

- Fetch IDs from the same `collection`, `version`, and `locale` that produced them.
- Prefer fetching the strongest 3–4 source candidates; `fetch` accepts more for compatibility, but the Docs Evidence Packet is globally bounded.
- Use `markdown` when headings, code blocks, lists, or tables matter.
- Use `text` for compact triage.
- Avoid caching fetched docs in project files unless the user explicitly asks.

## Setup

Primary setup lives in the SF Pi Manager detail page:

```text
/sf-docs
```

Use **Connect / Re-authenticate** to store the token in Pi's local auth store under `sf-docs`.

Automation fallback:

```text
SF_DOCS_MCP_TOKEN=<token>
```

Advanced endpoint override for testing only:

```text
SF_DOCS_MCP_ENDPOINT=https://mcp.docs.salesforce.com/
```

## Safety boundaries

- Tokens are never stored in project settings.
- Settings are non-secret preferences only.
- The catalog cache stores only collection metadata, never search results, answer text, or fetched document bodies.
- The extension uses native HTTP fetch plus a small local SSE parser; no MCP package is required.
