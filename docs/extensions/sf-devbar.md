---
title: "SF DevBar"
description: "Keep model, org, git, context, and extension status visible while you work in pi."
---

# SF DevBar

<p class="sfpi-page-lead">Keep model, org, git, context, and extension status visible while you work in pi.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Session awareness</strong><p>Keep model, org, git, context, and extension status visible while you work in pi.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">See your active Salesforce org without running extra commands.</div>
<div class="sfpi-benefit-card">Keep model and context status visible at a glance.</div>
<div class="sfpi-benefit-card">Use quick status commands when something feels off.</div>
</div>

## Try it first

Inspect dev status

```text
/sf-devbar
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-devbar
/sf-pi enable sf-devbar
/sf-pi disable sf-devbar
```

## Common use cases

- Confirm which Salesforce org pi is pointed at.
- Check whether SF Pi status surfaces are active.
- Use `/sf-org` before org-aware work.

## What you get

- Top and footer status surfaces for pi sessions.
- Project-scoped Salesforce org information.
- Quick commands for org and DevBar status.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-devbar`
- **Category:** UI
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-devbar`, `/sf-org`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `model_select`, `session_info_changed`, `thinking_level_select`, `turn_start`, `turn_end`, `agent_end`, `before_agent_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-devbar)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/README.md#troubleshooting) for extension-specific recovery steps.
