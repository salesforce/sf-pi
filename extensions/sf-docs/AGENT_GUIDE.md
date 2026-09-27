# SF Docs Agent Guide

Use `sf_docs` for official Salesforce-owned documentation and product/reference grounding.

## Retrieval workflow

1. Use `ground` for implementation-sensitive questions; it deterministically records catalog, search, fallback, and fetch steps before returning evidence.
2. Use literal `search` for discovery and literal `fetch` when you already know the document ids or URLs.
3. Use `answer` for quick cited synthesis and broad explanations, not as implementation proof.
4. Use `collections` before guessing a non-default collection, version, locale, or format.
5. Use `explain` for one known document and `cheatsheet` only for SF Docs workflow guidance.
6. Leave locale as `auto` unless the user requests a specific language; fetch should reuse the concrete locale returned by search when available.

## Architecture Center source selection

For material Salesforce solution design or architecture review, use the `architect` collection with `version=current`. Choose the smallest source that answers the specific question; use `next` only for explicitly requested preview guidance.

| Need                                        | Start with                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Choose between viable approaches            | A relevant Decision Guide.                                                                       |
| Understand platform behavior or constraints | Fundamentals for the specific platform or domain.                                                |
| Weigh cross-cutting quality trade-offs      | The relevant Well-Architected pillar; add its agentic guidance when autonomous behavior matters. |
| Review a concrete design for risks          | Relevant patterns and anti-patterns, including specialist agentic pages.                         |
| Communicate a solution or data model        | Reference diagrams and notation; examples are not evidence of an org's actual architecture.      |
| Produce a policy, plan, or review artifact  | A resource template, only when that deliverable is needed.                                       |

- For a focused question or known URL, use `ground` with `collection=architect` and `version=current`. For broad discovery, search first and fetch the best-matching pages; treat the Patterns and Anti-Patterns Explorer as navigation, not an exhaustive list of specialist pages.
- If `sf_docs` is missing, disabled, or unable to retrieve evidence, use available web access to read the relevant official architect.salesforce.com page. Search the official domain once if the URL is unknown, then fetch the best match; retry only for a distinct evidence gap. Do not silently install or enable a disabled capability. If official content cannot be read, label the recommendation unverified and request a link or docs setup.
- Start with one primary source and stop when it resolves the choice or risk; avoid repeated near-identical searches. A `ground` verdict of `partial` with `retrieval=complete` and `content=truncated` is not a failed fetch; retry only if the missing passage matters. Expand only for a distinct unresolved risk or an exact behavior claim requiring developer documentation. For an explicitly broad audit, review the applicable pillars and patterns, including agentic counterparts where relevant, and state what was not reviewed.
- Cite the fetched page, not a search snippet or remembered link. Architecture guidance informs design; repository source and ADRs establish the existing design, owning tools establish org facts, and developer documentation establishes exact API behavior. Report gaps when no relevant evidence is available.
- Skip architecture lookup for routine edits or settled designs without new architectural risk. Use installed Pi documentation and repository evidence—not the Architecture Center—for Pi/SF Pi runtime design; consult both only for mixed concerns.

## Evidence rules

- Cite returned Salesforce source URLs when the answer depends on documentation; answer and explain always request citations.
- Treat malformed JSON-RPC or action payloads as tool failures, and distinguish failed or partial fetch retrieval from bounded content truncation.
- Preserve requested product, locale, release, and document-type constraints; report an evidence gap when results do not satisfy them.
- Explicit collection arguments are authoritative. `ground` rejects known URL/collection conflicts and uses developer peer fallback only when collection was inferred.
- Grounded developer-reference queries use underscore-prefixed guide values and can retry the peer `developer` or `legacydeveloper` collection.
- Grounded MuleSoft searches add `+latest:true` unless the query requests a specific component release; primitive search sends the caller's query unchanged.
- Route explicit Well-Architected, decision-guide, and reference-diagram questions to `architect`; do not route on the generic word “architecture” alone.
- Release-note requests require actual release-note evidence, not merely current-release metadata. Use `admin` or omit the collection for seasonal release-note grounding; query `developer` separately for current technical reference documentation.
- Use web access to read official pages when `sf_docs` is unavailable or cannot retrieve applicable evidence. Broaden beyond official sources only when official evidence is insufficient or the user requests external sources.
- Do not use SF Docs as a generic web search or as a substitute for current-org schema/runtime evidence.

## Related domain skills

Prefer `sf_docs` when it can do the action. If it cannot, read this Salesforce skill:
`platform-docs-get`
