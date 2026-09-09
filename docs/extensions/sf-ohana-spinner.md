---
title: "SF Ohana Spinner"
description: "Short Salesforce waiting messages in Pi's working indicator"
editLink: false
---

# SF Ohana Spinner

<p class="sfpi-page-lead">Short Salesforce waiting messages in Pi's working indicator</p>

## What it does

Ohana rotates short Salesforce messages through Pi's working indicator; Calm leaves Pi's default Working label. Pi owns spinner, color, and start/stop.

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
