---
title: "SF Pi Manager"
description: "Core manager for the sf-pi package. Provides /sf-pi list/enable/disable/status/display/recommended/announcements/skills/doctor commands plus the interactive TUI overlay. alwaysActive: enable/disable is mediated through this extension only."
---

# SF Pi Manager

Core manager for the sf-pi package. Provides /sf-pi list/enable/disable/status/display/recommended/announcements/skills/doctor commands plus the interactive TUI overlay. alwaysActive: enable/disable is mediated through this extension only.

## What it is

Core manager — provides /sf-pi commands

## At a glance

| Property         | Value                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Extension id     | `sf-pi-manager`                                                                                                          |
| Category         | Manager                                                                                                                  |
| Maturity         | stable                                                                                                                   |
| Default state    | always-on                                                                                                                |
| Runtime surfaces | commands, events                                                                                                         |
| Source           | [`extensions/sf-pi-manager/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-pi-manager)                    |
| Full README      | [`extensions/sf-pi-manager/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-pi`

This extension is always active because it owns package-level management behavior.

## Runtime surfaces

- **Commands:** `/sf-pi`
- **Events/hooks:** `session_start`, `session_shutdown`

## Safety and privacy

- Owns the WRITE side of pi's package filter list via lib/common/sf-pi-package-state.ts.
- alwaysActive cannot be disabled through the standard toggle action.

## Configuration and state

State files:

- `~/.pi/agent/settings.json (sf-pi package filter list)`
- `&lt;globalAgentDir&gt;/state/sf-pi/recommendations.json`
- `&lt;globalAgentDir&gt;/state/sf-pi/announcements.json`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/index.ts)
- [`lib/overlay.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/overlay.ts)
- [`lib/extension-details.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/extension-details.ts)
- [`lib/render.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/render.ts)
- [`lib/announcements.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/announcements.ts)
- [`lib/recommendations.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/recommendations.ts)
- [`lib/doctor-command.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/doctor-command.ts)
- [`lib/skill-sources-command.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/skill-sources-command.ts)
- [`lib/config-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/lib/config-panel.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-pi-manager)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-pi-manager/README.md#troubleshooting) for extension-specific recovery steps.
