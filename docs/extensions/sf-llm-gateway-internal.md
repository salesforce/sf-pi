---
title: "SF LLM Gateway"
description: "Connect pi to Salesforce LLM Gateway models when your environment supports that provider."
---

# SF LLM Gateway

<p class="sfpi-page-lead">Connect pi to Salesforce LLM Gateway models when your environment supports that provider.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Model provider setup</strong><p>Connect pi to Salesforce LLM Gateway models when your environment supports that provider.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Discovers available gateway models for pi.</div>
<div class="sfpi-benefit-card">Shows provider and usage status in SF Pi surfaces.</div>
<div class="sfpi-benefit-card">Keeps provider setup separate from other bundled extensions.</div>
</div>

## Try it first

Open gateway panel

```text
/sf-llm-gateway
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-llm-gateway-internal
/sf-pi enable sf-llm-gateway-internal
/sf-pi disable sf-llm-gateway-internal
```

## Common use cases

- Configure Salesforce LLM Gateway access for pi.
- Inspect available models and provider health.
- Debug model routing or usage status.

## What you get

- A pi provider registration for Salesforce LLM Gateway.
- Model discovery and Manager-surfaced diagnostics.
- Footer status for model and usage context.

## Safety notes

- Tokens are never echoed in panel output; only describeApiKey summaries are shown.
- Pi's settings.json is mutated through pi-settings.ts helpers with race-aware reads.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-llm-gateway-internal`
- **Category:** Provider
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-llm-gateway`
- **LLM tools:** _none_
- **Providers:** `sf-llm-gateway-internal`
- **Events/hooks:** `session_start`, `turn_end`, `model_select`, `before_provider_headers`, `after_provider_response`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-llm-gateway-internal)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/README.md#troubleshooting) for extension-specific recovery steps.
