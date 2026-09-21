---
id: "0117"
status: accepted
date: 2026-09-19
---

# ADR 0117: SF Flow authoring grounding and live fixtures are bounded

## Context

Local Flow family and quality knowledge cannot prove that a target org contains a requested object field, invocable action, callable subflow, or eligible Flow test. Broad org snapshots are expensive and stale, while silently inventing target-specific metadata undermines first-generation quality. Live lifecycle proof also needs a stable, public-safe Flow test without depending on customer or production automation.

## Decision

`author.plan` remains local unless the caller supplies `target_org`. With an explicit target it performs bounded, read-only **Authoring Grounding** through the shared Salesforce connection: one requested object or event describe projected to intent-relevant fields, matching standard/custom action summaries followed by at most five input/output detail reads, and up to five matching autolaunched subflows resolved through `FlowDefinitionView` and active/latest Tooling Flow metadata. Every result reports calls and coverage gaps; startup, ordinary edits, and target-free planning perform no org reads.

SF Flow ships a dedicated public-safe draft autolaunched **Flow Test Fixture** and associated `FlowTest` under the E2E fixture project. Provisioning targets only an explicit verified non-production org, requires API 66.0 or later, always runs Metadata API check-only first, and deploys only with a separate `--deploy` flag. The fixture creates no data records and requires no activation. Test discovery reads `FlowTest` metadata directly, targeted runs use the public Salesforce test service, and asynchronous evidence requires a queued run followed by bounded `test.result` polling.

The human Result Card is visually gated by rendering the production component at wide and narrow terminal widths. Mermaid topology, compact file metadata, and hanging artifact-path indentation must remain readable without changing model-facing evidence.

## Consequences

- Org-specific fields, actions, and subflow variables can shape the first authoring plan without a full schema dump or persistent org cache.
- Missing permissions and bounded truncation remain explicit uncertainty rather than negative proof.
- Live Flow test evidence is reproducible and isolated from customer automation, but provisioning is a deliberate reversible org mutation.
- A target org below the repository fixture API version is tested with a temporary compatible copy; project source is never rewritten for the harness.
