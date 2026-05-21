---
title: "SF LSP"
description: "Advisory LSP diagnostics on write/edit for Apex/LWC/Agent Script files. Surfaces appear as a working indicator, transcript row, top-bar health segment (via sf-lsp-health registry), and a /sf-lsp doctor + activity panel."
---

# SF LSP

Advisory LSP diagnostics on write/edit for Apex/LWC/Agent Script files. Surfaces appear as a working indicator, transcript row, top-bar health segment (via sf-lsp-health registry), and a /sf-lsp doctor + activity panel.

## What it is

Real-time Salesforce LSP diagnostics on write/edit with a working-indicator spinner, transcript rows, and a permanent top-bar health segment in sf-devbar

## At a glance

| Property         | Value                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-lsp`                                                                                                   |
| Category         | Assistive                                                                                                  |
| Maturity         | stable                                                                                                     |
| Default state    | on                                                                                                         |
| Runtime surfaces | commands, events                                                                                           |
| Source           | [`extensions/sf-lsp/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-lsp)                    |
| Full README      | [`extensions/sf-lsp/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-lsp`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-lsp
/sf-pi disable sf-lsp
/sf-pi status sf-lsp
```

## Runtime surfaces

- **Commands:** `/sf-lsp`
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`

## Safety and privacy

- Never overrides the built-in write/edit tools (pi cross-extension conflict guard).
- Defers .agent file diagnostics to sf-agentscript when that extension is loaded.

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/index.ts)
- [`lib/lsp-client.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/lib/lsp-client.ts)
- [`lib/feedback.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/lib/feedback.ts)
- [`lib/file-classify.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/lib/file-classify.ts)
- [`lib/activity.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/lib/activity.ts)
- [`lib/working-indicator.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/lib/working-indicator.ts)
- [`lib/command-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/lib/command-panel.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-lsp)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lsp/README.md#troubleshooting) for extension-specific recovery steps.
