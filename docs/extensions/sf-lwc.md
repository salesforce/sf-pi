---
title: "SF LWC"
description: "Scan, inspect, diagnose, and locally test Lightning Web Components from pi with compact cards and artifact-backed evidence."
---

# SF LWC

<p class="sfpi-page-lead">Scan, inspect, diagnose, and locally test Lightning Web Components from pi with compact cards and artifact-backed evidence.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Lightning Web Component lifecycle workflows</strong><p>Scan, inspect, diagnose, and locally test Lightning Web Components from pi with compact cards and artifact-backed evidence.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Keeps local LWC bundle inventory, component inspection, focused diagnostics, and targeted Jest tests in one lean workflow.</div>
<div class="sfpi-benefit-card">Uses local SFDX project structure plus public LWC compiler packages instead of Salesforce CLI fallback machinery.</div>
<div class="sfpi-benefit-card">Renders human-friendly LWC Result Cards with Local Rails, diagnostics, test summaries, recommended skill hints, and full artifacts for scans and Jest output.</div>
</div>

## Try it first

Open the LWC panel

```text
/sf-lwc
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-lwc
/sf-pi enable sf-lwc
/sf-pi disable sf-lwc
```

## Common use cases

- Scan registered SFDX package directories for Lightning Web Component bundles.
- Inspect a component's files, metadata exposure, public API surface, imports, child tags, style/SLDS signals, and test coverage signals.
- Diagnose LWC HTML, JavaScript, TypeScript, and metadata files before or after edits.
- Discover, plan, and run the smallest useful local LWC Jest test without starting watch mode.

## What you get

- One sf_lwc family tool for local project scans, component listing/inspection, file diagnostics, test discovery/planning/runs, and rerun history.
- Human-friendly LWC Result Cards with Local Rails, bundle signals, diagnostic summaries, root-cause hints, and next-step guidance.
- LWC Artifacts under the global agent directory for project scans, component inspections, diagnostics JSON, Jest JSON, stdout/stderr, and markdown summaries.

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

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-lwc/README.md#troubleshooting) for extension-specific recovery steps.
