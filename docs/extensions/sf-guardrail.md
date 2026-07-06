---
title: "SF Guardrail"
description: "Add Salesforce-aware safety checks around risky files, shell commands, org mutations, and production work."
---

# SF Guardrail

<p class="sfpi-page-lead">Add Salesforce-aware safety checks around risky files, shell commands, org mutations, and production work.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Safer Salesforce operations</strong><p>Add Salesforce-aware safety checks around risky files, shell commands, org mutations, and production work.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Blocks sensitive local file edits that should never happen from an agent.</div>
<div class="sfpi-benefit-card">Prompts before dangerous shell and production org operations.</div>
<div class="sfpi-benefit-card">Teaches the agent the active safety categories each session.</div>
</div>

## Try it first

Review guardrail status

```text
/sf-guardrail
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-guardrail
/sf-pi enable sf-guardrail
/sf-pi disable sf-guardrail
```

## Common use cases

- Prevent accidental edits to Salesforce CLI state or secret-like files.
- Require confirmation before production deploys or data mutations.
- Audit which guardrails are active in a pi session.

## What you get

- File-protection policies.
- Dangerous-command confirmation.
- Production-aware Salesforce operation confirmation.

## Safety notes

- Fail-closed in headless mode unless SF_GUARDRAIL_ALLOW_HEADLESS=1.
- Every block / allow / confirm decision is persisted as an audit entry.
- Operator auto-approve mode is process-scoped, env-only, audited, and does not bypass hard blocks.
- Known high-value native tool mutations are mediated before execution through the same Safety Kernel and HITL path, including first-slice AgentScript lifecycle, Data 360, Apex, Slack Canvas, and SF Browser commit surfaces.
- alwaysActive=false but disabling removes the safety layer entirely; the manager surfaces this clearly.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-guardrail`
- **Category:** Safety
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-guardrail`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_tree`, `before_agent_start`, `tool_call`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-guardrail)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md#troubleshooting) for extension-specific recovery steps.
