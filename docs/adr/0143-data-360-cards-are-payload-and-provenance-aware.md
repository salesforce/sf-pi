---
id: "0143"
status: accepted
date: 2026-10-08
supersedes: ["0142"]
---

# Data 360 cards are payload- and provenance-aware

## Context

ADR 0142 required API, outcome, request, and response sections on every Data 360 card. That improved direct API calls but made local Discover actions, derived Observe runbooks, and Orchestrate plans repeat that no network request or response existed. Their useful payloads are heterogeneous: `response`, `result.data.rows`, `results`, `actions`, `journeys`, contracts, plans, and execution chains. The universal API scaffold ignored those shapes.

Compact cards also hid domain samples for non-`response` payloads, while expanded cards retained the response preview limit instead of showing the full human-requested payload. Turn-level Mermaid traces showed call order as dependency and omitted simplified endpoint paths.

## Decision

The Data 360 presenter classifies each result as direct API, local catalog, derived analysis, or orchestration. All cards show outcome followed immediately by a five-row or bounded domain Preview. API, Request, and Response sections appear only for direct API calls. Derived analysis may show its grounded source calls without claiming that the transformed result is an API response.

One canonical payload resolver supports direct responses, nested analysis rows, search results, actions, journeys, contracts, recommended actions, plans, probes, and execution chains. Discover, Observe, and Orchestrate add focused adapters for search criteria, action contracts, readiness, session and trace data, latency metrics, journeys, recommendations, and execution steps.

Collapsed direct API cards retain an eight-line sanitized response preview. Expanded cards render the complete sanitized request and response; local, analysis, and orchestration cards render their complete canonical result. Expanded display is bounded at 5,000 lines or 2 MB to protect terminal responsiveness, while the existing artifact keeps the complete payload.

Turn-level Mermaid projections show versionless endpoint templates. Independent calls fan out from the resolved Data 360 work; only pagination series and proven execution chains render sequentially. Omitted calls are summarized by business module and endpoint count rather than an opaque remaining-call count. URLs, org identifiers, opaque tokens, and raw utterances remain excluded.

## Consequences

- Successful compact cards always contain real result insight rather than only status.
- Local actions no longer show fake API, Request, or Response placeholders.
- Observe runbooks preserve the Query SQL source-call evidence used to derive their metrics.
- Orchestrate cards expose journeys, recommendations, phases, or execution steps.
- Expanded payloads can be large by explicit user choice but remain sanitized and hard-bounded.
- Diagram arrows distinguish observed dependency from independent work.
- The shared presenter still owns all 577 actions; endpoint-specific tools or card implementations are not introduced.
