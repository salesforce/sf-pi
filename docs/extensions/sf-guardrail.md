---
title: "SF Guardrail"
description: "Salesforce-aware safety hooks — file protection policies, dangerous-command gating, org-aware confirmation, and native high-value mutation mediation"
editLink: false
---

# SF Guardrail

<p class="sfpi-page-lead">Salesforce-aware safety hooks — file protection policies, dangerous-command gating, org-aware confirmation, and native high-value mutation mediation</p>

## What it does

Salesforce-aware safety layer for pi: file-protection policies, AST-matched command gating, org-aware confirmation on production deploys/Apex/DML/destructive REST, native high-value mutation mediation, plus a once-per-session prompt-injection that teaches the LLM the gating categories and validate-first workflow.

## Start

Open the extension from its primary command:

```text
/sf-guardrail
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-guardrail
/sf-pi enable sf-guardrail
/sf-pi disable sf-guardrail
```

## Safety notes

- Fail-closed in headless mode unless SF_GUARDRAIL_ALLOW_HEADLESS=1.
- Every block / allow / confirm decision is persisted as an audit entry.
- Power Tool Mode can persistently auto-approve selected confirm-class decisions; production/unknown org auto-approve is a separate opt-in and hard blocks are never bypassed.
- Operator auto-approve env mode is process-scoped, audited, and does not bypass hard blocks.
- Known high-value native tool mutations are mediated before execution through the same Safety Kernel and HITL path, including first-slice AgentScript lifecycle, Data 360, Apex, Slack Canvas, and SF Browser commit surfaces.
- alwaysActive=false but disabling removes the safety layer entirely; the manager surfaces this clearly.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-guardrail`
- **Intent:** Work safely
- **Category:** Safety
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-guardrail`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_tree`, `before_agent_start`, `tool_call`, `context`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-guardrail)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/AGENTS.md)
- [Domain glossary](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/CONTEXT.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md#troubleshooting) for extension-specific recovery steps.
