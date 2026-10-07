---
title: "SF Data 360"
description: "One Pi-native Data 360 SDK tool with discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, and API actions"
editLink: false
---

# SF Data 360

<p class="sfpi-page-lead">One Pi-native Data 360 SDK tool with discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, and API actions</p>

## What it does

One Pi-native sf_data360 SDK surface over a generated business action and endpoint registry, with direct Connect/Query/Ingestion transports, rich Data 360 Run Cards, dry-run safety, structured output, and orchestrated journeys.

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
- The sf_data360 tool routes business-namespaced actions through the shared Salesforce Connection Module and direct Data 360 tenant transports.
- Mutating calls require dry-run review, allow_mutation=true, and Guardrail mediation.
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
- **LLM tools:** `sf_data360`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `resources_discover`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data360)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/AGENT_GUIDE.md)
- [Reference index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/README.md)
