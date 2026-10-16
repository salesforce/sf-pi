---
id: "0148"
status: accepted
date: 2026-10-16
---

# ADR 0148: Guardrail owns Integration and Flow org-sensitive safety

## Decision

SF Guardrail is the single owner of production and unknown-org safety decisions
for Integration mutations and Flow lifecycle mutations. Family tools retain
execution-intent, target, plan/version, capability, rehearsal, and resulting-state
checks, but do not independently veto an operation based on org type.

The existing org-operation rule collection accepts exact native tool/action
matches alongside shell AST matches. Two bundled rules preserve the previous
production/unknown default: `native-sf-integrate-prod` and `native-sf-flow-prod`
ship with Block behavior. Their behavior is edited through existing Guardrail
preferences; no family-specific production override is introduced.

Ask me uses the existing approval path. Off removes the additional org-sensitive
restriction, not the native mutation confirmation. Integration and Flow are
selectable Power Tool Mode families. Production/unknown auto-approval requires
its existing separate opt-in, and hard blocks always take precedence.

Read-only Integration preflight reports capability readiness, not mutation
permission. Its result replaces `mutation_allowed` with
`mutation_policy: "sf-guardrail"`; `ready` now means required capabilities are
available. Clients must not interpret preflight readiness as authorization.

## Consequences

A trial Dev Hub can retain production-risk classification while its operations
follow the operator's Guardrail settings. Org classification remains unchanged.
No new authorization service, approval token, or family-tool policy layer exists.

Disabling Guardrail removes this mediation, consistent with other native tools.
Direct library calls outside Pi do not receive tool-call mediation. Disposable
E2E cleanup helpers retain non-production-only restrictions because they run
outside that boundary; they are not supported user mutation actions.

This supersedes the tool-local non-production restriction in ADR 0131 for the
supported Integration actions, not its exact-plan and validation requirements.
