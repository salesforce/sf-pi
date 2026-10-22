---
title: "SF LLM Gateway"
description: "Salesforce LLM Gateway provider with model discovery"
editLink: false
---

# SF LLM Gateway

<p class="sfpi-page-lead">Salesforce LLM Gateway provider with model discovery</p>

## What it does

Complete Pi Provider for the Salesforce LLM Gateway. Pi-owned credential persistence and model storage, authenticated dynamic discovery with exact Pi-catalog admission, capability-coverage diagnostics and offline cache filtering, mixed-API dispatch, guarded Responses terminal-close recovery, Gateway-only prompt-cache-key omission and tool-image compatibility, scoped opt-out for exact GPT Sol Responses priority requests, cache-only dedicated-compaction readiness and focused setup, explicit refresh, connectivity diagnostics, opt-in bounded text/tool/generated-image probes, and usage status.

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
- Dedicated compaction accepts only authenticated cached sf-llm-gateway models, delegates summary construction and checkpoint formatting to Pi, checks context fit before dispatch, rejects invalid summaries, never changes the chat model, requires trusted project scope, and falls back to Pi.
- Discovery and restored cache entries publish only exact IDs backed by a reusable public Pi catalog API.
- Catalog-backed GPT models retain Pi's Responses transport even when Gateway discovery declares chat; other models continue to honor discovered route mode.
- Gateway OpenAI-compatible requests omit the optional prompt_cache_key field without changing other providers; this may reduce cache affinity.
- Gateway Responses image-bearing tool outputs preserve function-call correlation and move recognized images into a labeled adjacent user message; unknown parts and other providers remain unchanged.
- Only exact eligible Gateway Responses requests apply the scoped priority preference: trusted project over global, on by default; off explicitly requests the default tier after caller hooks. The effective tier and pricing are not asserted.
- Sentinel-only empty access clears stale selectable models; ambiguous discovery failures retain the last-known catalog.
- Recognized access, unsupported-image, transient-stream, and configuration failures are replaced with bounded guidance without echoing raw provider bodies.
- Transient-stream guidance keeps a fixed transport cause so Pi agent auto-retry still applies.
- Responses terminal-close recovery accepts one terminal event only after all observed output items finish, preserves caller cancellation, and records a bounded warning diagnostic.
- Capability coverage counts only complete route records with mode, token limits, vision, reasoning, and function-calling declarations; missing or partial metadata is non-blocking for exact Pi-backed image input, while explicit contradictions warn in doctor.
- Ordinary doctor runs never invoke models; opt-in text, tool, and generated non-private image probes are bounded, billable, content-free, local-only, and never persisted or uploaded.
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
- **Events/hooks:** `session_start`, `message_end`, `session_before_compact`, `turn_end`, `model_select`, `after_provider_response`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-llm-gateway)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway/AGENTS.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway/README.md#troubleshooting) for extension-specific recovery steps.
