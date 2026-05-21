---
title: "SF Ohana Spinner"
description: "Pi setWorkingIndicator-driven spinner with Ohana and Calm modes. Pi manages start/stop based on streaming activity; this extension owns frame generation and a small mode preference."
---

# SF Ohana Spinner

Pi setWorkingIndicator-driven spinner with Ohana and Calm modes. Pi manages start/stop based on streaming activity; this extension owns frame generation and a small mode preference.

## What it is

Salesforce-themed rainbow spinner during LLM thinking

## At a glance

| Property         | Value                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Extension id     | `sf-ohana-spinner`                                                                                                             |
| Category         | UI                                                                                                                             |
| Maturity         | stable                                                                                                                         |
| Default state    | on                                                                                                                             |
| Runtime surfaces | events                                                                                                                         |
| Source           | [`extensions/sf-ohana-spinner/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-ohana-spinner)                    |
| Full README      | [`extensions/sf-ohana-spinner/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/README.md) |

## How to use it

This extension works through session hooks rather than a direct slash command. Install SF Pi and keep the extension enabled to use it.

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-ohana-spinner
/sf-pi disable sf-ohana-spinner
/sf-pi status sf-ohana-spinner
```

## Runtime surfaces

- **Events/hooks:** `session_start`, `session_shutdown`

## Configuration and state

State files:

- `settings.json → sfPi.ohanaSpinner.mode`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/index.ts)
- [`lib/config-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/lib/config-panel.ts)
- [`lib/settings.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/lib/settings.ts)
- [`lib/messages.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/lib/messages.ts)
- [`lib/rainbow.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/lib/rainbow.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-ohana-spinner)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-ohana-spinner/README.md#troubleshooting) for extension-specific recovery steps.
