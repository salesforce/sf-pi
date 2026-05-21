---
title: "SF Guardrail"
description: "Salesforce-aware safety layer for pi: file-protection policies, AST-matched command gating, org-aware confirmation on production deploys/Apex/DML/destructive REST, plus a once-per-session prompt-injection that teaches the LLM the gating categories and validate-first workflow."
---

# SF Guardrail

Salesforce-aware safety layer for pi: file-protection policies, AST-matched command gating, org-aware confirmation on production deploys/Apex/DML/destructive REST, plus a once-per-session prompt-injection that teaches the LLM the gating categories and validate-first workflow.

## What it is

Salesforce-aware safety hooks — file protection policies, dangerous-command gating, and org-aware confirmation for production deploys, apex runs, and data mutations

## At a glance

| Property         | Value                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-guardrail`                                                                                                         |
| Category         | Safety                                                                                                                 |
| Maturity         | stable                                                                                                                 |
| Default state    | on                                                                                                                     |
| Runtime surfaces | commands, events                                                                                                       |
| Source           | [`extensions/sf-guardrail/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-guardrail)                    |
| Full README      | [`extensions/sf-guardrail/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-guardrail`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-guardrail
/sf-pi disable sf-guardrail
/sf-pi status sf-guardrail
```

## Runtime surfaces

- **Commands:** `/sf-guardrail`
- **Events/hooks:** `session_start`, `session_tree`, `before_agent_start`, `tool_call`

## Safety and privacy

- Fail-closed in headless mode unless SF_GUARDRAIL_ALLOW_HEADLESS=1.
- Every block / allow / confirm decision is persisted as an audit entry.
- alwaysActive=false but disabling removes the safety layer entirely; the manager surfaces this clearly.

## Configuration and state

Environment inputs:

- `SF_GUARDRAIL_ALLOW_HEADLESS`

State files:

- `session entries: SF_GUARDRAIL_DEFAULTS allow/deny memory and audit decisions`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/index.ts)
- [`lib/classify.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/lib/classify.ts)
- [`lib/policies.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/lib/policies.ts)
- [`lib/command-gate.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/lib/command-gate.ts)
- [`lib/org-aware-gate.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/lib/org-aware-gate.ts)
- [`lib/hitl.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/lib/hitl.ts)
- [`lib/audit.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/lib/audit.ts)
- [`lib/config.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/lib/config.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-guardrail)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md#troubleshooting) for extension-specific recovery steps.
