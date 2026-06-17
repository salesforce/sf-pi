# Agent Script diagnostic parity

This file records the current boundary between upstream AgentScript diagnostics
and SF Pi's local **Agent Script Hardening Adapter** diagnostics. Keep it in
sync with `extensions/sf-agentscript/tests/diagnostic-parity.test.ts`.

## Parity tiers

- **Strict parity**: upstream points to the same source construct, gives the
  same actionable meaning or risk, and supplies equivalent quick-fix data when
  SF Pi currently offers a fix. Strict parity is required before deleting an SF
  Pi local diagnostic.
- **Moderate parity**: upstream catches the fixture with a related diagnostic,
  but the message, action, risk, or quick-fix data is not equivalent. Moderate
  parity is evidence for a future review, not deletion by itself.
- **SF Pi-owned**: upstream emits no equivalent diagnostic for the fixture. The
  diagnostic remains local hardening.

## Current parity map

| SF Pi diagnostic                         | Upstream diagnostic(s) on parity fixture             | Tier             | Current decision                                                                                   |
| ---------------------------------------- | ---------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `unused-variable`                        | `unused-variable` + `removalRange`                   | Strict           | Upstream-owned. Local scanner removed.                                                             |
| `action-missing-outputs`                 | none                                                 | SF Pi-owned      | Keep local. Publish/server contract hardening.                                                     |
| `apex-target-method-suffix`              | none                                                 | SF Pi-owned      | Keep local. Salesforce target hygiene.                                                             |
| `target-ref-looks-like-id`               | none                                                 | SF Pi-owned      | Keep local. Stable metadata-name guidance.                                                         |
| `complex-action-io`                      | `object-type-missing-schema`, `action-missing-input` | Strict by policy | Upstream-owned. Local diagnostic removed; publish-binding nuance remains documented here.          |
| `numeric-action-io`                      | `action-missing-input`                               | SF Pi-owned      | Keep local. Numeric Flow/Apex publish-binding guidance is Salesforce-specific.                     |
| `connection-messaging-incomplete-route`  | none                                                 | SF Pi-owned      | Keep local. Channel routing config hardening.                                                      |
| `connection-messaging-route-name-prefix` | none                                                 | SF Pi-owned      | Keep local. Channel routing target format hardening.                                               |
| `inputs-out-of-scope`                    | `action-missing-input`                               | SF Pi-owned      | Keep local. Upstream misses the `@inputs` scope mistake.                                           |
| `outputs-out-of-scope`                   | `action-missing-input`, `action-unknown-input`       | Moderate         | Review later. Upstream catches a related malformed binding, not the general `@outputs` scope rule. |
| `literal-mode-procedural-text`           | `unused-variable` on fixture setup                   | SF Pi-owned      | Keep local. Upstream does not detect executable-looking text in literal mode.                      |
| `run-in-after-reasoning`                 | none                                                 | SF Pi-owned      | Keep local. Runtime behavior hardening.                                                            |
| `prompt-template-output-flags`           | none                                                 | SF Pi-owned      | Keep local. Planner/display behavior hardening.                                                    |
| `employee-agent-default-user`            | `config-ignored-default-agent-user`                  | Moderate         | Review later. Upstream warns, but SF Pi treats this as blocking and provides a removal quick fix.  |
| `employee-agent-connection-messaging`    | none                                                 | SF Pi-owned      | Keep local. Employee-vs-Service Agent surface hardening.                                           |
| `employee-agent-escalate`                | none                                                 | SF Pi-owned      | Keep local. Employee-vs-Service Agent utility hardening.                                           |

## Deletion rule

Do not delete a local hardening diagnostic just because the parity fixture has
an upstream error or warning. Delete only after the parity test proves strict
parity and the replacement keeps or improves the user action.
