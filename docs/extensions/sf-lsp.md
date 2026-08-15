---
title: "SF LSP"
description: "Real-time Salesforce LSP diagnostics on write/edit with a working indicator, transcript rows, and one-line startup readiness in SF Welcome"
editLink: false
---

# SF LSP

<p class="sfpi-page-lead">Real-time Salesforce LSP diagnostics on write/edit with a working indicator, transcript rows, and one-line startup readiness in SF Welcome</p>

## What it does

Advisory LSP diagnostics on write/edit for Apex/LWC/Agent Script files. Surfaces appear as a working indicator, transcript row, one-line SF Welcome readiness row (via sf-lsp-health), and a /sf-lsp doctor + activity panel.

## Start

Open the extension from its primary command:

```text
/sf-lsp
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-lsp
/sf-pi enable sf-lsp
/sf-pi disable sf-lsp
```

## Safety notes

- Never overrides the built-in write/edit tools (pi cross-extension conflict guard).
- Defers .agent file diagnostics to sf-agentscript when that extension is loaded.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-lsp`
- **Intent:** Build agents
- **Category:** Assistive
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-lsp`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-lsp)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/README.md#troubleshooting) for extension-specific recovery steps.
