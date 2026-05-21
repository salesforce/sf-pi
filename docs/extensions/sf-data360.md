---
title: "SF Data 360"
description: "Data 360 capability facade plus direct REST access through @salesforce/core Connection with API-version pinning, target-org resolution, dry-run, safety confirmation, compact metadata helpers, deterministic observability capabilities, and progressive skill references."
---

# SF Data 360

Data 360 capability facade plus direct REST access through @salesforce/core Connection with API-version pinning, target-org resolution, dry-run, safety confirmation, compact metadata helpers, deterministic observability capabilities, and progressive skill references.

## What it is

Data Cloud/Data 360 capability facade and direct REST helper — d360 search/examples/execute, d360_api, compact metadata discovery, readiness probe, and progressive-disclosure references

## At a glance

| Property         | Value                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Extension id     | `sf-data360`                                                                                                       |
| Category         | Agent Tool                                                                                                         |
| Maturity         | stable                                                                                                             |
| Default state    | on                                                                                                                 |
| Runtime surfaces | commands, tools, events                                                                                            |
| Source           | [`extensions/sf-data360/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data360)                    |
| Full README      | [`extensions/sf-data360/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-data360`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-data360
/sf-pi disable sf-data360
/sf-pi status sf-data360
```

## Runtime surfaces

- **Commands:** `/sf-data360`
- **LLM tools:** `d360`, `d360_api`, `d360_metadata`, `d360_probe`
- **Events/hooks:** `session_start`, `session_shutdown`, `resources_discover`

## Agent tools

Agents can call these tools when the extension is enabled and configured:

- `d360`
- `d360_api`
- `d360_metadata`
- `d360_probe`

## Safety and privacy

- No MCP runtime or Java subprocess is used.
- Mutating calls are classified by method/path and confirmed when required.
- The sf-data360 skill is contributed only while the extension is enabled.

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/index.ts)
- [`lib/facade-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/facade-tool.ts)
- [`lib/api-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/api-tool.ts)
- [`lib/path.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/path.ts)
- [`lib/safety.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/safety.ts)
- [`lib/metadata-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/metadata-tool.ts)
- [`lib/probe-tool.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/probe-tool.ts)
- [`lib/config-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/lib/config-panel.ts)
- [`skills/sf-data360/SKILL.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/skills/sf-data360/SKILL.md)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data360)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/README.md#troubleshooting) for extension-specific recovery steps.
