---
id: "0146"
status: accepted
date: 2026-10-08
---

# ADR 0146: SF SOQL Execution Is API-Aware and Self-Grounding

## Context

ADR 0070 established an API-native SOQL lifecycle with explicit REST versus Tooling execution and described schema discovery as an agent workflow step. Production session evidence showed that prompt ordering was not a sufficient correctness boundary: callers sometimes executed before discovery, often described an object without validating the exact query, and could validate against regular REST metadata before executing the query through Tooling.

The two Salesforce API surfaces overlap but are not interchangeable. An object can be available through regular REST, Tooling, or both, and an overlapping object can expose different usable fields. A validation result is meaningful only when metadata discovery and execution use the same resolved API surface.

## Decision

Omitted `api` now means automatic resolution. SF SOQL checks current-org REST and Tooling object catalogs, loads mode-specific describe metadata, validates the complete parsed query against every available candidate, and selects the sole valid surface. When both surfaces validate, regular REST is the deterministic default. Explicit `api="rest"` and `api="tooling"` selections remain strict and never silently switch.

Every `query.sample`, `query.run`, `query.count`, `query.queryAll`, and `query.explain` action performs the same API-aware schema preflight internally. Predictable object, field, relationship, field-capability, and API-mode failures return a preflight block without invoking the query endpoint. `queryAll` remains regular-REST-only, and query plans are not requested for Tooling queries.

Mode-specific object catalogs and describes are cached only for the current Pi session. Cache keys include the target org identity, selected Salesforce API version, API mode, and object name. Query result artifacts and explicit export behavior remain unchanged.

Structured Salesforce request errors are consumed through their typed status and error-code properties so the LLM-facing result retains actionable failure evidence when a runtime error still occurs.

## Consequences

- Callers no longer need a separate `schema.describe` or `query.validate` call for execution safety.
- Schema actions remain useful when metadata is itself part of the requested answer.
- Automatic resolution adds bounded catalog/describe calls on the first query for an object; session caching removes repeat discovery work.
- Explicit API selections fail closed when the selected surface cannot describe or validate the query.
- Schema preflight prevents predictable query-construction failures but cannot eliminate transient authentication, permission, timeout, or platform failures.
- Live regression coverage must include a regular object, a Tooling-only object, an overlapping object, and a mode mismatch that proves the query endpoint was not called.
