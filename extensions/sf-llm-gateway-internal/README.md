# sf-llm-gateway-internal — Code Walkthrough

> **⚠️ Internal-only extension.** This extension targets a
> Salesforce-internal gateway endpoint that is **not publicly reachable**.
> External users cannot use this extension. It is included in the public
> repo because the sf-pi manager expects a known set of bundled extensions,
> but you must either (a) provide your own compatible gateway via
> `/sf-llm-gateway` (or env vars for automation), or (b) disable
> this extension via `/sf-pi disable sf-llm-gateway-internal`.

This document explains the design and runtime flow of the Salesforce LLM Gateway
provider extension. Read this before making changes.

## What It Does

Registers the gateway as a single unified Pi-native provider and routes
Claude vs non-Claude traffic to the transport each family was designed for.
Supports dynamic model discovery, monthly budget tracking, runtime beta
header toggling, additive vs exclusive scoped-model behavior, a TUI setup
wizard with browser token-generation and Claude Code import actions, a read-only
usage probe, and a backward-compatible in-app token paste flow under `/login`.

## Key Architecture: One Provider, Two Transports

Since R1·Unify the extension registers a single Pi provider (`sf-llm-gateway-
internal`) with a friendly display label `SF LLM Gateway (Salesforce Internal)`.
Every model is registered under the provider-level `openai-completions` API so
pi always invokes the provider's custom `streamSimple` dispatcher. Claude models
also carry a per-model `baseUrl` pinned to the gateway root, so the
dispatcher only has to switch the request model to `api: "anthropic-messages"`
and forward to the matching shim:

| Model family             | Pi-registered API    | Runtime transport          | Base URL used                                      |
| ------------------------ | -------------------- | -------------------------- | -------------------------------------------------- |
| Gemini / GPT / Codex     | `openai-completions` | `streamSfGatewayOpenAI`    | `<gateway>/v1`                                     |
| Claude (Opus/Sonnet/...) | `openai-completions` | `streamSfGatewayAnthropic` | `<gateway>` (Anthropic SDK appends `/v1/messages`) |

Claude runs on the native Anthropic Messages path because LiteLLM's
OpenAI-compat translator splits Claude thinking + text across multiple
choices and intermittently drops the final text delta on `choices[0]`,
producing an empty assistant turn that required users to type "continue"
to unstick the agent loop. Native Anthropic streaming avoids that entire
class of failure. Non-Claude families behave correctly on OpenAI-compat
and stay there.

### Why one provider?

The earlier layout registered two providers (`sf-llm-gateway-internal` and
`sf-llm-gateway-internal-anthropic`) so they appeared as two separate rows
in pi's `/login` menu. Both used the same gateway and the same token, which
confused end users. Unifying collapses `/login` to one row and unlocks a
clean `oauth.onPrompt` paste-token flow.

### Legacy settings migration

On the first session after upgrade, `lib/migrate-unify-provider.ts`
rewrites any residual references to the retired
`sf-llm-gateway-internal-anthropic` provider in the user's pi
`settings.json` (global + project):

- `defaultProvider`
- `defaultModel` (prefix rewrite)
- `enabledModels` (drops `sf-llm-gateway-internal-anthropic/*`)

The migration is idempotent: a per-file sentinel under `sfPi.gatewayUnifyMigrated`
short-circuits subsequent sessions. Users see no prompt and no manual step.

## Transport shims

`lib/transport.ts` hosts focused wrappers on top of the pi-ai transports:

