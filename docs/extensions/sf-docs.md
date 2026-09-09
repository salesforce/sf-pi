---
title: "SF Docs"
description: "Salesforce documentation lookup for agents and humans, with Pi-native endpoint configuration, cited results, and a Manager settings surface."
editLink: false
---

# SF Docs

<p class="sfpi-page-lead">Salesforce documentation lookup for agents and humans, with Pi-native endpoint configuration, cited results, and a Manager settings surface.</p>

## What it does

Provides one `sf_docs` family tool with explicit deterministic grounding, literal search/fetch primitives, cited answers, single-document explanations, collection discovery, status, and a lazy cheatsheet. Ground records bounded catalog, search, fallback, and fetch steps while explicit collection values remain authoritative. The extension talks directly to an internally supplied Salesforce Docs MCP-over-HTTP endpoint; Pi-native `/login sf-docs` stores only the endpoint URL, no access token is required or transmitted, and no default endpoint is shipped.

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

- Interactive `/login sf-docs` collects and persists only an internally supplied endpoint URL under provider id `sf-docs`; no access token is required, stored, or transmitted. The extension ships with no default endpoint.
- Uses native fetch plus a small local SSE parser; no MCP server, MCP SDK, or extra runtime dependency is required.
- Caches only the collection catalog, scopes it by a one-way endpoint identity without persisting the endpoint URL, and never caches search results, answer text, fetched document bodies, prompts, or citations.
- Tool output keeps source URLs and always-on answer/explain citations visible, bounds model-facing text, distinguishes partial or failed retrieval from truncation, records deterministic ground steps, and keeps the configured service endpoint out of model-visible status output.

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
- **Events/hooks:** `session_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-docs)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/AGENTS.md)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/AGENT_GUIDE.md)
- [Reference index](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/docs/README.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-docs/README.md#troubleshooting) for extension-specific recovery steps.
