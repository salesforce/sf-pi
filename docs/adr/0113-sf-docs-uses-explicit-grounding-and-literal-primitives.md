---
id: "0113"
status: accepted
date: 2026-09-09
supersedes: ["0073"]
---

# ADR 0113: SF Docs Uses Explicit Grounding and Literal Primitives

SF Docs exposes deterministic multi-step retrieval through `action="ground"`. Ground validates the effective slice against the current service catalog, records each catalog/search/fetch step, fetches known documentation URLs directly, performs at most one search and one refetch for URL recovery, and returns bounded evidence with a grounded, partial, or not-grounded verdict. It does not call the remote answer action or use an LLM to select evidence.

Primitive search, fetch, answer, and explain actions each perform one literal remote operation. Explicit collection values are authoritative: ground rejects known URL/collection conflicts, and developer-to-legacydeveloper peer fallback is available only when collection was inferred. MuleSoft latest-version compilation, release-note evidence gates, URL inference, and bounded recovery belong to ground rather than hidden primitive behavior.

The service `list` response is authoritative for collection descriptions, versions, locales, formats, hints, and landmarks. SF Pi removes its duplicate static collection profiles and retains only narrow routing and evidence policy that the service catalog does not express. Catalog cache entries are scoped by a one-way endpoint identity so changing an internally supplied endpoint cannot reuse another endpoint's catalog, while the endpoint URL itself is never cached. This narrows ADR 0073's transparent developer-reference routing to the explicit ground workflow.
