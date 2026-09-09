# SF Docs Agent Guide

Use `sf_docs` for official Salesforce-owned documentation and product/reference grounding.

## Retrieval workflow

1. Use `search` for implementation-sensitive questions.
2. Fetch only the strongest result ids with `fetch` before finalizing code-sensitive guidance.
3. Use `answer` for quick cited synthesis and broad explanations.
4. Use `collections` before guessing a non-default collection, version, locale, or format.
5. Use `explain` for one known document and `cheatsheet` only for SF Docs workflow guidance.
6. Leave locale as `auto` unless the user requests a specific language; fetch should reuse the concrete locale returned by search when available.

## Evidence rules

- Cite returned Salesforce source URLs when the answer depends on documentation; answer and explain always request citations.
- Treat malformed JSON-RPC or action payloads as tool failures, and distinguish failed or partial fetch retrieval from bounded content truncation.
- Preserve requested product, locale, release, and document-type constraints; report an evidence gap when results do not satisfy them.
- Developer-reference queries use underscore-prefixed guide values and retry the peer `developer` or `legacydeveloper` collection when the preferred collection has no matches.
- MuleSoft searches add `+latest:true` unless the query requests a specific component release.
- Route explicit Well-Architected, decision-guide, and reference-diagram questions to `architect`; do not route on the generic word “architecture” alone.
- Release-note requests require actual release-note evidence, not merely current-release metadata.
- Fall back to broader web research only when official docs are missing, weak, or the user explicitly requests external sources.
- Do not use SF Docs as a generic web search or as a substitute for current-org schema/runtime evidence.

## Related domain skills

Prefer `sf_docs` when it can do the action. If it cannot, read this Salesforce skill:
`platform-docs-get`
