---
title: "SF LLM Gateway"
description: "Salesforce LLM Gateway provider with model discovery"
editLink: false
---

# SF LLM Gateway

<p class="sfpi-page-lead">Salesforce LLM Gateway provider with model discovery</p>

## What it does

Complete Pi Provider for the Salesforce LLM Gateway. Pi-owned credential persistence and model storage, authenticated dynamic discovery with offline cache restore, provider-neutral mixed-API dispatch, optional dedicated-model compaction, explicit refresh, diagnostics, and usage status.

## Start

Open the extension from its primary command:

```text
/sf-llm-gateway
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-llm-gateway
/sf-pi enable sf-llm-gateway
/sf-pi disable sf-llm-gateway
```

## Safety notes

- API-key input uses SF Pi's shared fixed-mask component and never enters Pi's visible stock prompt.
- Pi alone persists/removes active credentials; setup and import paths write no secrets.
- Extension config stores only non-secret settings; credentials remain Pi-owned.
- Dedicated compaction accepts only authenticated sf-llm-gateway models, never changes the chat model, and falls back to Pi.
- Pi's settings.json is mutated through pi-settings.ts helpers with race-aware reads.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-llm-gateway`
- **Intent:** Personalize pi
- **Category:** Provider
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-llm-gateway`
- **LLM tools:** _none_
- **Providers:** `sf-llm-gateway`
- **Events/hooks:** `session_start`, `session_before_compact`, `turn_end`, `model_select`, `after_provider_response`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-llm-gateway)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway/AGENTS.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway/README.md#troubleshooting) for extension-specific recovery steps.