1. **Codex** (`streamSfGatewayOpenAI`). Flattens Chat Completions tools into
   the Responses tool shape LiteLLM expects for Codex, and clamps
   `reasoning_effort` to the `low|medium|high` values the gateway currently
   accepts. Non-Codex payloads pass straight through.

   Also: **gpt-5.5 force-strips `reasoning_effort`**. The gateway returns
   400 `"Function tools with reasoning_effort are not supported for gpt-5.5
in /v1/chat/completions. Please use /v1/responses instead."` when an
   agentic turn (which always carries tools) includes the field. `/v1/responses`
   is not exposed on this gateway — the route 302s to SSO login — so the
   only safe path is to omit the field entirely. gpt-5.5 still performs
   implicit reasoning on every turn.

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
   - Scales `max_tokens` by pi reasoning level (`minimal`/`low` → 16K,
     `medium` → 32K, `high`/`xhigh` → 64K). Live probes showed that
     `max_tokens: 128000` + `effort: "max"` on heavier generations
     intermittently surfaces `api_error: Internal server error` from
     Anthropic upstream. 64K matches what the gateway advertises via
     `/v1/model/info` and keeps `xhigh` heavy-workload turns away from that
     failure window. Model hard ceiling is 128K (`OPUS_47_MODEL_MAX_TOKENS`);
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
  ├─ registerProviderIfConfigured()     ← unified provider, static catalog, synchronous
  ├─ discoverAndRegister()              ← async, fire-and-forget
  ├─ registerMessageRenderer()          ← gateway provider renderer
  ├─ registerCommand("sf-llm-gateway-internal")
  ├─ on("session_start")               → re-discover, sync defaults
  ├─ on("turn_end")                    → update footer status
  ├─ on("model_select")                → set thinking to xhigh (gateway provider)
  ├─ on("after_provider_response")     → record throttle/upstream signal (gateway provider)
  └─ on("session_shutdown")            → clear footer status + provider signal
