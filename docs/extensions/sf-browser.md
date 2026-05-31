---
title: "SF Browser"
description: "Use Salesforce Setup and Lightning UI as a safe last-mile tool when APIs are not enough."
---

# SF Browser

<p class="sfpi-page-lead">Use Salesforce Setup and Lightning UI as a safe last-mile tool when APIs are not enough.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Salesforce UI fallback and evidence</strong><p>Use Salesforce Setup and Lightning UI as a safe last-mile tool when APIs are not enough.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Open authenticated Salesforce pages without exposing login URLs.</div>
<div class="sfpi-benefit-card">Inspect Lightning and Setup screens with compact, agent-friendly snapshots.</div>
<div class="sfpi-benefit-card">Capture browser evidence when a UI step needs visual proof.</div>
</div>

## Try it first

Open the browser panel

```text
/sf-browser
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-browser
/sf-pi enable sf-browser
/sf-pi disable sf-browser
```

## Common use cases

- Verify a Setup screen after an API or metadata change.
- Navigate Salesforce UI when there is no stable API for the task.
- Click, fill, select, press keys, and wait for Lightning state using browser refs.
- Capture before/after evidence for UI fallback work.

## What you get

- Salesforce-aware browser open, snapshot, click, fill, select, press, wait, and evidence tools.
- Curated Setup destinations and deterministic Salesforce path resolution.
- Artifact-first screenshots so the transcript stays readable.

## Safety notes

- No startup probes; agent-browser is detected only from /sf-browser doctor or explicit tool/command actions.
- Browser Evidence is artifact-first and stored outside the project by default.
- Session-bearing Salesforce org-open URLs are passed to agent-browser but not echoed in tool results.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-browser`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-browser`
- **LLM tools:** `sf_browser_open_org`, `sf_browser_snapshot`, `sf_browser_click`, `sf_browser_fill`, `sf_browser_select`, `sf_browser_press`, `sf_browser_editor`, `sf_browser_wait`, `sf_browser_capture_evidence`, `sf_browser_resolve_path`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `resources_discover`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-browser)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/README.md#troubleshooting) for extension-specific recovery steps.
