---
title: "SF MCP"
description: "Conflict-aware Salesforce MCP preset catalog and plan-bound configuration tool for Pi's native MCP runtime"
editLink: false
---

# SF MCP

<p class="sfpi-page-lead">Conflict-aware Salesforce MCP preset catalog and plan-bound configuration tool for Pi's native MCP runtime</p>

## What it does

Provides an opt-in, product-grouped Salesforce MCP preset catalog over Pi's built-in MCP runtime. The plan-bound sf_mcp family tool lets agents inspect status, review source-bound redacted configuration plans, apply exact native MCP entries through Guardrail, disable unchanged managed entries, and produce human OAuth login handoffs. The unified Configure MCP editor remains available for interactive connection status, numbered tool inventory, color-coded exposure modes, inline conflict guidance, profile selection, and explicit Review & Save. Conflict, drift, adoption, and apply workflows stay fail-closed and preserve user-owned configuration.

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

- No Salesforce MCP server is configured, connected, launched, or exposed by default; status and plan actions are non-mutating.
- configure.apply and disable.apply require an exact session-bound plan id/hash, unchanged source state, explicit scope, allow_mutation=true, and SF Guardrail approval.
- Pi's built-in MCP extension owns transport, OAuth, tokens, connections, exposure, resources, and readiness; login.handoff never performs human OAuth consent.
- Direct capability overlaps default to native SF Pi owners; complementary profiles use hidden-by-default server exposure with exact approved tools.
- Manual or externally modified native MCP entries are adopted or reset only after an explicit review; malformed configuration is never overwritten.
- Pi-normalized server-name collisions require the user to choose the one entry to keep.
- Governed presets, including Salesforce DX, Tableau, Tableau Next, Trailhead, Marketing Cloud Engagement, and MuleSoft DX, use hidden server exposure with exact reviewed per-tool policies; newly observed unapproved tools remain unreachable.
- The unified editor makes Hidden, Code Mode, Deferred, and Direct guidance persistent, while risky Direct choices still warn and every save retains explicit diff review before persistence.
- Exact tool conflict recommendations change only MCP exposure; SF MCP never disables an SF Pi capability owner automatically.
- Observed additions remain locked hidden until a reviewed preset revision approves them; removed documented tools are unavailable and can be repaired to Hidden on unchanged managed entries.
- Agentforce Sales is sandbox-only and experimental in SF Pi; its secret is an environment reference and every operation remains Guardrail-mediated and fail-closed without exact OAuth-org identity.
- Standalone Tableau uses Pi-native OAuth against Tableau's managed endpoint; Trailhead uses its published no-auth, read-only public-content endpoint.
- Custom MCP URLs start with no callable tools.
- Legacy SObject MCP entries are not managed by SF MCP; if manually configured, their mutation tools remain Guardrail-mediated and fail closed.
- Agentforce Sales and MuleSoft secrets are referenced through environment variables and are never stored in native MCP configuration or SF MCP state.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-mcp`
- **Intent:** Personalize pi
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-mcp`
- **LLM tools:** `sf_mcp`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `before_agent_start`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-mcp/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-mcp)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-mcp/AGENT_GUIDE.md)
