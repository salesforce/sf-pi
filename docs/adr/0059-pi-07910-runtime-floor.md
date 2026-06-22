# ADR 0059: Pi 0.79.10 runtime floor

Status: accepted

SF Pi will raise its minimum Pi Runtime to `0.79.10` as a small **Runtime Floor Adoption Slice**. The slice adopts the release as a baseline for simpler support and lifecycle behavior, while keeping the actual product changes narrow: compaction `reason` / `willRetry` metadata is recorded in the **Pi Runtime Adoption Ledger** but not surfaced at runtime yet; user-facing Pi Runtime update guidance follows the **Pi Runtime Update Happy Path**; reload-related workaround deletion must be test-first; and plan-mode-inspired progress belongs to **Workflow-Local Plan Tracking** rather than a package-wide Salesforce plan mode.
