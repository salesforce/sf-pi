# ADR 0010: Data 360 capability sweeps are facade-first and fixture-owned

## Status

Accepted

## Context

SF Data 360 needs repeatable live validation for broad D360 capability coverage without turning live org state into the only correctness signal. Local tests already protect registry shape, parity, examples, safety, and rendering, but a broad live sweep is still needed to catch path templating, target-org resolution, serialization, optional-feature behavior, and real Data 360 response-shape drift.

## Decision

SF Data 360 will validate broad live coverage through a repeatable repo E2E sweep script before promoting any part of the sweep into a user-facing runbook or new runtime surface. The sweep is facade-first: capability checks execute through the `d360` facade code path so registry lookup, parameter binding, dry-run resolution, safety classification, target-org handling, and result shaping are exercised together. Direct REST calls are allowed only for bounded fixture setup or cleanup when a dependency cannot yet be represented as a D360 capability.

Every D360 capability gets local contract or dry-run request-resolution coverage. Read and safe POST capabilities run live where the target org exposes the needed surface. Mutating capabilities are covered through family lifecycle scenarios using sweep-owned resources with unique run identifiers; the sweep must not update or delete pre-existing org fixtures unless a future decision explicitly whitelists them. Because the normal `d360` facade requires interactive human confirmation for destructive execution, the E2E sweep may use a narrow sweep-only headless destructive gate. That gate must require an exact disposable target org opt-in, an explicit mutation mode, a unique run identifier, `allow_confirmed: true`, and ownership checks for the resources being changed.

The sweep reports structured coverage outcomes. True SF Pi regressions fail the run, while expected org-state conditions such as empty data, feature gating, missing dependencies, optional surfaces, or payloads that require unavailable fixtures are recorded as non-failing outcomes unless the operator explicitly requires that family.

## Consequences

Live testing discovers gaps; TDD keeps them fixed. Every true SF Pi bug found by the live sweep must be captured first as a failing local test, generator/parity check, payload-example fixture, or focused E2E assertion before production code is changed. The initial implementation belongs in `scripts/e2e/` with JSON and Markdown artifacts so it can harden the extension without expanding the default pi tool surface or violating the Data 360 performance budget.
