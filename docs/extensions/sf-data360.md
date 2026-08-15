---
title: "SF Data 360"
description: "Data Cloud/Data 360 v2 family tools — discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, and raw API escape hatch"
editLink: false
---

# SF Data 360

<p class="sfpi-page-lead">Data Cloud/Data 360 v2 family tools — discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, and raw API escape hatch</p>

## What it does

Data 360 v2 family tool surface over the generated operation registry: compact action discovery, dry-run planning, shared target/version resolution, safety confirmation, bounded output, journey orchestration, and a raw REST escape hatch through the Salesforce Connection Module.

## Start

Open the extension from its primary command:

```text
/sf-data360
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-data360
/sf-pi enable sf-data360
/sf-pi disable sf-data360
```

## Safety notes

- No MCP runtime or Java subprocess is used.
- The v2 data360_* tools route through the shared Salesforce Connection Module, action registry, and existing safety gates.
- Mutating calls are classified by method/path and confirmed when required.
- The extension uses plain reference docs instead of contributing Agent Skills.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-data360`
- **Intent:** Work with Data Cloud
- **Category:** Agent Tool
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-data360`
- **LLM tools:** `data360_discover`, `data360_connect`, `data360_prepare`, `data360_harmonize`, `data360_segment`, `data360_activate`, `data360_query`, `data360_semantic`, `data360_observe`, `data360_orchestrate`, `data360_api`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `resources_discover`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data360)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/AGENT_GUIDE.md)
- [Reference index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/README.md)
- [Compatibility evidence index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/compatibility/README.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/README.md#troubleshooting) for extension-specific recovery steps.
