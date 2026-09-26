---
id: "0122"
status: accepted
date: 2026-09-26
supersedes: ["0077"]
---

# ADR 0122: Gateway Catalog Requires Pi-Backed IDs

SF Pi obtains candidate model IDs only from authenticated Gateway discovery, but publishes an ID only when an exact public Pi catalog entry provides a reusable Chat Completions, Responses, or Messages API. The same admission filter applies to Pi-restored provider cache entries, so unmatched deployment IDs disappear on offline startup as well as after live refresh. Filtered IDs remain bounded discovery diagnostics; sf-pi does not interpret model suffixes, backend placement, or route aliases.

This narrows ADR 0100's conservative fallback: authenticated availability alone no longer admits an unknown ID. Sentinel-only empty access still clears the catalog, ambiguous empty or failed discovery retains the last admitted catalog, and a successful discovery containing only unmatched IDs authoritatively publishes an empty catalog.
