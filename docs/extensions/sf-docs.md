---
title: "SF Docs"
description: "Salesforce documentation lookup for agents and humans, with Pi-owned auth-store credentials, cited results, and a Manager settings surface."
editLink: false
---

# SF Docs

<p class="sfpi-page-lead">Salesforce documentation lookup for agents and humans, with Pi-owned auth-store credentials, cited results, and a Manager settings surface.</p>

## What it does

Provides one `sf_docs` family tool for Salesforce documentation collections, search, fetch, cited answers, single-document explanations, status, and a lazy cheatsheet. The extension talks directly to the Salesforce Docs MCP-over-HTTP endpoint through a small local JSON-RPC/SSE transport, stores the token in Pi's auth store, and keeps settings limited to non-secret defaults.

## Start

Open the extension from its primary command:

```text
/sf-docs
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-docs
/sf-pi enable sf-docs
/sf-pi disable sf-docs
```

## Safety notes

- Interactive login uses SF Pi's shared fixed-mask component; Pi alone persists and removes API-key or OAuth-compatible credentials under provider id `sf-docs`.
- Uses native fetch plus a small local SSE parser; no MCP server, MCP SDK, or extra runtime dependency is required.
- Caches only the collection catalog and never caches search results, answer text, fetched document bodies, prompts, or citations.
- Tool output keeps URLs and citations visible while redacting token-bearing values from errors and UI surfaces.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-docs`
- **Intent:** Build agents
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
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/AGENT_GUIDE.md)
- [Reference index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/docs/README.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/README.md#troubleshooting) for extension-specific recovery steps.
