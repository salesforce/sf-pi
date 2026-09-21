---
id: "0116"
status: accepted
date: 2026-09-19
---

# ADR 0116: SF Flow repairs are bounded and source-bound

## Context

SF Flow's preventive generation profile can identify defects immediately after an agent writes Flow metadata, but unbounded automatic repair risks repeated edits, hidden business-logic changes, and stale diagnostic application. Three findings have deterministic repairs that do not require business intent: an outdated Flow API version, missing Auto-Layout metadata, and an exact unused local variable.

## Decision

SF Flow edit feedback uses a **Bounded Flow Repair Loop** with at most three actionable rounds per file and session. Only High and Moderate generation findings steer the agent. A **Repair Signature** is derived from rule, location, and element identities. The loop stops when no actionable findings remain, when the signature repeats, or when the round limit is reached. The loop provides repair guidance only; normal Pi file tools continue to own all business-logic edits.

`sf_flow fix.apply` is the only SF Flow source-mutating action. It exposes three **Flow Quick Fixes**: set `apiVersion` to the SFDX project source version, set CanvasMode to `AUTO_LAYOUT_CANVAS`, and remove an exact unused non-input/non-output variable. `diagnose.file` returns a deterministic fix ID and SHA-256 source version. `fix.apply` must receive both, participates in Pi's per-file mutation queue, refuses stale or unavailable fixes, persists bounded evidence, and re-diagnoses the resulting source. It does not apply multiple fixes implicitly.

Live lifecycle evidence remains non-mutating. The SF Flow E2E harness may stage a temporary API-compatible copy when a connected non-production org advertises an older API than the repository fixture. Check-only validation saves no metadata, and Flow test execution occurs only after explicit targeting or an explicit E2E flag selecting the first discovered candidate.

## Consequences

- Repeated or non-progressing repair attempts become visible stop outcomes rather than infinite agent loops.
- Low and Info findings remain human-facing unless explicitly diagnosed.
- Safe quick fixes are reviewable individual mutations; security context, filters, fault behavior, recursion, loop bulkification, and all other business decisions remain guidance-only.
- A stale diagnosis can never authorize a quick fix against changed source.
