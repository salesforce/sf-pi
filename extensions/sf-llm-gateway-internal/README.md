# sf-llm-gateway-internal — Code Walkthrough

> **⚠️ Internal-only extension.** This extension targets a
> Salesforce-internal gateway endpoint that is **not publicly reachable**.
> External users cannot use this extension. It is included in the public
> repo because the sf-pi manager expects a known set of bundled extensions,
> but you must either (a) provide your own compatible gateway via
> `SF_LLM_GATEWAY_INTERNAL_BASE_URL` + `SF_LLM_GATEWAY_INTERNAL_API_KEY`, or
> (b) disable this extension via `/sf-pi disable sf-llm-gateway-internal`.

This document explains the design and runtime flow of the Salesforce LLM Gateway
provider extension. Read this before making changes.

## What It Does

Registers the gateway as **two** Pi-native providers so each model family
runs on the pi-ai transport it was designed for. It supports dynamic model
discovery, monthly budget tracking, runtime beta header toggling, additive vs
exclusive scoped-model behavior, and a TUI setup wizard.

## Key Architecture: Two Providers, One Gateway

| Provider name                       | pi-ai API            | Base URL                                        | Models                         |
| ----------------------------------- | -------------------- | ----------------------------------------------- | ------------------------------ |
| `sf-llm-gateway-internal`           | `openai-completions` | `<gateway>/v1`                                  | Gemini, GPT, Codex             |
| `sf-llm-gateway-internal-anthropic` | `anthropic-messages` | `<gateway>` (root — SDK appends `/v1/messages`) | Claude (Opus / Sonnet / Haiku) |

Claude is routed to the native Anthropic Messages path because LiteLLM's
OpenAI-compat translator splits Claude thinking + text across multiple choices
and intermittently drops the final text delta on `choices[0]`, producing an
empty assistant turn that required users to type "continue" to unstick the
agent loop. Native Anthropic streaming avoids that entire class of failure.

Non-Claude families (Gemini, GPT, Codex) stay on OpenAI-compat because they
behave correctly on that path.

## Transport shims

`lib/transport.ts` hosts focused wrappers on top of the pi-ai transports:

1. **Codex** (`streamSfGatewayOpenAI`). Flattens Chat Completions tools into
   the Responses tool shape LiteLLM expects for Codex, and clamps
   `reasoning_effort` to the `low|medium|high` values the gateway currently
   accepts. Non-Codex payloads pass straight through.

2. **Anthropic stream errors** (`streamSfGatewayAnthropic`). Retries once when
   Anthropic reports a retryable SSE error before any user-visible content is
   emitted, then normalizes raw error envelopes into a concise message that
   preserves the request id.