```

## Connecting

The `/sf-llm-gateway` panel is the single primary entry point for credential
entry (see [ADR 0007](../../docs/adr/0007-single-place-credentials.md)). Run
it, pick **Connect / configure credentials**, and enter the gateway base URL
and API key. The panel writes the saved config to disk and registers the
provider — no separate `/login` step required.

```text
/sf-llm-gateway   →   Connect / configure credentials   →   enter URL + key   →   register provider
```

Adjacent **Connect** group rows make the rest of the onboarding self-service:

- **Open token page in browser** — launches the configured gateway root in
  your browser so you can sign in and copy a token without leaving pi.
- **Import from Claude Code** — pulls a cleansed URL+token from your local
  Claude Code settings into the gateway saved config.
- **Show gateway root link** — prints the stable gateway root URL, useful
  when copy-pasting into a different machine.

## Configuration

Configuration follows a three-tier cascade:

```
saved config  →  env var fallback  →  built-in default/missing
```

- **Base URL**: saved > `SF_LLM_GATEWAY_INTERNAL_BASE_URL` > built-in default
- **API key**: saved > `SF_LLM_GATEWAY_INTERNAL_API_KEY` > missing
- **Saved config**: `~/.pi/agent/sf-llm-gateway-internal.json` (global),
  `.pi/sf-llm-gateway-internal.json` (project)
- **Scoped model mode**: saved config can keep gateway scope **additive**
  (prepend `sf-llm-gateway-internal/*`) or **exclusive**
  (replace scoped models with only gateway models and restore the prior scope on disable)

Project-scoped saved config overrides global. Env vars are intentionally only a
fallback for CI/automation when no saved config exists, so stale shell exports
cannot shadow a freshly pasted key.

### Advanced / automation

The panel writes the same files that env vars and direct edits would touch,
so these alternative paths still work for power users and CI:

- **Env vars**: `SF_LLM_GATEWAY_INTERNAL_BASE_URL` + `SF_LLM_GATEWAY_INTERNAL_API_KEY`
  for shell-driven automation.
- **Direct edit**: `~/.pi/agent/sf-llm-gateway-internal.json` (global) or
  `<project>/.pi/sf-llm-gateway-internal.json` (project).

The `/login sf-llm-gateway-internal` flow was retired as a recommended onboarding
path in v0.56.0 — use the panel instead. The provider id stays the same so
pi's auth resolution and model routing continue to work.

Configure the base URL as your organization's gateway **root URL**, for
example `https://your-internal-gateway.example.com`. If a user pastes a known
route suffix such as `/bedrock`, `/v1`, or `/bedrock/v1`, the config layer
canonicalizes it back to the root. Runtime endpoint helpers then derive the
correct routes: OpenAI-compatible chat/model discovery uses the gateway's `/v1`
route, Anthropic Messages uses the gateway root because the SDK appends
`/v1/messages`, and admin calls such as `/user/info` use the gateway root.

## Zero-cost gateway billing

All models report `cost: 0` because the gateway is pre-paid. Billing is tracked
separately via the monthly usage endpoint (`/user/info`).

## Command Surface

`/sf-llm-gateway` with no args opens the status & controls panel. The first
group, **Connect**, exposes the full onboarding flow — enter URL+key, open
the token page in a browser, or import from Claude Code. Subsequent groups
cover post-connect tweaks (`on`, `off`, `set-default`), discovery and
diagnostics, utilities, and reference output.

The legacy `/sf-llm-gateway-internal` slash command was retired in v0.56.0
(see ADR 0007). Users land on `/sf-llm-gateway` as the single entry point.
The provider id is unchanged so pi-native model routing and `/login`
resolution still work.

The grouped panel extends the same Pi-native `ctx.ui.custom()` + `DynamicBorder`
pattern used by `/sf-lsp`: compact status at the top, grouped actions in the
middle, and a full-width description for the selected action so long help text is
not clipped by a two-column list. Actions launched from the panel return to the
panel after they complete, so users can run doctor, models, refresh, and
follow-up setup without retyping the command. In headless/print/RPC mode, the
no-args command falls back to the text status report.

Primary actions are grouped as:

| Group                   | Actions                                               | Purpose                                                                                                         |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Connect                 | `setup`, `import-claude`, `open-token`, `onboard`     | Single onboarding surface: enter credentials, import from Claude Code, open the token page, copy the root link. |
| Setup                   | `on`, `off`, `set-default`                            | Post-connect tweaks: enable/disable gateway routing, control gateway defaults.                                  |
| Discovery & diagnostics | `refresh`, `models`, `doctor`, `usage-probe`, `debug` | Re-probe model discovery, health, usage scope, and transformed upstream payloads.                               |
| Utilities               | `tokens`, `beta`                                      | Count prompt tokens/cost and manage runtime beta headers.                                                       |
| Reference               | `status`, `help`                                      | Print complete text reports for copying or headless use.                                                        |

Slash completions use the same command metadata as the panel, so subcommands
such as `tokens`, `onboard`, `open-token`, `import-claude`, `doctor`, `debug`,
and `usage-probe` show short self-explanatory descriptions while typing.

## Behavior Matrix

| Event/Trigger             | Condition                             | Result                                                                |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| Extension load            | enabled + has credentials             | Register unified provider (static catalog), fire-and-forget discovery |
| Extension load            | disabled                              | Unregister provider                                                   |
| session_start             | —                                     | Re-discover models, sync session defaults                             |
| turn_end                  | model is on gateway provider          | Update footer (context + monthly usage)                               |
| turn_end                  | model is not on gateway provider      | Clear footer status                                                   |
| model_select              | selected model is on gateway provider | Set thinking to xhigh                                                 |
| after_provider_response   | gateway model + 2xx/3xx               | Clear any live throttle/upstream badge                                |
| after_provider_response   | gateway model + 429                   | Record throttle signal, footer shows ⚠ badge for 60s                  |
| after_provider_response   | gateway model + >=500                 | Record upstream signal, footer shows ⚠ badge for 60s                  |
| session_shutdown          | —                                     | Clear footer status + provider signal                                 |
| /command (no args)        | interactive UI                        | Open status & controls panel                                          |
| /command (no args)        | no UI                                 | Print text status report                                              |
| /command on               | missing credentials                   | Prompt for credentials first                                          |
| /command on               | credentials present                   | Save config, set default gateway model, register, discover            |
| /command off              | additive scope                        | Disable, remove gateway pattern, switch to off-default                |
| /command off              | exclusive scope                       | Disable, restore previous scoped models, switch to off-default        |
| /command refresh          | —                                     | Re-discover, refresh monthly usage                                    |
| /command usage-probe      | —                                     | Force a read-only usage probe and classify key/user spend scope       |
| /command beta \<name\> on | —                                     | Toggle beta, re-register provider                                     |
| Monthly usage fetch       | cached < 60 s old                     | Use cache                                                             |
| Monthly usage fetch       | stale or forced                       | Fetch from gateway /user/info                                         |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-llm-gateway-internal/
  lib/
    models-internal/
      fetchers.ts           ← implementation module
      presets.ts            ← implementation module
    transport-internal/
      anthropic.ts          ← implementation module
      openai-chat.ts        ← implementation module
      openai-responses.ts   ← implementation module
      payloads.ts           ← implementation module
      shared.ts             ← implementation module
    beta-controls.ts        ← implementation module
    claude-code-import.ts   ← implementation module
    command-panel.ts        ← implementation module
    command-surface.ts      ← implementation module
    config-panel.ts         ← implementation module
    config.ts               ← implementation module
    debug.ts                ← implementation module
    discovery.ts            ← implementation module
    doctor.ts               ← implementation module
    gateway-url.ts          ← implementation module
    migrate-unify-provider.ts← implementation module
    models.ts               ← implementation module
    monthly-usage.ts        ← implementation module
    onboarding.ts           ← implementation module
    open-url.ts             ← implementation module
    pi-settings.ts          ← implementation module
    provider-telemetry.ts   ← implementation module
    retry-telemetry.ts      ← implementation module
    setup-overlay.ts        ← implementation module
    status.ts               ← implementation module
    token-counter.ts        ← implementation module
    transport.ts            ← implementation module
    wire-trace.ts           ← implementation module
  tests/
    betas.test.ts           ← unit / smoke test
    claude-code-import.test.ts← unit / smoke test
    codex-regression.test.ts← unit / smoke test
    command-panel.test.ts   ← unit / smoke test
    command-parsing.test.ts ← unit / smoke test
    command-surface.test.ts ← unit / smoke test
    config-panel-paste.test.ts← unit / smoke test
    config.test.ts          ← unit / smoke test
    cwd-migration.test.ts   ← unit / smoke test
    debug.test.ts           ← unit / smoke test
    doctor.test.ts          ← unit / smoke test
    formatting.test.ts      ← unit / smoke test
    gateway-url.test.ts     ← unit / smoke test
    global-config.test.ts   ← unit / smoke test
    gpt55-responses.test.ts ← unit / smoke test
    migrate-unify-provider.test.ts← unit / smoke test
    model-group-drift.test.ts← unit / smoke test
    models.test.ts          ← unit / smoke test
    monthly-usage.test.ts   ← unit / smoke test
    onboarding.test.ts      ← unit / smoke test
    open-url.test.ts        ← unit / smoke test
    opus47-regression.test.ts← unit / smoke test
    provider-telemetry.test.ts← unit / smoke test
    retry-telemetry.test.ts ← unit / smoke test
    robust-retry.test.ts    ← unit / smoke test
    setup-overlay-single-write.test.ts← unit / smoke test
    status.test.ts          ← unit / smoke test
    thinking-level.test.ts  ← unit / smoke test
    token-counter.test.ts   ← unit / smoke test
    transport.test.ts       ← unit / smoke test
    unified-provider.test.ts← unit / smoke test
    wire-trace.test.ts      ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

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

## Doctor: `/sf-llm-gateway-internal doctor`

Run `/sf-llm-gateway-internal doctor` when the gateway appears connected but
requests fail. It is read-only and checks the configured URL, the normalized
OpenAI-compatible route, the Claude/admin root route, API key presence, model
discovery, and gateway health. It interprets common failures such as 401 auth
errors, SSO/browser redirects, and `model=v1` routing mistakes.

## Usage probe: `/sf-llm-gateway-internal usage-probe`

Run `/sf-llm-gateway-internal usage-probe` after key rotation or when usage
numbers look surprising. It forces a read-only `/user/info` + `/key/info` refresh,
reports the live gateway connection classification, shows monthly/user spend and
current-key spend separately, and explicitly explains whether the available data
proves a true lifetime user counter. The welcome splash does not render a Lifetime
Usage line because the currently available gateway endpoints do not prove true
user-lifetime spend.

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
gateway. If it persists, run `/sf-llm-gateway refresh`.

**Gateway fails on startup or tool calls error out immediately:**
Run `/sf-llm-gateway` for first-time onboarding. The setup page lets users paste
the gateway root URL and token, open the browser token-generation page, or import
a cleansed URL/token from local Claude Code settings. Env vars are only a
fallback when saved config is blank. The base URL should be the gateway root, for
example `https://your-internal-gateway.example.com`. If a user pastes a route
with a known suffix such as `/bedrock`, `/v1`, or `/bedrock/v1`, the extension
canonicalizes it back to the gateway root before building OpenAI, Claude, and
admin endpoints. Run `/sf-llm-gateway doctor` for endpoint/key preflight checks,
or `/sf-llm-gateway debug <model>` to inspect the exact upstream payload LiteLLM
would send.

**Claude responses appear to truncate and the agent asks you to type "continue":**
This is the pi-ai OpenAI-compat translator splitting Claude thinking + text
across multiple choices. The fix is already in place — the unified
`streamSimple` dispatcher detects Claude ids and forwards them to the native
Anthropic transport instead of the OpenAI-compat one. If you still see
truncation, confirm the selected model is a Claude id in
`/sf-llm-gateway models`.

**Opus 4.7 returns `api_error: Internal server error` on heavy turns:**
Handled by the transport shim: `max_tokens` now scales by pi reasoning
level (minimal=16K … xhigh=64K) instead of unconditionally flooring at
64K, and transient mid-stream failures retry up to 3 times with
exponential backoff before bubbling. If the retry exhausts, the final
error includes an inline `Tip:` footer with next steps. For deeper
inspection, enable wire tracing (`SF_LLM_GATEWAY_INTERNAL_TRACE=1`).

**gpt-5.5 fails with `Function tools with reasoning_effort are not supported for gpt-5.5 in /v1/chat/completions. Please use /v1/responses instead.`:**
Handled by the transport shim as of this extension version: gpt-5.5
requests no longer carry `reasoning_effort` regardless of what pi's
thinking selector is set to. The model still performs implicit reasoning
(`usage.completion_tokens_details.reasoning_tokens > 0` on non-trivial
prompts). This gateway does not expose `/v1/responses` — probing the route
returns a 302 to an SSO login page — so we cannot pivot transports; the
only viable fix is to omit the field. If you need explicit control over
reasoning depth on a gpt-5 family model, use `gpt-5`, `gpt-5-mini`, or
`gpt-5.2`-series variants, all of which accept `reasoning_effort` + tools
on `/v1/chat/completions`.

**Footer shows `⚠` badge after a 429 or 5xx:**
`provider-telemetry.ts` parses retry-after headers and surfaces a 60s
badge. The next successful 2xx/3xx clears it. If the badge sticks, check
`/sf-llm-gateway status` for the live throttle/upstream signal.

**I set `/thinking` to a different level but subsequent model switches reset it to `xhigh`:**
Fixed: `model_select` no longer silently forces `thinkingLevel: xhigh` on
every switch. `xhigh` is still the default for fresh sessions, but user
overrides stick. If you still see a reset, check your settings for an
explicit default that could be winning.

**Beta headers aren't taking effect:**
Check the active betas with `/sf-llm-gateway beta`. pi-ai merges
the `anthropic-beta` header via `Object.assign`, so the shim always
includes `fine-grained-tool-streaming-2025-05-14` first to guarantee it
isn't silently dropped when you add another beta.

**Monthly-usage footer is stale or missing:**
Usage is cached for 60 seconds and refreshes automatically on every
`turn_end`; run `/sf-llm-gateway refresh` to force a `/user/info`
fetch immediately. If you're using sf-welcome or sf-devbar as
consumers, they read from the shared store in `lib/common/monthly-usage/`
— the gateway must be registered and have succeeded at least once.

**Old and new gateway keys are confusing status or tests:**
Saved pi config wins over `SF_LLM_GATEWAY_INTERNAL_API_KEY`. If both are set
and differ, `/sf-llm-gateway status` and `doctor` warn that the env var is
ignored. If the env key is newer, run `/sf-llm-gateway` to save it; otherwise
remove the stale env var from your shell or Keychain setup. If the gateway
reports multiple keys on the
account, confirm the active masked key in status, verify pi works with the
current key, then prune older unused keys in the gateway UI.
