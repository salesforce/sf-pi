---
title: Security model
description: SF Pi's user-intent boundary, Guardrail mediation, and headless safety posture.
---

# Security model

SF Pi is a pro-code developer tool. It supports local edits, tests, previews,
queries, browser workflows, and external integrations. The security model is not
"block all mutation" and does not claim to sandbox every possible action a
coding agent can take on a developer workstation.

Instead, SF Pi applies **known-surface mediation**: the bundled safety extension
mediates risky action surfaces that SF Pi owns, observes, and can classify in the
Pi Runtime.

## Core boundary

SF Pi treats these as different controls:

- **Authorization**: Salesforce, Slack, Data 360, GitHub, the operating system,
  and other target systems decide what the user's identity is allowed to do.
- **User intent boundary**: SF Guardrail asks the user or a configured operator
  to accept a specific Safety Envelope before an AI-mediated high-value durable
  mutation proceeds.

The user intent boundary complements platform authorization. It does not replace
it.

## High-value durable mutations

A high-value durable mutation is a bundled first-party, LLM-callable operation
that can persistently change a durable system of record under the user's
authority. Examples include:

- mutating Anonymous Apex
- AgentScript publish, activation, deactivation, and live agent-user provisioning
- Data 360 confirmed execution and raw REST mutations
- Salesforce Browser committing gestures such as save, submit, activate, assign,
  delete, or deploy
- Slack Canvas create and edit operations

Ordinary local source edits are not high-value durable mutations. Local edits
become externally durable only when a separate deploy, publish, save, or execute
operation applies them to a system of record.

## SF Guardrail

SF Guardrail is the safety mediator for bundled SF Pi risk surfaces. It currently
mediates:

1. protected file access, such as dotenv-style secret files and Salesforce CLI
   state directories
2. dangerous shell commands, such as destructive filesystem, Git, package,
   credential-reveal, or infrastructure commands
3. Salesforce org-aware shell operations, especially production-sensitive deploy,
   Apex, data, package, Agentforce, and destructive REST commands
4. known high-value native tool mutations through the Native Tool Risk Registry

Guardrail evaluates these surfaces before execution through Pi's `tool_call`
mediator. Confirm-class decisions route through the same approval, session
approval, headless, and audit path.

## Execution intent flags are not approval

Some tool schemas include intent flags such as:

- `allow_mutation`
- `allow_confirmed`
- `mutation`
- `dry_run=false`

These flags tell the tool and Guardrail that the caller intends to cross from a
read, plan, dry-run, or local draft into execution. They do not approve the
operation. Approval comes from one of:

1. Human-in-the-Loop Approval for a specific Safety Envelope
2. an existing Session Approval for the same stable bounded operation
3. Operator-Approved Headless Mode

## Session approvals

Session approvals suppress repeated prompts only for the same Safety Envelope in
the current session path. They are appropriate for stable bounded operations,
such as repeatedly publishing the same agent to the same verified non-production
org during an active task.

Session approval is not appropriate for broad trust. Arbitrary-code, raw-REST,
short-lived browser-reference, external-content, destructive, production, or
unknown-org operations stay exact or allow-once.

## Headless mode

Confirm-class actions fail closed when there is no interactive UI. Operators can
explicitly opt into headless execution by setting:

```bash
SF_GUARDRAIL_ALLOW_HEADLESS=1
```

This opt-in:

- is configured outside the model/tool call
- is recorded in the Guardrail audit trail
- does not weaken hard blocks
- should be used only in automation environments where the operator has reviewed
  the workflow and target context

## What SF Pi does not claim

SF Pi does not claim to:

- prevent every possible mutation on a developer workstation
- sandbox arbitrary shell commands or third-party tools
- replace Salesforce, Slack, Data 360, GitHub, or OS authorization
- guarantee that future tools are automatically covered before they are added to
  the Native Tool Risk Registry

New high-value first-party write surfaces should either be mediated by SF
Guardrail or explicitly documented as out of scope with a separate design review.

## Related references

- [SF Guardrail extension](./extensions/sf-guardrail.md)
- [Security remediation plan](./security-remediation-plan.md)
- [Public sanitization](./public-sanitization.md)
- [Secure development](./secure-development.md)
