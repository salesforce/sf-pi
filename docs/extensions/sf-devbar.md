---
title: "SF DevBar"
description: "Two non-blocking status bars: a top widget with model/thinking/git/context, and a custom footer with project-scoped org info, monthly LLM-gateway budget, and active extension counts."
---

# SF DevBar

Two non-blocking status bars: a top widget with model/thinking/git/context, and a custom footer with project-scoped org info, monthly LLM-gateway budget, and active extension counts.

## What it is

Bespoke Salesforce developer status bar with org context, model info, git, and context window progress

## At a glance

| Property         | Value                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-devbar`                                                                                                      |
| Category         | UI                                                                                                               |
| Maturity         | stable                                                                                                           |
| Default state    | on                                                                                                               |
| Runtime surfaces | commands, events                                                                                                 |
| Source           | [`extensions/sf-devbar/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-devbar)                    |
| Full README      | [`extensions/sf-devbar/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-devbar`
- `/sf-org`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-devbar
/sf-pi disable sf-devbar
/sf-pi status sf-devbar
```

## Runtime surfaces

- **Commands:** `/sf-devbar`, `/sf-org`
- **Events/hooks:** `session_start`, `session_shutdown`, `model_select`, `thinking_level_select`, `turn_start`, `turn_end`, `agent_end`, `before_agent_start`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/index.ts)
- [`lib/top-bar.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/lib/top-bar.ts)
- [`lib/bottom-bar.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/lib/bottom-bar.ts)
- [`lib/git-changes.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/lib/git-changes.ts)
- [`lib/settings-reader.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/lib/settings-reader.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-devbar)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-devbar/README.md#troubleshooting) for extension-specific recovery steps.
