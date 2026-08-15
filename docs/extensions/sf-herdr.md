---
title: "SF Herdr"
description: "Non-mutating Salesforce workflow plans for the current split Herdr tools."
editLink: false
---

# SF Herdr

<p class="sfpi-page-lead">Non-mutating Salesforce workflow plans for the current split Herdr tools.</p>

## What it does

Provides command/status/settings surfaces everywhere it loads and conditionally registers a minimal non-mutating planner for the current herdr_layout, herdr_pane, and herdr_agent tool set.

## Start

Open the extension from its primary command:

```text
/sf-herdr
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-herdr
/sf-pi enable sf-herdr
/sf-pi disable sf-herdr
```

## Safety notes

- sf_herdr_plan is non-mutating and never generates shell commands.
- Planner steps use only herdr_layout, herdr_pane, and herdr_agent and pass the opaque pane ID returned by pane_split.
- The exact current successful-empty-body pane-run result is normalized without retrying the command.
- sf-guardrail mediates herdr_pane action=run commands when dangerous-command or org-aware rules match.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-herdr`
- **Intent:** Work safely
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-herdr`
- **LLM tools:** `sf_herdr_plan`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `tool_result`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-herdr/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-herdr)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-herdr/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-herdr/README.md#troubleshooting) for extension-specific recovery steps.
