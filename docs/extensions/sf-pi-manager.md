---
title: "SF Pi Manager"
description: "Use one home base to discover, enable, disable, configure, and diagnose the SF Pi bundle."
---

# SF Pi Manager

<p class="sfpi-page-lead">Use one home base to discover, enable, disable, configure, and diagnose the SF Pi bundle.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Extension management</strong><p>Use one home base to discover, enable, disable, configure, and diagnose the SF Pi bundle.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Shows every bundled extension in one place.</div>
<div class="sfpi-benefit-card">Lets users enable or disable optional surfaces by scope.</div>
<div class="sfpi-benefit-card">Provides status, recommendations, announcements, and doctor checks.</div>
</div>

## Try it first

Open the SF Pi home base

```text
/sf-pi
```

## Common use cases

- See which extensions are enabled.
- Turn optional extensions on or off.
- Install recommended companion extensions.
- Run package-level status and doctor checks.

## What you get

- The central SF Pi command panel.
- Enable/disable and status commands.
- Recommended extension and announcement surfaces.

## Safety notes

- Owns the WRITE side of pi's package filter list via lib/common/sf-pi-package-state.ts.
- Auto Update is opt-in, interactive-session only, agent-settled, machine-locked, abortable, and output-redacted; it never performs an unbounded Pi self-update.
- Package automation is limited to outdated unpinned global npm packages with declared active Pi/Node compatibility; pinned, local, git, project, incompatible, and unverifiable packages are skipped.
- alwaysActive cannot be disabled through the standard toggle action.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-pi-manager`
- **Category:** Manager
- **Maturity:** stable
- **Default state:** always-on
- **Commands:** `/sf-pi`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `agent_start`, `agent_settled`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-pi-manager)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/README.md#troubleshooting) for extension-specific recovery steps.
