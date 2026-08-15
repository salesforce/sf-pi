---
title: "SF LWC"
description: "Local-native Lightning Web Component lifecycle workflows for pi: project scan, component inspection, focused diagnostics, targeted Jest tests, and artifacts."
editLink: false
---

# SF LWC

<p class="sfpi-page-lead">Local-native Lightning Web Component lifecycle workflows for pi: project scan, component inspection, focused diagnostics, targeted Jest tests, and artifacts.</p>

## What it does

Owns the lean local Lightning Web Component lifecycle loop in pi: SFDX package-directory scans, component inventory and inspection, focused LWC compiler/template diagnostics, style/SLDS signal detection, local Jest discovery/planning/runs, compact LWC Result Cards, recommended skill hints, and persisted LWC Artifacts. Source edits remain normal Pi file operations; deployment, org source synchronization, visual preview, broad static/security scans, and SLDS2 uplift execution remain with other SF Pi surfaces.

## Start

Open the extension from its primary command:

```text
/sf-lwc
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-lwc
/sf-pi enable sf-lwc
/sf-pi disable sf-lwc
```

## Safety notes

- No startup project scans or org probes; local project work runs only during explicit sf_lwc tool actions.
- V1 is local-only: no deploy/retrieve, org source evidence, component creation, component rename, or visual preview.
- project.scan only scans package directories registered in sfdx-project.json; non-SFDX and workspace-wide scans are unsupported in V1.
- test.run may execute node_modules/.bin/lwc-jest with bounded args/timeouts, but never installs dependencies, starts watch mode, updates snapshots by default, calls Salesforce CLI, or runs arbitrary package scripts as the primary path.
- Full scan, diagnostic, and Jest evidence is stored as LWC Artifacts while LLM-facing output remains compact.
- SLDS/style signals only recommend uplifting-components-to-slds2 and Code Analyzer/future sf-slds2 handoffs; sf-lwc does not own SLDS2 lint execution or autofix.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-lwc`
- **Intent:** Build apps
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-lwc`
- **LLM tools:** `sf_lwc`
- **Providers:** _none_
- **Events/hooks:** `session_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lwc/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-lwc)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lwc/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lwc/README.md#troubleshooting) for extension-specific recovery steps.
