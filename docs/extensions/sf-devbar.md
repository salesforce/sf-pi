---
title: "SF DevBar"
description: "Bespoke Salesforce developer status bar with org context, model info, git, and context window progress"
editLink: false
---

# SF DevBar

<p class="sfpi-page-lead">Bespoke Salesforce developer status bar with org context, model info, git, and context window progress</p>

## What it does

Two non-blocking status bars: a top widget with model/thinking/session/git/context, and a custom footer with project-scoped org info, monthly LLM-gateway budget, and active extension counts.

## Start

Open the extension from its primary command:

```text
/sf-devbar
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-devbar
/sf-pi enable sf-devbar
/sf-pi disable sf-devbar
```

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-devbar`
- **Intent:** Work with Salesforce orgs
- **Category:** UI
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-devbar`, `/sf-org`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `model_select`, `session_compact`, `session_info_changed`, `thinking_level_select`, `turn_start`, `turn_end`, `agent_end`, `before_agent_start`, `context`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-devbar)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/README.md#troubleshooting) for extension-specific recovery steps.
