---
title: Prompt-injection controls
description: Control mapping for prompt-injection risk in SF Pi.
---

# Prompt-injection controls

SF Pi treats prompt injection as an **action-integrity** risk: untrusted text may
try to steer an agent into using privileged tools in a way the user did not
intend. SF Pi does not claim to detect every malicious instruction embedded in
records, files, Slack messages, web pages, screenshots, or documentation.

Instead, SF Pi combines prevention, mediation, and audit controls that reduce the
impact of prompt injection against known high-value surfaces.

## Control objective

The relevant control objective is:

> Untrusted or tool-observed content must not be enough by itself to cause a
> high-value durable mutation, broad data disclosure, or external content write
> under the user's authority.

SF Pi enforces this objective through the [security model](./security-model.md):
known-surface mediation, Safety Envelopes, Human-in-the-Loop approval,
headless fail-closed behavior, explicit operator modes, and audit records.

## Control mapping

| Risk                                                                                               | SF Pi control                                                                                                                                                                                | Evidence                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Prompt-injected text asks the agent to mutate Salesforce, Data 360, Slack, or browser state        | SF Guardrail mediates known high-value native tool operations before execution. Execution intent flags are not approval.                                                                     | `extensions/sf-guardrail/lib/native-tool-risk-registry.ts`, `docs/adr/0074-sf-guardrail-mediates-native-high-value-mutations.md` |
| Prompt-injected text attempts to bypass HITL by setting model-controllable flags                   | `allow_mutation`, `allow_confirmed`, `mutation`, and `dry_run=false` are treated as execution intent only. Guardrail approval remains separate.                                              | `docs/security-model.md`, `extensions/sf-guardrail/CONTEXT.md`                                                                   |
| Prompt-injected text tries to run privileged operations unattended                                 | Confirm-class decisions fail closed in headless mode unless an operator explicitly opts in.                                                                                                  | `SF_GUARDRAIL_ALLOW_HEADLESS`, `extensions/sf-guardrail/lib/hitl.ts`                                                             |
| Advanced users intentionally disable prompts for a workflow                                        | Persisted Power Tool Mode and process-scoped operator auto-approve are explicit, visible, audited, and cannot bypass hard blocks. Production/Unknown org auto-approval is a separate opt-in. | `docs/adr/0075-sf-guardrail-adds-persisted-power-tool-mode.md`, `extensions/sf-guardrail/lib/power-tool-mode.ts`                 |
| Prompt-injected browser content asks the agent to click Save/Delete/Activate with a neutral reason | SF Browser snapshots publish ref metadata. Guardrail can classify committing click refs from latest snapshot labels, not only model-supplied `mutation` or `reason`.                         | `lib/common/sf-browser-snapshot-state.ts`, `extensions/sf-browser/lib/sf_browser_snapshot-tool.ts`                               |
| Prompt-injected Data 360 workflow hides child mutations inside one journey                         | Guardrail approval details list declared child mutation families. Data 360 records the actual executed child chain as a session audit entry.                                                 | `extensions/sf-data360/lib/v2/dispatcher.ts`, `extensions/sf-data360/lib/v2/tools.ts`                                            |
| Prompt-injected SOQL asks for broad/deleted-record reads or export                                 | Guardrail mediates `query.export`, `query.queryAll`, `ALL ROWS`, and `allow_unbounded=true`. Exports are confined to `.sf-pi/exports/soql/`.                                                 | `extensions/sf-guardrail/lib/native-tool-risk-registry.ts`, `extensions/sf-soql/lib/export.ts`                                   |
| Prompt-injected text attempts local file disclosure through common risky paths                     | SF Guardrail file-protection rules cover dotenv-style secret files and Salesforce CLI state directories.                                                                                     | `extensions/sf-guardrail/SF_GUARDRAIL_DEFAULTS.json`                                                                             |
| Prompt-injected content attempts dangerous shell operations                                        | SF Guardrail command and org-aware gates mediate dangerous shell commands and production-sensitive Salesforce CLI operations.                                                                | `extensions/sf-guardrail/lib/command-risk-gate.ts`, `extensions/sf-guardrail/lib/org-aware-risk-gate.ts`                         |
| Prompt-injected content is copied into public issues/docs                                          | Public sanitization rules and `sf-feedback` diagnostics sanitize public output.                                                                                                              | `docs/public-sanitization.md`, `extensions/sf-feedback/README.md`                                                                |

## What is intentionally not claimed

SF Pi does not claim to provide a universal prompt-injection scanner or a full
sandbox for all local workstation activity. In particular, SF Pi cannot guarantee
that every possible mutation path outside bundled SF Pi surfaces is mediated.

Examples outside the current control boundary include:

- manual terminal commands typed by the user
- third-party extensions or tools not registered by SF Pi
- arbitrary shell scripts the user later runs manually
- future SF Pi tools before they are reviewed and added to the relevant safety
  model

These are residual risks of a pro-code agent environment and should be managed
through user review, least-privilege credentials, project trust decisions, and
future extension-specific controls.

## Developer requirements for new surfaces

When adding a new LLM-callable tool or workflow, reviewers should ask:

1. Can untrusted content influence the model into calling this surface?
2. Can the surface persistently change external state, move local data, write to
   collaboration systems, or disclose broad/sensitive records?
3. If yes, is it represented as a Guardrail Safety Subject before execution?
4. Does the approval copy show the specific Safety Envelope the user accepts?
5. Does headless mode fail closed unless explicitly operator-approved?
6. Is the action recorded in an audit trail or result artifact?

If the answer is unclear, document the design in an ADR or security note before
shipping the surface.

## Relationship to SFSS-SSD-004 section 5.4

For SFSS-SSD-004 section 5.4, SF Pi's current control mapping is primarily
**impact mediation** rather than universal prompt-injection detection. Untrusted
input may still reach the model, but high-value consequences are constrained by
pre-execution Guardrail mediation, HITL/default fail-closed behavior, explicit
operator overrides, and auditability.

If a future review requires positive prompt-injection detection in addition to
impact mediation, that should be designed as a separate control so it can be
validated without weakening the existing Guardrail boundaries.
