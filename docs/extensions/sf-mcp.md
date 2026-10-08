---
title: "SF MCP"
description: "Conflict-aware Salesforce MCP preset catalog and org-bound connection-instance configuration for Pi's native MCP runtime"
editLink: false
---

# SF MCP

<p class="sfpi-page-lead">Conflict-aware Salesforce MCP preset catalog and org-bound connection-instance configuration for Pi's native MCP runtime</p>

## What it does

Provides an opt-in, product-grouped Salesforce MCP preset catalog over Pi's built-in MCP runtime. One reviewed preset can own several independently authenticated MCP Connection Instances. For Headless 360, the plan-bound sf_mcp family tool resolves an explicit Salesforce org, proves an org-pinned My Domain OAuth issuer, derives a deterministic server name, applies the exact native entry through Guardrail, and can compare post-login read-only userinfo with the planned org identity. Connection/authentication remains separate from reviewed tool exposure, unchanged entries can be disabled, and human OAuth remains a Pi-native handoff. The Manager stays preset-first and shows org-bound instances beneath each preset. Conflict, drift, adoption, and apply workflows stay fail-closed and preserve user-owned configuration.

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
- Pi-native project overrides preserve the matching global transport and credentials, remain editable through /mcp, and are replaced with full project presets only after an explicit reviewed reset.
- Pi-normalized server-name collisions require the user to choose the one entry to keep.
- Governed presets, including Salesforce DX, Tableau, Tableau Next, Trailhead, Marketing Cloud Engagement, and MuleSoft DX, use hidden server exposure with exact reviewed per-tool policies; newly observed unapproved tools remain unreachable.
- Connection and authentication are configured separately from Tool Access; risky Direct choices still warn and every save retains explicit diff review before persistence.
- Headless 360 target_org planning succeeds only when protected-resource and OpenID discovery resolve to the explicit org's trusted My Domain. The org identity, endpoint proof, and per-org server name are source-bound and privately persisted with the managed fingerprint.
- Multiple instances can share one reviewed preset without sharing Pi OAuth credentials. Ambiguous instance actions require connection_name and legacy singleton entries remain unbound until explicitly verified.
- Exact tool conflict recommendations change only MCP exposure; SF MCP never disables an SF Pi capability owner automatically.
- Observed additions remain locked hidden until a reviewed preset revision approves them; removed documented tools are unavailable and can be repaired to Hidden on unchanged managed entries.
- Agentforce Sales is sandbox-only and experimental in SF Pi; its secret is an environment reference and every operation remains Guardrail-mediated and fail-closed without exact OAuth-org identity.
- Standalone Tableau uses Pi-native OAuth against Tableau's managed endpoint; Trailhead uses its published no-auth, read-only public-content endpoint.
- Custom MCP URLs start with no callable tools.
- Legacy SObject MCP entries are not managed by SF MCP; if manually configured, their mutation tools remain Guardrail-mediated and fail closed.
- Agentforce Sales, Slack, and MuleSoft secrets are referenced through environment variables and are never stored in SF MCP managed state.
- Slack and Informatica connections start quarantined because their public references do not publish stable exact tool-name contracts; observed tools remain Hidden pending a reviewed preset revision.
- B2C Commerce uses the GA @salesforce/b2c-dx-mcp package with a versioned reviewed tool contract and hidden-by-default exposure.

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
