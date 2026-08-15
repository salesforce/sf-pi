# SF Guardrail

## What It Does

SF Guardrail mediates protected files, dangerous shell commands, org-aware
Salesforce operations, and known high-value native-tool mutations before
execution. Every rule has one behavior: `off`, `confirm`, or `block`.

Rule families share the same Safety Kernel, human confirmation, headless
fail-closed behavior, session approval memory, and audit path:

- **Policies** protect files as no-access, read-only, or explicit no-op.
- **Command gate** structurally matches dangerous commands, including commands
  later in simple shell chains and `herdr_pane.run` calls.
- **Org-aware gate** applies production-level policy after resolving the target
  org type; unresolved targets fail closed.
- **Native-tool gate** classifies known durable mutations from Agent Script,
  Data 360, Apex, Slack, SOQL, and SF Browser surfaces.

Intent flags such as `allow_mutation`, `allow_confirmed`, or `mutation=true` aid
classification but never become approval.

## Commands

- `/sf-guardrail` — open the Manager detail, or print status without UI.
- `/sf-guardrail list` — print active rules.
- `/sf-guardrail audit` — show up to 50 recent session decisions.
- `/sf-guardrail grants` — list legacy persisted grants if present.
- `/sf-guardrail settings` — open routine preferences.
- `/sf-guardrail aliases` — edit aliases that receive production-level policy.
- `/sf-guardrail forget` — clear current-branch session allowances and legacy
  project grants.

## Configuration

Bundled rules live in `SF_GUARDRAIL_DEFAULTS.json`. Routine global preferences
live under `sfPi.guardrail` in Pi settings and cover confirmation timeout,
protected aliases, Power Tool choices, and bundled-rule behavior.

Advanced custom patterns or full stable-id overrides live in
`<globalAgentDir>/sf-guardrail/rules.json`. Effective configuration resolves
bundled defaults, advanced overrides, then routine Pi settings. Project-local
weakening is not supported.

Process-level automation controls are explicit:

- `SF_GUARDRAIL_ALLOW_HEADLESS=1` allows otherwise confirmable headless calls
  with an audit warning.
- `SF_GUARDRAIL_OPERATOR_AUTO_APPROVE=allow-confirm-actions-for-this-process`
  auto-allows confirm-class decisions for that process.

Neither path bypasses hard blocks.

## Safety and Data Boundaries

- Interactive confirms offer Allow once, Allow for this session, or Block.
  Session approval is scoped to a Safety Envelope and survives resume/fork only
  through the current session branch.
- Every automatic allow, human allow, session allow, block, timeout, cancel, and
  headless pass becomes an audit entry.
- Power Tool Mode is off by default, can be limited to selected native families,
  and requires a separate production/unknown-org opt-in.
- Strictly validated temporary-directory cleanup can be auto-allowed; other
  dangerous commands are confirmed or hard-blocked according to rule behavior.
- Disabling the extension removes this mediation layer; the Manager calls that
  out before changing package state.

## References

Canonical terminology lives in [`CONTEXT.md`](../../CONTEXT.md). Durable design
trade-offs live in the generated [ADR lifecycle index](../../docs/adr/README.md),
including fail-closed behavior, Safety Envelopes, rule-derived guidance,
session approvals, org classification, rule behavior, and native mutation
mediation.

## Troubleshooting

**Production confirms fire for a sandbox:** Inspect `/sf-guardrail audit` to see
whether org type came from cache, lookup, a protected alias, or a fail-closed
guess. Refresh authentication/environment state before changing alias policy.

**A protected file remains blocked after removing an override:** Bundled rules
merge by stable id. Add an explicit disabled/no-op override instead of merely
omitting the bundled rule.

**Headless CI is blocked:** Prefer a non-production CI target and rehearsals.
When unattended confirmation is intentional, set the documented headless
operator control and retain the audit output; hard blocks remain active.

**Audit is empty after resume:** Decisions belong to the active session file.
Confirm that the resumed branch is the one that recorded the decision.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-guardrail/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
  SF_GUARDRAIL_DEFAULTS.json  ← bundled Guardrail rule defaults
```

<!-- GENERATED:file-structure:end -->
