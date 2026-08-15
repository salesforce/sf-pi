---
title: "SF tldraw"
description: "Deterministic, editable Salesforce diagrams rendered through the local tldraw offline Canvas API."
editLink: false
---

# SF tldraw

<p class="sfpi-page-lead">Deterministic, editable Salesforce diagrams rendered through the local tldraw offline Canvas API.</p>

## What it does

Provides one Salesforce-focused `tldraw_canvas` family tool for tldraw offline v1.12 runtime status, explicit document creation, document discovery, and deterministic Data Model, System/Solution Architecture, and Interaction/Sequence profiles. Data Model pages use a title-only header with a configurable stacked Relationships key. Render actions use strict Spec v2 with explicit grounding, inspectable provenance, render-privacy checks, pinned SLDS icons, preserve-by-default updates, and readiness-gated screenshot evidence; generic canvas work stays with the upstream tldraw-offline skill.

## Start

Open the extension from its primary command:

```text
/sf-tldraw
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-tldraw
/sf-pi enable sf-tldraw
/sf-pi disable sf-tldraw
```

## Safety notes

- Never infers or fabricates Salesforce schema, relationship, count, sharing, record-type, icon, or product facts; strict Spec v2 elements carry inspectable source provenance.
- Rejects unknown Spec v2 fields and sensitive rendered text; execution-only target_org is neither rendered nor persisted.
- Requires the tldraw offline v1.12 Canvas API contract. Document creation uses only the native non-overwriting route and never falls back to OS automation, browser automation, or direct `.tldraw` archive generation.
- Treats the tldraw app as the sole owner of the `tldraw-offline` Pi skill; readiness checks are read-only and SF Pi never bundles or overwrites a duplicate skill.
- Default updates preserve human positioning and annotations; relayout and replacement must be explicit and only profile-managed shapes can be removed.
- A Salesforce render is not reported complete until spec validation, zero canvas lints, connector-terminal checks, typography checks, and screenshot capture pass.
- Reads the per-launch bearer token for each request, never prints or persists it, and redacts runtime error details.
- Generic canvas search, raw execution, standalone screenshots, and document scripts are not exposed by SF tldraw; the upstream app-managed skill owns those workflows.
- Screenshot sources used by Salesforce renders must be regular JPEG/PNG files inside tldraw's dedicated temporary capture directory before private 0600 artifact copies are exposed.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-tldraw`
- **Intent:** Build apps
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-tldraw`
- **LLM tools:** `tldraw_canvas`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-tldraw/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-tldraw)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-tldraw/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-tldraw/AGENT_GUIDE.md)
- [Reference index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-tldraw/docs/README.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-tldraw/README.md#troubleshooting) for extension-specific recovery steps.
