---
id: "0142"
status: accepted
date: 2026-10-07
---

# Data 360 cards prioritize observed API work

## Context

ADR 0141 established one `sf_data360` SDK tool with a semantic Run Digest and a separate human Run Card. The first card projection kept evidence and next-step sections visible while hiding request and response detail in collapsed mode. Repeated paginated calls therefore looked nearly identical even when offsets advanced, and the card used scarce terminal space for artifact paths and generic advice instead of the API interaction itself.

Data 360 orchestration can span several business namespaces and API calls in one assistant turn. Users need a grounded view of what was requested, which transport and endpoint ran, how pagination advanced, and what the service returned. Models still need artifact references, next-step guidance, and stable structured data.

## Decision

Every Data 360 human Run Card uses one mandatory scaffold across all business namespaces: API rail, outcome, request, and response. Both collapsed and expanded cards show the scaffold. Response JSON is previewed at no more than eight lines; complete payloads remain available through the existing semantic and artifact contracts.

Evidence and next-step sections remain in `Data360RunDigest`, compact model content, and `structuredContent`, but the human renderer never displays them as card sections.

Offset pagination is explicit presentation data derived from the observed request and response. Cards show page, item range, batch size, offset, limit, and returned count when those facts are available. Cursor, chunk, and next-batch requests use bounded labels without displaying opaque tokens.

The extension accumulates grounded `sf_data360` results during one assistant turn. When at least two non-local API calls were observed, it projects their business namespaces, actions, methods, pagination, and aggregate outcome into one bounded top-level Mermaid flowchart during `message_end`. The diagram excludes raw utterances, URLs, credentials, and inferred dependencies. Single straightforward API calls do not produce a diagram.

## Consequences

- Repeated offset calls are distinguishable without reading long URLs.
- Collapsed cards are taller but contain the information users most often need.
- All 577 actions inherit the same presentation contract through the shared digest and renderer.
- Domain SQL, metadata, tables, warnings, and failures remain additive sections.
- Local and dry-run actions explicitly report that no network request or response occurred.
- Models and headless consumers retain evidence and recovery context even though human cards omit those sections.
- Mermaid remains outside the custom TUI card so Pi's native Markdown renderer and user settings remain authoritative.
- Dense lineage, field mapping, and reference architecture views remain separate future projections rather than being inferred from ordinary API calls.
