---
id: "0115"
status: accepted
date: 2026-09-19
---

# ADR 0115: SF Flow quality uses white-room behavioral parity

## Context

ADR 0114 intentionally limited the first SF Flow release to a small local correctness analyzer while Salesforce Flow lifecycle behavior was established. The open-source Lightning Flow Scanner project publishes a mature MIT-licensed catalog of Salesforce Flow safety, performance, reliability, and maintainability rules. SF Flow needs the benefit of that established public behavior without copying its implementation, adding an upstream runtime dependency, or presenting duplicate findings alongside Salesforce Code Analyzer.

## Decision

SF Flow will use a **white-room behavioral reimplementation** of Lightning Flow Scanner rule concepts. Public rule IDs, documentation, configurable metadata, and black-box package output define parity targets. SF Pi owns a separate Flow fact model, rule catalog, evaluators, messages, severity policy, profiles, source ranges, artifacts, and presentation. Production modules under `extensions/sf-flow/lib/` must not import `@flow-scanner/*`.

`@flow-scanner/lightning-flow-scanner-core` is pinned at an exact version as a dev-only **Rule Behavioral Oracle**. Fresh SF Pi fixtures run through both engines. **Rule Parity** compares applicability, occurrence, affected element, broad source location, and semantic meaning; exact messages, source code, regexes, and upstream example fixtures are not copied. Every inspired catalog record declares its upstream rule ID, parity version, documentation URL, Salesforce documentation where available, and Salesforce Code Analyzer overlaps.

The quality engine is data-first and profile-aware. The `generation` profile contains implemented, low-noise preventive rules compiled into `author.plan` and run after Flow source edits. The `review` profile adds implemented maintainability checks and discloses planned rules as skipped coverage. The `audit` profile is the future home for project and migration policy. SF Flow has no numeric quality score, and a cataloged rule without an evaluator is **Planned Rule Coverage**, never passing evidence.

Lightning Flow Scanner is credited in SF Flow's README, quality catalog documentation, expanded catalog results, and third-party notice. The exact MIT notice is retained. Credits describe inspiration and dev-time parity without implying affiliation, endorsement, or that Lightning Flow Scanner emitted a local SF Flow finding.

## Consequences

- Initial source generation receives preventive constraints for hardcoded values, context safety, record-trigger criteria, loops, database/action behavior, fault/null handling, metadata hygiene, and maintainability before org validation.
- Familiar public kebab-case rule IDs are retained when local behavior intentionally targets the same concept; SF Pi-specific correctness rules keep independent names.
- Salesforce Code Analyzer overlap is explicit and deduplicated in presentation; strict parity can later justify delegation or local evaluator deletion when edit-time latency and preventive guidance remain satisfied.
- All 30 published Lightning Flow Scanner rule concepts have independent SF Pi evaluators, separated into generation, review, and audit profiles; auto-fixes, project configuration compatibility, and inline suppression remain separate evidence-backed increments.
