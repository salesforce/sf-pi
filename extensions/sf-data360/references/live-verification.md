---
evidence: manual-live-verification
as_of: 2026-10-06
owner: sf-data360
revalidate_after: 2027-01-06
revalidation_trigger: Action catalog, transport, safety, or upstream contract changes
---

# SF Data 360 Live Verification

This public-safe summary records a bounded non-production verification of the single `sf_data360` tool. Raw responses, target aliases, resource names, record IDs, instance URLs, and local artifact paths are intentionally not committed.

## Single-tool action sweep

| Area               | Result                           | Evidence                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime surface    | Verified                         | Exactly one Pi tool, `sf_data360`, is registered and attested against the manifest.                                                                                                                                                        |
| Action catalog     | Verified                         | 308 business-namespaced actions were generated with no duplicate public names.                                                                                                                                                             |
| Upstream parity    | Verified                         | 246 of 246 upstream operation identifiers map to one primary action or canonical operation alias.                                                                                                                                          |
| Public-seam sweep  | Verified                         | 1,312 checks completed with zero failed checks.                                                                                                                                                                                            |
| Contracts          | Verified                         | 308 describe and 308 metadata checks passed.                                                                                                                                                                                               |
| Dry runs           | Verified                         | Endpoint actions resolved without business mutation; fixture- or interaction-dependent actions were explicitly skipped.                                                                                                                    |
| Missing parameters | Verified                         | Required-parameter probes returned actionable failures.                                                                                                                                                                                    |
| Live reads         | Verified with expected variation | Reachable, empty, feature-gated, optional-not-found, dependency-missing, and known platform-error outcomes were classified separately.                                                                                                     |
| Query V3           | Partial                          | The direct tenant-token exchange was unavailable to the existing CLI-authenticated session, so the default SQL action used its explicit Connect fallback and returned transport evidence. Strict `transport=query_v3` remains fail-closed. |
| Run Card UX        | Verified                         | Live DMO and SQL cards rendered namespace-specific icons, complete URLs, readable SQL, bounded tables, request/response sections, fallback evidence, artifacts, and next steps without raw JSON as the primary UI.                         |

## Verification rules

- Read and recognized safe POST actions can run against an explicit non-production target with bounded public-safe inputs.
- Mutations are dry-run first and require `allow_mutation: true` plus Guardrail approval.
- Destructive cleanup is limited to an exact sweep-owned fixture and verified non-production target.
- Optional feature gates and empty collections are evidence, not universal support failures.
- Known backend defects are classified as platform errors instead of being hidden or misreported as successful data.
- Committed summaries remain public-safe; raw evidence remains private and local.
