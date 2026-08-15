---
title: "SF Welcome"
description: "Salesforce-branded splash screen with environment status, release freshness, and community info"
editLink: false
---

# SF Welcome

<p class="sfpi-page-lead">Salesforce-branded splash screen with environment status, release freshness, and community info</p>

## What it does

Two-column startup splash with model/environment status, one-line LSP and Herdr readiness, optional gateway usage, and release freshness on the left, plus announcements/recommended extensions/recent sessions on the right. Dismissable overlay (default) or persistent header (quietStartup), plus /sf-welcome and /sf-setup-fonts commands.

## Start

Open the extension from its primary command:

```text
/sf-welcome
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-welcome
/sf-pi enable sf-welcome
/sf-pi disable sf-welcome
```

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-welcome`
- **Intent:** Personalize pi
- **Category:** UI
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-welcome`, `/sf-setup-fonts`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `agent_start`, `tool_call`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-welcome)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/README.md#troubleshooting) for extension-specific recovery steps.
