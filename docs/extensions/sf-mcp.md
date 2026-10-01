---
title: "SF MCP"
description: "Conflict-aware Salesforce MCP preset catalog for Pi's native MCP runtime"
editLink: false
---

# SF MCP

<p class="sfpi-page-lead">Conflict-aware Salesforce MCP preset catalog for Pi's native MCP runtime</p>

## What it does

Provides an opt-in Salesforce MCP preset catalog over Pi's built-in MCP runtime. Its embedded Manager workflow keeps conflict review, setup, adoption, redacted diff, reset, canonical-name reconciliation, apply, and results inside one floating panel; it detects semantic overlap with enabled SF Pi family tools, governs approved tool contracts and observed drift, publishes compact native server descriptions, preserves manual native configuration, keeps unknown tools quarantined, and writes no server entry until the user explicitly enables or resets one.

## Start

Open the extension from its primary command:

```text
/sf-mcp
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-mcp
/sf-pi enable sf-mcp
/sf-pi disable sf-mcp
```

## Safety notes

- No Salesforce MCP server is configured, connected, launched, or exposed by default.
- Pi's built-in MCP extension owns transport, OAuth, tokens, connections, exposure, resources, and readiness.
- Direct capability overlaps default to native SF Pi owners; complementary profiles use hidden-by-default server exposure with exact approved tools.
- Manual or externally modified native MCP entries are adopted or reset only after an explicit review; malformed configuration is never overwritten.
- Pi-normalized server-name collisions require the user to choose the one entry to keep.
- Governed hosted presets use hidden exposure with exact approved tools, and custom MCP URLs start with no callable tools.
- Legacy SObject MCP entries are not managed by SF MCP; if manually configured, their mutation tools remain Guardrail-mediated and fail closed.
- MuleSoft secrets are referenced through environment variables and are never stored in native MCP configuration or SF MCP state.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-mcp`
- **Intent:** Personalize pi
- **Category:** Assistive
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-mcp`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `before_agent_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-mcp/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-mcp)
