# SF Docs Agent Guide

Use `sf_docs` for official Salesforce-owned documentation and product/reference grounding.

## Retrieval workflow

1. Use `search` for implementation-sensitive questions.
2. Fetch only the strongest result ids with `fetch` before finalizing code-sensitive guidance.
3. Use `answer` for quick cited synthesis and broad explanations.
4. Use `collections` before guessing a non-default collection, version, locale, or format.
5. Use `explain` for one known document and `cheatsheet` only for SF Docs workflow guidance.

## Evidence rules

- Cite returned Salesforce source URLs when the answer depends on documentation.
- Preserve requested product, locale, release, and document-type constraints; report an evidence gap when results do not satisfy them.
- Developer-reference queries can route to the legacy developer collection automatically.
- Release-note requests require actual release-note evidence, not merely current-release metadata.
- Fall back to broader web research only when official docs are missing, weak, or the user explicitly requests external sources.
- Do not use SF Docs as a generic web search or as a substitute for current-org schema/runtime evidence.

## Related domain skills

Prefer `sf_docs` when it can do the action. If it cannot, read this Salesforce skill:
`platform-docs-get`
