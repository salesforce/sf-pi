---
title: "SF LLM Gateway Internal"
description: "Single pi-native provider for the Salesforce LLM Gateway. Static bootstrap catalog plus dynamic /v1/models discovery, family-aware presets, OpenAI-compat dispatcher that delegates Claude ids to the native Anthropic transport, and footer status with model + context + monthly usage."
---

# SF LLM Gateway Internal

Single pi-native provider for the Salesforce LLM Gateway. Static bootstrap catalog plus dynamic /v1/models discovery, family-aware presets, OpenAI-compat dispatcher that delegates Claude ids to the native Anthropic transport, and footer status with model + context + monthly usage.

## What it is

Salesforce LLM Gateway provider with model discovery

## At a glance

| Property         | Value                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension id     | `sf-llm-gateway-internal`                                                                                                                    |
| Category         | Provider                                                                                                                                     |
| Maturity         | stable                                                                                                                                       |
| Default state    | on                                                                                                                                           |
| Runtime surfaces | commands, provider, events                                                                                                                   |
| Source           | [`extensions/sf-llm-gateway-internal/`](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-llm-gateway-internal)                    |
| Full README      | [`extensions/sf-llm-gateway-internal/README.md`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/README.md) |

## How to use it

Open the command surface from pi:

- `/sf-llm-gateway`

Manage the extension with SF Pi Manager:

```text
/sf-pi enable sf-llm-gateway-internal
/sf-pi disable sf-llm-gateway-internal
/sf-pi status sf-llm-gateway-internal
```

## Runtime surfaces

- **Commands:** `/sf-llm-gateway`
- **Providers:** `sf-llm-gateway-internal`
- **Events/hooks:** `session_start`, `turn_end`, `model_select`, `after_provider_response`, `session_shutdown`

## Provider surface

This extension registers provider functionality with pi:

- `sf-llm-gateway-internal`

## Safety and privacy

- Tokens are never echoed in panel output; only describeApiKey summaries are shown.
- Pi's settings.json is mutated through pi-settings.ts helpers with race-aware reads.

## Configuration and state

State files:

- `~/.pi/agent/settings.json (provider config + retry guidance)`
- `&lt;globalAgentDir&gt;/sf-llm-gateway/* (saved api key, base url, monthly usage cache)`

## Important files

- [`index.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/index.ts)
- [`lib/discovery.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/discovery.ts)
- [`lib/transport.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/transport.ts)
- [`lib/models.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/models.ts)
- [`lib/config.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/config.ts)
- [`lib/config-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/config-panel.ts)
- [`lib/command-panel.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/command-panel.ts)
- [`lib/monthly-usage.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/monthly-usage.ts)
- [`lib/doctor.ts`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/lib/doctor.ts)

## Learn more

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-llm-gateway-internal)
- [Command reference](../commands.md)
- [Bundled extension inventory](../extensions.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-llm-gateway-internal/README.md#troubleshooting) for extension-specific recovery steps.
