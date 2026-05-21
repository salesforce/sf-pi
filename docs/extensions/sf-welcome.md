---
title: "SF Welcome"
description: "Two-column startup splash with model/cost/environment status and release freshness on the left, plus announcements/recommended extensions/recent sessions on the right. Dismissable overlay (default) or persistent header (quietStartup), plus /sf-welcome and /sf-setup-fonts commands."
---

# SF Welcome

Two-column startup splash with model/cost/environment status and release freshness on the left, plus announcements/recommended extensions/recent sessions on the right. Dismissable overlay (default) or persistent header (quietStartup), plus /sf-welcome and /sf-setup-fonts commands.

## What it is

Salesforce-branded splash screen with environment status, release freshness, and community info

## At a glance

| Property         | Value                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Extension id     | `sf-welcome`                                                                                                       |
| Category         | UI                                                                                                                 |
| Maturity         | stable                                                                                                             |
| Default state    | on                                                                                                                 |
| Runtime surfaces | commands, events                                                                                                   |
| Source           | [`extensions/sf-welcome/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-welcome)                    |
| Full README      | [`extensions/sf-welcome/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-welcome`
- `/sf-setup-fonts`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-welcome
/sf-pi disable sf-welcome
/sf-pi status sf-welcome
```

## Runtime surfaces

- **Commands:** `/sf-welcome`, `/sf-setup-fonts`
- **Events/hooks:** `session_start`, `agent_start`, `tool_call`, `session_shutdown`

## Configuration and state

State files:

- `~/.pi/agent/sf-welcome-state.json`
- `&lt;globalAgentDir&gt;/sf-pi/sf-welcome/pi-release-status.json`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/index.ts)
- [`lib/splash-component.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/splash-component.ts)
- [`lib/splash-data.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/splash-data.ts)
- [`lib/recommendations-status.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/recommendations-status.ts)
- [`lib/release-status.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/release-status.ts)
- [`lib/sf-cli-status.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/sf-cli-status.ts)
- [`lib/sf-skills-status.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/sf-skills-status.ts)
- [`lib/extension-health.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/extension-health.ts)
- [`lib/font-installer.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/lib/font-installer.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-welcome)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-welcome/README.md#troubleshooting) for extension-specific recovery steps.
