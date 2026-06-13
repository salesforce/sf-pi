# SF Guardrail Redesign Plan

This plan simplifies SF Guardrail around the decisions captured in ADRs 0033–0041. The goal is to keep the extension powerful while making it smaller, more agent-first, and easier to reason about.

## Goals

1. Keep SF Guardrail a **Safety Mediator**, not a configurable policy engine.
2. Make human approval explicit through **Safety Envelopes**.
3. Concentrate risky-action evaluation in a pure **Safety Kernel**.
4. Concentrate audit, session approvals, and persisted grants in an **Approval Ledger**.
5. Generate agent-visible guidance from the active ruleset.
6. Prefer pi-native settings, session entries, and TUI components over custom infrastructure.
7. Preserve fail-closed behavior and current safety coverage throughout the refactor.

## Non-goals

- No LLM-callable guardrail tools.
- No generic shell sandbox.
- No secret scanner or code reviewer.
- No full policy-authoring platform.
- No project-local rule overrides until after the core simplification.
- No hard enforcement of workflow rehearsals by default.

## Target architecture

```text
tool_call
  -> normalize to Safety Subject
  -> Safety Kernel evaluates Risk Gates
  -> Guardrail Decision with Safety Envelope
  -> Approval Ledger checks existing approvals
  -> Human Approval adapter prompts when needed
  -> Approval Ledger records outcome
```

### Target file map

```text
extensions/sf-guardrail/
  CONTEXT.md
  REDESIGN.md
  README.md
  ROADMAP.md
  index.ts

  lib/
    safety-kernel.ts       # pure decision engine
    safety-subject.ts      # tool_call normalization
    shell-command.ts       # shell tokenization and target-org extraction
    org-context.ts         # cache-first org resolution
    ruleset.ts             # bundled rules, preferences, advanced overrides, summaries
    approval-ledger.ts     # audit + session approvals + persisted grants
    human-approval.ts      # ctx.ui / headless adapter
    command-panel.ts       # /sf-guardrail panel and command routing
    guidance.ts            # rule-derived agent guidance
    config.ts              # thin compatibility/settings loader
    types.ts               # type boundary
```

Existing helper modules can remain temporarily during migration. The target is conceptual depth, not a one-shot file shuffle.

## Phased implementation

### Phase 0 — Documentation baseline

Status: in progress.

Deliverables:

- `extensions/sf-guardrail/CONTEXT.md`
- ADR 0033: Safety Mediator
- ADR 0034: Safety Envelope approvals
- ADR 0035: Safety Kernel
- ADR 0036: Approval Ledger
- ADR 0037: Rule-Derived Guidance
- ADR 0038: Pi-native preferences with advanced overrides
- ADR 0039: No LLM tools
- ADR 0040: Workflow rehearsals advisory
- ADR 0041: Defer project-local rule overrides

Validation:

- `git diff --check`

### Phase 1 — Characterization tests

Goal: lock current behavior before refactoring.

Add or reshape tests around one future-facing decision interface while keeping existing tests green.

Coverage must include:

- protected file hard blocks
- read-only file behavior
- `.sfdx/agents/**` carve-out
- secret-file blocks and example-file allows
- every bundled dangerous command pattern
- safe temp cleanup auto-allow
- Herdr command mediation
- every org-aware production rule
- deploy rehearsal allows
- guessed-org fail-closed behavior
- session approval envelope matching
- persisted grant eligibility and ineligibility
- headless fail-closed behavior

Acceptance:

- Tests describe behavior in terms of Guardrail Decisions and Safety Envelopes, not internal helper names.
- No production behavior changes.

### Phase 2 — Introduce the Safety Kernel

Goal: create one pure decision seam.

Add:

- `lib/safety-kernel.ts`
- `lib/safety-subject.ts`

The kernel should return decisions shaped around:

- decision action: allow, block, confirm
- risk gate
- safety subject
- safety envelope
- advisory recovery guidance
- org context when relevant

Acceptance:

- `index.ts` calls one decision evaluator.
- Existing policy, command, org-aware, and temp-cleanup behavior is preserved.
- Pi UI/session/persistence imports do not enter the kernel.

