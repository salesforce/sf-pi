---
title: "SF Ohana Spinner"
description: "Salesforce-themed rainbow spinner during LLM thinking"
editLink: false
---

# SF Ohana Spinner

<p class="sfpi-page-lead">Salesforce-themed rainbow spinner during LLM thinking</p>

## What it does

Pi setWorkingIndicator-driven spinner with Ohana and Calm modes. Pi manages start/stop based on streaming activity; this extension owns frame generation and a small mode preference.

## Start

This extension is enabled by default and works automatically.

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-ohana-spinner
/sf-pi enable sf-ohana-spinner
/sf-pi disable sf-ohana-spinner
```

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-ohana-spinner`
- **Intent:** Personalize pi
- **Category:** UI
- **Maturity:** stable
- **Default state:** on
- **Commands:** _none_
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-ohana-spinner)
- [Domain glossary](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/CONTEXT.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/README.md#troubleshooting) for extension-specific recovery steps.
