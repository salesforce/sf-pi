# SF Data 360 Readiness

Data Cloud is not exposed as one universal API switch. One surface can be
reachable while another is gated, empty, or not provisioned for the current
user. Use `d360_probe` before multi-step work when readiness is uncertain.

## Readiness states

- `ready` — core surfaces are reachable and at least one sampled surface has data.
- `ready_empty` — core surfaces are reachable but sampled lists are empty.
- `partial` — at least one Data 360 surface works, but another surface is gated or unavailable.
- `blocked` — no sampled Data 360 surface is reachable.

## Probe interpretation

- Empty lists usually mean the feature is reachable but not configured yet.
- Feature-gated errors are phase-specific evidence, not proof that all of Data Cloud is off.
- Query/search-index failures do not necessarily mean DMO, DLO, calculated insight, or data-space APIs are unavailable.
- A missing table or index should be treated as a bad probe target until the catalog has been inspected.

## Probe count semantics

`d360_probe` is a readiness classifier, not a complete inventory tool.

Some probes intentionally use `limit=1`. For endpoints that do not return an explicit `totalSize`, `total`, or `count`, the reported count may be only the number of returned items.

Use probe counts to determine whether a surface is reachable, populated, empty, gated, or blocked. Do not report them as authoritative object totals unless the result has `countKind: "total"` or `countKind: "nested_total"`.

## Good first probes

`d360_probe` samples a curated set of read-only surfaces including:

- data spaces
- DMO catalog
- DLO catalog
- data streams
- calculated insights
- connectors and Salesforce connections
- segments, identity resolution, and activations
- transforms and data actions
- semantic models
- profile metadata and metadata entities

Continue with the phase that is reachable. If a phase is gated, report the
feature code and guide the user to Data Cloud setup, permissions, or feature
entitlement review.

## Live-testing lessons

- Mapping list endpoints may require a DMO developer name or source object filter; an unfiltered mapping list can fail even when mapping APIs are available.
- Search-index and retriever endpoints can return not found in otherwise healthy Data Cloud orgs; do not use them as core readiness gates.
- Query SQL should use a table known to be queryable from DLO/stream discovery. Standard DMO catalog entries may not always resolve in the query plane.
