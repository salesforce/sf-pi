# Agent Script diagnostic parity

This file records the released-package boundary between official Agent Script
diagnostics and SF Pi's local **Agent Script Hardening Adapter** and native
quality catalog. Keep it synchronized with:

- `tests/diagnostic-parity.test.ts` for hardening diagnostics;
- `tests/quality-upstream-parity.test.ts` for all 20 quality rules.

## Evidence baseline

Fixture evidence was refreshed on 2026-08-25 against these exact installed
packages:

| Package                               |   Version |
| ------------------------------------- | --------: |
| `@sf-agentscript/agentforce`          | `2.10.38` |
| `@sf-agentscript/language`            |   `3.2.3` |
| `@sf-agentscript/lsp`                 |  `2.6.33` |
| `@sf-agentscript/agentscript-dialect` |   `3.4.0` |
| `@sf-agentscript/agentforce-dialect`  |  `2.53.0` |
| `@sf-agentscript/compiler`            |   `3.8.1` |

The snapshot tests compare execution context, diagnostic code, source, severity,
complete range, message, data, multiplicity, suggestions, and quick fixes.
Similar names or shared helper functions are not parity.

## Parity tiers

- **Strict parity**: the official diagnostic covers the same construct in the
  same execution context, with equivalent code mapping, range, severity/risk,
  message/actionability, data, and quick-fix behavior.
- **Adjacent only**: the fixture produces an official diagnostic, but for a
  different construct, execution context, risk, or repair. It cannot authorize
  deletion.
- **SF Pi-owned**: the fixture produces no equivalent official diagnostic.

Only strict parity permits deleting a local evaluator. A released package
upgrade requires rerunning the fixtures before changing a decision.

## Current hardening diagnostics

| SF Pi diagnostic                      | Official fixture evidence                                                                          | Tier          | Decision                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| `apex-target-method-suffix`           | none                                                                                               | SF Pi-owned   | Retain Salesforce target hygiene.                    |
| `target-ref-looks-like-id`            | none                                                                                               | SF Pi-owned   | Retain stable API-name guidance.                     |
| `employee-agent-connection-messaging` | none                                                                                               | SF Pi-owned   | Retain Employee-versus-Service Agent surface policy. |
| `employee-agent-escalate`             | none                                                                                               | SF Pi-owned   | Retain Employee-versus-Service Agent utility policy. |
| `inputs-out-of-scope`                 | `action-missing-input` plus an uncoded cascade on the fixture; neither identifies the scope misuse | Adjacent only | Retain exact `@inputs` scope diagnostic.             |
| `outputs-out-of-scope`                | none                                                                                               | SF Pi-owned   | Retain exact `@outputs` callback-scope diagnostic.   |

## Current quality catalog

| SF Pi quality rule                          | Official fixture evidence                                | Tier          | Decision                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `unconditional-transition-cycle`            | none                                                     | SF Pi-owned   | Retain local graph analysis.                                                                                           |
| `slot-filling-in-deterministic-action`      | none for deterministic `run`                             | SF Pi-owned   | Retain local High policy. Planner-action LLM filling is a different context.                                           |
| `deterministic-action-missing-input`        | none for deterministic `run`                             | SF Pi-owned   | Retain local High policy. Official planner-action omission is informational and allows LLM filling.                    |
| `deterministic-action-unknown-input`        | none for deterministic `run`                             | SF Pi-owned   | Retain. Official `action-unknown-input` applies to planner-selected action bindings, not this execution context.       |
| `action-chain-too-deep`                     | none                                                     | SF Pi-owned   | Retain local chain-depth contract.                                                                                     |
| `variable-description-max-length`           | none                                                     | SF Pi-owned   | Retain the local High guard for the Salesforce publication limit.                                                      |
| `unreachable-subagent`                      | none                                                     | SF Pi-owned   | Retain component-graph reachability. Official `unreachable-code` is statement-level and not parity.                    |
| `unused-action`                             | none                                                     | SF Pi-owned   | Retain scoped action-use analysis. Official `unused-variable` is a different declaration kind.                         |
| `discarded-prompt-before-transition`        | none                                                     | SF Pi-owned   | Retain prompt-before-transition analysis. Official `unreachable-code` examines statements after a terminal transition. |
| `list-element-type-mismatch`                | none on the representative mixed-list default fixture    | SF Pi-owned   | Retain element-level type and range evidence. Official `variable-default-type-mismatch` no longer fires here.          |
| `non-numeric-list-index`                    | none                                                     | SF Pi-owned   | Retain statically known list-index analysis.                                                                           |
| `slot-filled-variable-missing-description`  | `unused-variable` on the declaration, with a removal fix | Adjacent only | Retain slot-filling description guidance; removing the variable is not an equivalent repair.                           |
| `deterministic-action-input-type-mismatch`  | none for deterministic `run`                             | SF Pi-owned   | Retain. Official type checks use similar inference only for planner action bindings.                                   |
| `deterministic-action-output-type-mismatch` | none for deterministic `run`                             | SF Pi-owned   | Retain. Official type checks do not cover this deterministic callback fixture.                                         |
| `instruction-template-syntax`               | exact official `instruction-template-syntax` diagnostic  | Strict parity | Reuse the official diagnostic as a Moderate quality projection; maintain no local evaluator.                           |
| `prompt-template-output-flags`              | none                                                     | SF Pi-owned   | Retain planner/display guidance.                                                                                       |
| `action-before-transition`                  | none                                                     | SF Pi-owned   | Retain cost/side-effect advisory before a transition.                                                                  |
| `conditional-transition-cycle`              | none                                                     | SF Pi-owned   | Retain conditional graph evidence.                                                                                     |
| `subagent-delegation-cycle`                 | none                                                     | SF Pi-owned   | Retain returning-delegation graph evidence.                                                                            |
| `cyclomatic-complexity`                     | none                                                     | SF Pi-owned   | Retain report-only per-procedure metric.                                                                               |

**Milestone 4 result:** zero local evaluators meet strict parity at this package
baseline, so zero local evaluators are deleted. Instruction-template syntax is a
projection of its strict-parity official diagnostic and has no local evaluator.
This is the required fail-closed outcome, not an incomplete migration.

Disabling a local quality rule still disables only its policy projection. The
quality parity suite proves that an adjacent official compiler diagnostic, when
present, remains visible.

## Completed historical handoffs

Earlier work already removed duplicated evaluators where released official
behavior became authoritative, including official unused-variable handling,
object action I/O diagnostics, instruction-template syntax, and ignored Employee
Agent default user configuration. Instruction-template syntax is now projected
into quality from the official diagnostic rather than reimplemented. Those
completed handoffs are not evidence for deleting any current local evaluator;
their fixtures remain in `diagnostic-parity.test.ts` as regression coverage.

## Deletion rule

Do not delete a local diagnostic or quality evaluator because an official pass
has a similar name or imports the same type-inference helper. Delete only after
a current released-package fixture proves strict parity and public quality,
review, edit-time, and publication behavior remains intact.
