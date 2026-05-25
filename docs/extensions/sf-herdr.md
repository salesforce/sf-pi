---
title: "SF Herdr"
description: "Plan dynamic Herdr lanes for Salesforce workflows without hiding pane actions."
---

# SF Herdr

<p class="sfpi-page-lead">Plan dynamic Herdr lanes for Salesforce workflows without hiding pane actions.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Herdr lane planning</strong><p>Plan dynamic Herdr lanes for Salesforce workflows without hiding pane actions.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Turns workflow context into pane plans for tests, logs, previews, evals, servers, and reviews.</div>
<div class="sfpi-benefit-card">Keeps actual pane mutations visible through the upstream Herdr tool.</div>
<div class="sfpi-benefit-card">Uses workflow profiles and recent activity signals instead of fixed permanent panes.</div>
</div>

## Try it first

Open Herdr planning status

```text
/sf-herdr
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-herdr
/sf-pi enable sf-herdr
/sf-pi disable sf-herdr
```

## Common use cases

- Plan an ephemeral test lane that closes on success and stays open on failure.
- Coordinate Agent Script preview or eval work with related Apex log lanes.
- Keep UI bundle servers or log tails sticky while short validation lanes clean themselves up.
- Inspect which workflow SF Pi currently infers from recent tool activity.

## What you get

- A non-mutating `sf_herdr_plan` tool for phased lane guidance.
- Managed Herdr workflow profiles and status surfaces.
- Branch-scoped workflow signal inference from recent tool calls and file edits.

## Safety notes

- Does not register or wrap the upstream herdr tool; pane mutations stay explicit herdr calls.
- sf_herdr_plan is non-mutating and never generates shell commands.
- sf-guardrail mediates herdr.run.command when dangerous-command or org-aware rules match.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-herdr`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-herdr`
- **LLM tools:** `sf_herdr_plan`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_tree`, `tool_execution_end`, `tool_result`, `resources_discover`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-herdr/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-herdr)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-herdr/README.md#troubleshooting) for extension-specific recovery steps.
