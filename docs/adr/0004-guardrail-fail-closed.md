# ADR 0004: Guardrail Fails Closed

## Status

Accepted

## Context

The guardrail extension mediates destructive files, dangerous shell commands,
and production-sensitive Salesforce operations. Ambiguity can come from shell
parsing, target-org resolution, missing config, or headless sessions.

## Decision

Default ambiguous guardrail decisions to the safer outcome. Unknown production
status, tokenizer failure, unreadable overrides, and confirmation timeouts must
not silently allow risky operations.

## Consequences

- False positives are preferable to false negatives for dangerous operations.
- Every gated path must leave an audit trail.
- Escape hatches are explicit and visible, not hidden in project-local config.
