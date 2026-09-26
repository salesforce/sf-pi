---
id: "0077"
status: superseded
date: 2026-08-05
supersededBy: ["0122"]
---

# ADR 0077: Dynamic Gateway Model Catalog

SF Pi obtains gateway model IDs only from authenticated discovery and uses Pi's provider-scoped cache as the last-known catalog; a fresh uncached provider exposes no models until discovery succeeds. Generic family inference may complete missing model metadata, but SF Pi does not bundle an exact-ID preset catalog, default model ID, or fallback model ID. When gateway routing needs a default, SF Pi preserves a still-available gateway choice and otherwise selects the stable first discovered callable model.
