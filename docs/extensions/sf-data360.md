---
title: "SF Data 360"
description: "Give agents a safe, compact way to discover and run Data Cloud / Data 360 workflows."
---

# SF Data 360

<p class="sfpi-page-lead">Give agents a safe, compact way to discover and run Data Cloud / Data 360 workflows.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Data 360 metadata, SQL, and capabilities</strong><p>Give agents a safe, compact way to discover and run Data Cloud / Data 360 workflows.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Discover Data 360 capabilities without memorizing REST endpoints.</div>
<div class="sfpi-benefit-card">Use dry-runs and compact summaries before broad or mutating calls.</div>
<div class="sfpi-benefit-card">Inspect DMO/DLO metadata without dumping large catalogs into context.</div>
</div>

## Try it first

Open the Data 360 panel

```text
/sf-data360
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-data360
/sf-pi enable sf-data360
/sf-pi disable sf-data360
```

## Common use cases

- Probe whether an org has Data 360 surfaces available.
- List or describe DMO and DLO schemas.
- Run Data 360 REST calls through Salesforce CLI auth.
- Use curated capabilities for repeatable Data 360 workflows.

## What you get

- Capability search/examples/execute through `d360`.
- Direct REST escape hatch through `d360_api`.
- Compact metadata helpers and readiness probes.

## Safety notes

- No MCP runtime or Java subprocess is used.
- The v2 data360\_\* tools route through the shared action registry and existing safety gates.
- Mutating calls are classified by method/path and confirmed when required.
- The extension uses plain reference docs instead of contributing Agent Skills.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-data360`
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

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/README.md#troubleshooting) for extension-specific recovery steps.