### Phase 3 — Introduce the Approval Ledger

Goal: make approval memory one deep seam.

Add:

- `lib/approval-ledger.ts`

Consolidate orchestration behind `approval-ledger.ts`. It now owns formerly separate audit, allow-memory, and persisted-grant helpers; `approval-scope.ts` remains the compatibility source for Safety Envelope construction.

The ledger should own:

- restore session approvals
- record outcomes
- check session approvals
- create session approvals
- check persisted grants
- create persisted grants
- clear current project approvals
- read recent decisions

Acceptance:

- Callers do not manually coordinate separate audit, allow-memory, and grant modules.
- `/sf-guardrail audit`, `/sf-guardrail grants`, and `/sf-guardrail forget` still behave the same.
- Headless persisted grants remain fail-closed unless the explicit env escape hatch is set.

### Phase 4 — Human approval copy and envelope-first UX

Goal: make HIL decisions clear to humans and useful to agents.

Update the HIL adapter to show:

- risk gate
- target subject
- resolved org identity when present
- safety envelope
- TTL when persisted grant is offered
- advisory recovery guidance

Use pi-native primitives first:

- `ctx.ui.select`
- `ctx.ui.input` only for future type-to-confirm
- `ctx.ui.setStatus`
- dialog timeout
- `ctx.signal`

Acceptance:

- The user can tell what an approval covers before selecting allow.
- Exact-command approvals remain exact for broad local dangerous commands.
- Production deploy grants remain project + verified org + deploy-family scoped.

### Phase 5 — Rule-derived guidance

Goal: remove prompt/rule drift.

Add:

- `lib/guidance.ts`

Generate the `<sf_guardrail>` message from:

- effective ruleset
- enabled feature flags
- headless behavior
- org-resolution behavior
- advisory recovery guidance

Acceptance:

- Agent guidance updates when active rules/config change.
- Hand-authored guidance is minimal and generic.
- `SF_GUARDRAIL_PROMPT.md` is removed or reduced to a fallback template only if still needed.

### Phase 6 — Pi-native preferences

Goal: make common settings discoverable without JSON editing.

Add or update:

- `/sf-guardrail settings`
- config panel behavior

Use pi-native/shared SF Pi settings patterns for:

- feature toggles
- confirmation timeout
- production aliases
- per-bundled-rule enablement

Keep advanced JSON overrides for:

- custom file policy rules
- custom command patterns
- full bundled-rule replacement by stable id

Acceptance:

- Common preferences are editable from the command/UI surface.
- Advanced overrides are still supported but no longer the main path.
- No project-local overrides yet.

### Phase 7 — README and roadmap cleanup

Goal: make docs user-facing and remove buried architecture rationale.

Update:

- `README.md`
- `ROADMAP.md`

README should focus on:

- what it does
- how to use it
- command reference
- troubleshooting

Architecture rationale should live in ADRs and `CONTEXT.md`.

Acceptance:

- README no longer explains every architectural trade-off inline.
- Roadmap reflects the simplified architecture.
- Generated file-structure block remains generated-only.

## No-code-slop acceptance criteria

A redesign slice is not done unless:

1. Every changed line traces to the simplification goal.
2. Safety behavior is covered by tests before behavior-preserving refactors.
3. The Safety Kernel remains pure.
4. The Approval Ledger is the only caller-facing approval-memory seam.
5. Common UI/settings reuse pi-native/shared SF Pi components.
6. Rule/guidance drift is reduced, not increased.
7. Fail-closed behavior is preserved.
8. Headless behavior remains explicit and auditable.
9. Public docs remain source-agnostic and free of private/internal examples.

## Recommended first implementation slice

Start with Phase 1 and a very small Phase 2 bridge:

1. Add `safety-kernel.ts` as a thin wrapper around current `classifyWithOrgLookup` behavior.
2. Add characterization tests that call the wrapper and assert Guardrail Decisions.
3. Do not move all internals yet.
4. Once tests are stable, gradually pull normalization and envelope construction behind the kernel.

This gives the repo a new architectural seam without a risky big-bang rewrite.