3. **Opus 4.7 adaptive thinking** (`streamSfGatewayAnthropic`). pi-ai's
   adaptive-thinking allow-list currently only matches Opus 4.6 / Sonnet 4.6,
   so 4.7 would otherwise fall back to budget-based thinking (which 4.7
   does not support) with a 32K-clamped output cap. The shim:
   - Forces adaptive thinking: `thinking: { type: "adaptive" }` (the only
     thinking mode 4.7 accepts).
   - Maps the caller's pi reasoning level to `output_config.effort`:
     `minimal`/`low` → `low`, `medium` → `medium`, `high` → `high`,
     `xhigh` → `xhigh` (new 4.7 tier between `high` and `max`). Unset
     falls back to `high`, which is Anthropic's documented default.
   - Defaults `max_tokens` to **64K** (`OPUS_47_DEFAULT_MAX_TOKENS`).
     Live probes showed that `max_tokens: 128000` + `effort: "max"` on
     heavier generations intermittently surfaces
     `api_error: Internal server error` from Anthropic upstream (~5% of
     trials). 64K matches what the gateway advertises via
     `/v1/model/info` and eliminated the failure window in the same
     harness. Model hard ceiling is 128K (`OPUS_47_MODEL_MAX_TOKENS`);
     callers who need the extra headroom can override per request.
   - Strips `temperature`. Anthropic returns 400 (
     _"`temperature` may only be set to 1 when thinking is enabled or in
     adaptive mode"_) for any value ≠ 1 when adaptive thinking is on.

   Older Claude models pass straight through pi-ai's built-in per-model
   handling.

## Runtime Flow

```
Extension loads
  ├─ installWireTrace()                 ← opt-in raw gateway trace
  ├─ registerProviderIfConfigured()     ← both providers, static catalog, synchronous
  ├─ discoverAndRegister()              ← async, fire-and-forget
  ├─ registerMessageRenderer() × 2      ← both provider names
  ├─ registerCommand("sf-llm-gateway-internal")
  ├─ on("session_start")               → re-discover, sync defaults
  ├─ on("turn_end")                    → update footer status
  ├─ on("model_select")                → set thinking to xhigh (either provider)
  ├─ on("after_provider_response")     → record throttle/upstream signal (either provider)
  └─ on("session_shutdown")            → clear footer status + provider signal
```

## Configuration

Configuration follows a three-tier cascade:

```
env var  →  saved config  →  built-in default
```

- **Base URL**: `SF_LLM_GATEWAY_INTERNAL_BASE_URL` > saved > built-in default
- **API key**: `SF_LLM_GATEWAY_INTERNAL_API_KEY` > saved > missing
- **Saved config**: `~/.pi/agent/sf-llm-gateway-internal.json` (global),
  `.pi/sf-llm-gateway-internal.json` (project)
- **Scoped model mode**: saved config can keep gateway scope **additive**
  (prepend `sf-llm-gateway-internal/*`) or **exclusive**
  (replace scoped models with only gateway models and restore the prior scope on disable)

Project-scoped saved config overrides global. Env vars override everything.

The base URL can be configured as either the gateway root or the
OpenAI-compatible `/v1` root. Runtime endpoint helpers route chat/model
discovery through `/v1`, route Anthropic Messages through the gateway root,
and route admin calls such as `/user/info` through the gateway root.

## Zero-cost gateway billing

All models report `cost: 0` because the gateway is pre-paid. Billing is tracked
separately via the monthly usage endpoint (`/user/info`).

## Behavior Matrix

| Event/Trigger             | Condition                                    | Result                                                                                           |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Extension load            | enabled + has credentials                    | Register both providers (static catalog), fire-and-forget discovery                              |
| Extension load            | disabled                                     | Unregister both providers                                                                        |
| session_start             | —                                            | Re-discover models, sync session defaults                                                        |
| turn_end                  | model is on either gateway provider          | Update footer (context + monthly usage)                                                          |
| turn_end                  | model is not on either gateway provider      | Clear footer status                                                                              |
| model_select              | selected model is on either gateway provider | Set thinking to xhigh                                                                            |
| after_provider_response   | gateway model + 2xx/3xx                      | Clear any live throttle/upstream badge                                                           |
| after_provider_response   | gateway model + 429                          | Record throttle signal, footer shows ⚠ badge for 60s                                             |
| after_provider_response   | gateway model + >=500                        | Record upstream signal, footer shows ⚠ badge for 60s                                             |
| session_shutdown          | —                                            | Clear footer status + provider signal                                                            |
| /command on               | missing credentials                          | Prompt for credentials first                                                                     |
| /command on               | credentials present                          | Save config, set default (Claude→anthropic provider; others→openai provider), register, discover |
| /command off              | additive scope                               | Disable, remove gateway pattern, switch to off-default                                           |
| /command off              | exclusive scope                              | Disable, restore previous scoped models, switch to off-default                                   |
| /command refresh          | —                                            | Re-discover, refresh monthly usage                                                               |
| /command beta \<name\> on | —                                            | Toggle beta, re-register providers                                                               |
| Monthly usage fetch       | cached < 5 min old                           | Use cache                                                                                        |
| Monthly usage fetch       | stale or forced                              | Fetch from gateway /user/info                                                                    |

## File Structure

```
extensions/sf-llm-gateway-internal/
  index.ts              ← entry point (runtime logic + command handlers)
  manifest.json         ← metadata (source of truth for catalog)
  README.md             ← this file
  lib/
    config.ts           ← gateway saved-config layer (constants, types, I/O)
    gateway-url.ts      ← root vs /v1 endpoint normalization helpers
    pi-settings.ts      ← Pi settings.json path + mutation helpers
    discovery.ts        ← dual-provider registration + model discovery state
    monthly-usage.ts    ← /user/info + /key/info + /health/readiness cache
    provider-telemetry.ts ← after_provider_response signal store + header parsers
    status.ts           ← footer/status report formatting helpers
    wire-trace.ts       ← opt-in raw fetch tracer (SF_LLM_GATEWAY_INTERNAL_TRACE=1)
    models.ts           ← model catalog, discovery, inference, formatting
    transport.ts        ← Codex request shaping + Opus 4.7 max-thinking shim +
                          GPT-5 reasoning_effort allow-listing
    debug.ts            ← /utils/transform_request probe + report formatter
    config-panel.ts     ← TUI config panel for Extension Manager drill-down
    setup-overlay.ts    ← standalone TUI setup overlay wrapper
  tests/
    config.test.ts              ← saved-config normalization, enabled model patterns
    gateway-url.test.ts         ← root vs /v1 endpoint normalization
    models.test.ts              ← model ID detection, inference, dual-api tagging, /v1/model/info enrichment
    transport.test.ts           ← Codex payload shaping + Opus 4.7 max-thinking shim
    debug.test.ts               ← /utils/transform_request probe body shape + report rendering
    codex-regression.test.ts    ← optional live gateway Codex regression checks
    betas.test.ts               ← beta alias resolution, effective betas
    formatting.test.ts          ← formatTokens, formatUsd, maskApiKey, labels
    status.test.ts              ← footer/status report formatting (monthly + key + health)
    command-parsing.test.ts     ← command argument parsing
```

## Testing Strategy

Tests cover exported pure helpers. Functions that need Pi runtime context
(event handlers, command handlers, UI interactions) are tested via manual QA.

To run all unit tests: `npm test`

To run the live Codex gateway regression check:

```bash
npm run test:sf-llm-gateway-internal:codex
```

Required env vars for the live regression:

- `SF_LLM_GATEWAY_INTERNAL_BASE_URL`
- `SF_LLM_GATEWAY_INTERNAL_API_KEY`

Optional env vars:

- `SF_LLM_GATEWAY_INTERNAL_CODEX_TEST_MODEL` — defaults to `gpt-5.3-codex`
- `SF_LLM_GATEWAY_INTERNAL_CODEX_TEST_TIMEOUT_MS` — request timeout override

Exported helpers are marked with `// Exported for unit tests.` in the source.

## Debugging: `/sf-llm-gateway-internal debug`

The gateway exposes `POST /utils/transform_request`, which echoes the exact
upstream URL, headers, and body LiteLLM would send for a given request. The
extension wraps that as a first-class command:

```
/sf-llm-gateway-internal debug <modelId> [reasoning=<level>] [tool] [adaptive]
```

Examples:

```text
/sf-llm-gateway-internal debug claude-opus-4-7 adaptive reasoning=xhigh
  → Upstream: https://api.anthropic.com/v1/messages
    Body:     { thinking: { type: "adaptive" }, output_config: { effort: "xhigh" }, max_tokens: 64000, ... }

/sf-llm-gateway-internal debug gpt-5 reasoning=high
  → Body:     { reasoning_effort: "high", allowed_openai_params: ["reasoning_effort"], ... }

/sf-llm-gateway-internal debug gpt-5.3-codex reasoning=medium tool
  → Upstream: https://api.openai.com/v1/responses
    Body:     { reasoning: { effort: "medium", summary: "auto" }, tools: [...], ... }
```

This is the fastest way to verify that the shims are producing a payload shape
the gateway will accept, without burning tokens on a real completion.

## Debugging: wire trace

When the gateway returns empty or unexpected responses, enable the opt-in
wire trace to capture raw request/response bytes on disk:

```bash
SF_LLM_GATEWAY_INTERNAL_TRACE=1 pi
```

On activation, `lib/wire-trace.ts` wraps `globalThis.fetch` and logs one JSON
line per request, response header block, and SSE chunk to
`~/.pi/agent/sf-llm-gateway-internal.trace.jsonl`. The file is truncated on
each pi launch and filtered by the gateway base URL, so other providers'
requests pass through untouched.

The `/sf-llm-gateway-internal` status report shows a `Wire trace: ON` line
with the file path while tracing is active; the line is omitted when the
env var is not `1`.

A fetch wrapper is preferred over Pi's `onPayload` / `onChunk` hooks because
`onChunk` runs after pi-ai's SSE parser — if pi-ai drops a chunk, `onChunk`
wouldn't show it. The raw body is ground truth from the gateway.

## Troubleshooting

**Startup warning `No models match pattern "sf-llm-gateway-internal/*"`:**
Your credentials aren't configured yet, or the async model discovery hasn't
finished on this first run. The bootstrap catalog now seeds both Claude and
`gpt-5` synchronously, so this warning should not appear on a configured
gateway. If it persists, run `/sf-llm-gateway-internal refresh`.

**Gateway fails on startup or tool calls error out immediately:**
Confirm `SF_LLM_GATEWAY_INTERNAL_BASE_URL` and `SF_LLM_GATEWAY_INTERNAL_API_KEY`
are set (env vars win over saved config). Run
`/sf-llm-gateway-internal setup` for an interactive wizard, or
`/sf-llm-gateway-internal debug <model>` to inspect the exact upstream
payload LiteLLM would send.

**Claude responses appear to truncate and the agent asks you to type "continue":**
This is the pi-ai OpenAI-compat translator splitting Claude thinking + text
across multiple choices. The fix is already in place — Claude models route
through the native Anthropic provider (`sf-llm-gateway-internal-anthropic`)
instead of the OpenAI-compat provider. If you still see truncation, verify
the selected model is registered under the Anthropic provider in
`/sf-llm-gateway-internal models`.

**Opus 4.7 returns `api_error: Internal server error` on heavy turns:**
Handled by the transport shim: `max_tokens` now scales by pi reasoning
level (minimal=16K … xhigh=64K) instead of unconditionally flooring at
64K, and transient mid-stream failures retry up to 3 times with
exponential backoff before bubbling. If the retry exhausts, the final
error includes an inline `Tip:` footer with next steps. For deeper
inspection, enable wire tracing (`SF_LLM_GATEWAY_INTERNAL_TRACE=1`).

**Footer shows `⚠` badge after a 429 or 5xx:**
`provider-telemetry.ts` parses retry-after headers and surfaces a 60s
badge. The next successful 2xx/3xx clears it. If the badge sticks, check
`/sf-llm-gateway-internal` status for the live throttle/upstream signal.

**I set `/thinking` to a different level but subsequent model switches reset it to `xhigh`:**
Fixed: `model_select` no longer silently forces `thinkingLevel: xhigh` on
every switch. `xhigh` is still the default for fresh sessions, but user
overrides stick. If you still see a reset, check your settings for an
explicit default that could be winning.

**Beta headers aren't taking effect:**
Check the active betas with `/sf-llm-gateway-internal beta`. pi-ai merges
the `anthropic-beta` header via `Object.assign`, so the shim always
includes `fine-grained-tool-streaming-2025-05-14` first to guarantee it
isn't silently dropped when you add another beta.

**Monthly-usage footer is stale or missing:**
Usage is cached for 5 minutes; run `/sf-llm-gateway-internal refresh` to
force a `/user/info` fetch. If you're using sf-welcome or sf-devbar as
consumers, they read from the shared store in `lib/common/monthly-usage/`
— the gateway must be registered and have succeeded at least once.
