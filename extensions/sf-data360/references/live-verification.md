# SF Data 360 Live Verification

This public-safe summary records the latest manual live verification pass for the
Data 360 upstream-parity refresh. Raw responses, org aliases, record IDs, and
instance URLs were kept in private local artifacts and are not committed.

## 2026-07-12 upstream-parity refresh

| Area             | Action                                    | Result           | Notes                                                                                                                                                       |
| ---------------- | ----------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness        | `readiness.probe`                         | Verified         | Data 360 core, metadata, query, and delivery surfaces were reachable in a sandbox verification org. One optional observability surface was not provisioned. |
| Connection       | `connector.list`                          | Verified         | Read endpoint returned HTTP 200.                                                                                                                            |
| Machine Learning | `ml.model_artifact.list`                  | Verified         | Read endpoint returned HTTP 200.                                                                                                                            |
| Machine Learning | `ml.predict`                              | Endpoint reached | Safe-post helper reached the service and returned a validation error for the intentionally placeholder model/payload.                                       |
| Prepare          | `transform.prepare`                       | Endpoint reached | Safe-post helper reached the service and returned a validation error for the intentionally placeholder transform body.                                      |
| Connect          | `connection.db_schemas.list`              | Dry-run verified | Resolved request path, params, and safety without executing because no disposable connection fixture was selected.                                          |
| Prepare          | `transform.prepare`                       | Dry-run verified | Resolved request path, body, and `safe_post` classification.                                                                                                |
| Machine Learning | `ml.prediction_job_def.create_regression` | Dry-run verified | Resolved confirmed mutation request without execution.                                                                                                      |
| Personalization  | `personalization.org_info.get`            | Permission-gated | Endpoint returned HTTP 403 in the sandbox verification org; keep actions available but document that org permissions/features can gate this family.         |

## Verification rules

- Read and `safe_post` actions can be exercised directly against a sandbox
  verification org when payloads are non-sensitive and bounded.
- Confirmed actions should be dry-run first and executed only with disposable
  `SfPiParity_*` resources.
- Destructive actions should not run during broad parity verification except for
  cleanup of resources created by the same verification run.
- Committed summaries must stay public-safe; raw evidence remains local/private.
