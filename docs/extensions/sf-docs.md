---
title: "SF Docs"
description: "Search and fetch official Salesforce documentation from pi with cited, agent-friendly results."
---

# SF Docs

<p class="sfpi-page-lead">Search and fetch official Salesforce documentation from pi with cited, agent-friendly results.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Official Salesforce documentation lookup</strong><p>Search and fetch official Salesforce documentation from pi with cited, agent-friendly results.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Gives agents a first-class docs tool instead of generic web search.</div>
<div class="sfpi-benefit-card">Keeps credentials local in Pi auth with an env-var automation fallback.</div>
<div class="sfpi-benefit-card">Shows citations and URLs visibly while keeping tool context compact.</div>
</div>

## Try it first

Open Docs setup/status

```text
/sf-docs
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-docs
/sf-pi enable sf-docs
/sf-pi disable sf-docs
```

## Common use cases

- Find official Salesforce docs for Apex, LWC, Agentforce, Data Cloud, Tableau, MuleSoft, and admin topics.
- Search docs, fetch source pages, and answer from cited evidence.
- Discover valid documentation collections, versions, locales, and formats.
- Configure project-specific docs defaults without storing secrets in project files.

## What you get

- One `sf_docs` family tool for status, collections, search, fetch, answer, explain, and cheatsheet actions.
- A Manager settings page for non-secret defaults and connection status.
- A local catalog cache that stores collection metadata only, never document bodies.

## Safety notes

- Interactive login uses SF Pi's shared fixed-mask component; Pi alone persists and removes API-key or OAuth-compatible credentials under provider id `sf-docs`.
- Uses native fetch plus a small local SSE parser; no MCP server, MCP SDK, or extra runtime dependency is required.
- Caches only the collection catalog and never caches search results, answer text, fetched document bodies, prompts, or citations.
- Tool output keeps URLs and citations visible while redacting token-bearing values from errors and UI surfaces.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-docs`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-docs`
- **LLM tools:** `sf_docs`
- **Providers:** `sf-docs`
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-docs)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/README.md#troubleshooting) for extension-specific recovery steps.
