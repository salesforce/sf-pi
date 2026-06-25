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

1. **Codex** (`streamSfGatewayOpenAI`). Clamps `reasoning_effort` to the
   `low|medium|high` values the gateway's Codex path currently accepts
   (xhigh is silently demoted to `high`). Tool definitions pass through
   unchanged in pi-ai's native Chat Completions
   `{ type: "function", function: {...} }` shape.

   _Historical note:_ an earlier revision flattened Chat Completions tools
   into the Responses-API tool shape because the gateway used to require
   it on `/v1/chat/completions`. The gateway has since been fixed to
   handle the Chat Completions shape correctly, and the flattened shape
   now triggers HTTP 500 (`'NoneType' object is not subscriptable`). The
   `flattenCodexTools` shim was removed in v0.71.x. Live probe evidence
   lives in the `tests/codex-regression.test.ts` suite.

   For non-Codex GPT-5+ models, the strongest auto-injected
   `reasoning_effort` is `max` (was `xhigh` until v0.71.x). The gateway
   tightened its OpenAI reasoning_effort validator to
   `{low,medium,high,max}`; raw `xhigh` returns HTTP 400
   `reasoning_effort=xhigh is not supported for this model`.

   Also: **gpt-5 family Responses routing**. gpt-5, gpt-5-mini, gpt-5.5,
   and versioned non-Codex GPT-5 IDs such as `gpt-5.4-bedrock` and
   `gpt-5.5-bedrock` route through `POST <gateway-root>/responses` instead of
   `/v1/chat/completions`. The chat path rejects gpt-5.5 agentic turns when
   `reasoning_effort` and function tools appear together; the root Responses
   endpoint accepts the tool-shaped request and is the preferred path. Versioned
   Bedrock GPT-5 IDs deliberately omit `service_tier: priority` because that
   tier is rejected for those model groups. A `SF_LLM_GATEWAY_INTERNAL_GPT5_FORCE_CHAT`
   kill switch remains available for emergency rollback.

2. **Anthropic stream errors** (`streamSfGatewayAnthropic`). Uses Pi's
   provider retry budget (`retry.provider.maxRetries`, Gateway default: 3) when
   Anthropic reports a retryable SSE error before any user-visible content is
   emitted, then normalizes raw error envelopes into a concise message that
   preserves the request id.

3. **Opus 4.7+ adaptive thinking** (`streamSfGatewayAnthropic`). pi-ai owns
   the generic adaptive-thinking payload through the model-level
   `compat.forceAdaptiveThinking` flag. The transport is now a single
   unified path for all Claude models:
   - Opus 4.7+ presets set `compat.forceAdaptiveThinking: true`, so pi-ai sends
     `thinking: { type: "adaptive" }` and `output_config.effort`.
   - Opus 4.7+ presets map pi's user-facing `xhigh` thinking level to `max`
     (the gateway now accepts `effort=max` for all Opus 4.7+ models).
   - `max_tokens` is set to 128K by the model preset. Live probes (May 2026)
     confirmed `max_tokens: 128000 + effort: max` works reliably on both
     Opus 4.7 and 4.8 without the earlier intermittent `api_error`.
   - No transport-level payload shaping is needed — pi-ai handles adaptive
     thinking via model compat flags, and the gateway accepts the full
     effort range.

   Older Claude models pass through the same pi-ai Anthropic transport; their
   model compat flags describe whether adaptive thinking is required.

### Gateway-specific model metadata

Some model metadata intentionally differs from Pi's direct-provider defaults
because the gateway route has separately verified limits. In particular,
`gpt-5.5` is advertised as a 1M-context gateway model with 128K max output,
while Codex-family presets stay capped at 272K/128K. Keep larger-than-upstream
metadata behind focused tests so it is clear the value is gateway-specific, not
a stale copy of Pi Runtime model metadata.

## Runtime Flow

```
Extension loads
  ├─ installWireTrace()                 ← opt-in raw gateway trace
  ├─ registerProviderIfConfigured()     ← unified provider, static catalog, synchronous
  ├─ discoverAndRegister()              ← async, fire-and-forget
  ├─ registerMessageRenderer()          ← gateway provider renderer
  ├─ registerCommand("sf-llm-gateway-internal")
  ├─ on("session_start")               → sync defaults (sync), discover (fire-and-forget),
  │                                       one-time key-conflict notify
  ├─ on("turn_end")                    → update footer status; first turn_end also
  │                                       kicks refreshUsageDetails (daily activity, key list)
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
  Claude Code settings into the gateway saved config, saves any detected CA
  bundle candidates, runs doctor, and sets the gateway default only after
  preflight passes.
- **One-shot onboard** — chains Claude Code import + CA candidate discovery →
  register provider → doctor preflight → set default in a single keystroke.
  When the doctor surfaces a TLS-class failure on macOS, the chain hands off to
  **Fix corporate CA**.
- **Fix corporate CA (macOS)** — wires `NODE_EXTRA_CA_CERTS` into both the
  LaunchAgent (Dock/Spotlight launches) and `~/.zshenv` (Terminal launches)
  in one shot. Adopts an existing PEM found in saved candidates, shell exports,
  or bounded Claude Code / DevBar / AI Suite locations such as
  `~/.claude/*.pem`, `~/.devbar/*.pem`, and `~/.aisuite/conf/*.pem`; falls
  back to downloading from saved `caBundleSource` (or
  `SF_LLM_GATEWAY_INTERNAL_CA_BUNDLE_SOURCE`) when the bundle source is
  configured. Public sf-pi ships no default download URL on purpose — the
  source is organization-specific.

Splash-side, when the most recent doctor run flagged a TLS failure on
macOS and no fix has been applied, sf-welcome adds a single muted nudge
row under the gateway status: "`/sf-llm-gateway fix-ca-bundle` — Wire your
corporate CA into Node — LaunchAgent + ~/.zshenv in one shot." The row is
gated by `isSfPiExtensionEnabled("sf-llm-gateway-internal")` so external
users never see it, and the gate reads pre-persisted state — no live
probing on the splash hot path.

## Configuration

Configuration follows a three-tier cascade:

```
saved config  →  env var fallback  →  built-in default/missing
```

- **Base URL**: saved > `SF_LLM_GATEWAY_INTERNAL_BASE_URL` > built-in default
- **API key**: saved > `SF_LLM_GATEWAY_INTERNAL_API_KEY` > missing
- **Help URL**: saved.helpUrl > `SF_LLM_GATEWAY_INTERNAL_HELP_URL` > unset.
  Optional. When set, the doctor appends a trailing `More info: <url>`
  recommendation. Empty in the public repo so no internal help-canvas link
  is committed; internal distributions can wire it via env or saved config.
- **CA bundle download URL**: saved.caBundleSource >
  `SF_LLM_GATEWAY_INTERNAL_CA_BUNDLE_SOURCE` > unset. Used by `fix-ca-bundle`
  when no local PEM is found. Empty default — set this to opt into the
  bootstrap path.
- **CA bundle candidate paths**: saved.caBundleCandidates (string[]).
  Extra absolute paths the `fix-ca-bundle` probe scans before the
  built-in well-known list (`~/.aisuite/conf/*.pem`).
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

`/sf-llm-gateway` with no args opens SF LLM Gateway in the SF Pi Manager. The first
group, **Connect**, exposes the full onboarding flow — enter URL+key, open
the token page in a browser, or import from Claude Code. Subsequent groups
cover post-connect tweaks (`on`, `off`, `set-default`), discovery and
diagnostics, utilities, and reference output.

The legacy `/sf-llm-gateway-internal` slash command was retired in v0.56.0
(see ADR 0007). Users land on `/sf-llm-gateway` as the single entry point.
The provider id is unchanged so pi-native model routing and `/login`
resolution still work.

The Manager detail page preserves the grouped command surface from the legacy panel. Press `S` on the detail page to switch the active Manager scope between global and project; scoped actions render once and run against the selected scope. The primary `setup` action now opens a Manager action page for saved URL/key edits plus save/enable/disable actions; read-only status, help, doctor, and report-style actions use the standard Manager info popup. In headless/print/RPC mode, the no-args command falls back to the text status report.

Primary actions are grouped as:

| Group                   | Actions                                                                | Purpose                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Connect                 | `setup`, `import-claude`, `open-token`, `onboard`                      | Single onboarding surface: enter credentials, import from Claude Code, open the token page, copy the root link. |
| Setup                   | `on`, `off`, `set-default`                                             | Post-connect tweaks: enable/disable gateway routing, control gateway defaults.                                  |
| Discovery & diagnostics | `refresh`, `models`, `doctor`, `usage-probe`, `debug`, `latency-probe` | Re-probe model discovery, health, usage scope, latency, and transformed upstream payloads.                      |
| Utilities               | `tokens`, `beta`                                                       | Count prompt tokens/cost and manage runtime beta headers.                                                       |
| Reference               | `status`, `help`                                                       | Print complete text reports for copying or headless use.                                                        |

Slash completions use the same command metadata as the panel, so subcommands
such as `tokens`, `onboard`, `open-token`, `import-claude`, `doctor`, `debug`,
`latency-probe`, and `usage-probe` show short self-explanatory descriptions while typing.

## Behavior Matrix

| Event/Trigger                | Condition                             | Result                                                                                                                                         |
| ---------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension load               | enabled + has credentials             | Register unified provider (static catalog), fire-and-forget discovery                                                                          |
| Extension load               | disabled                              | Unregister provider                                                                                                                            |
| session_start                | —                                     | Sync session defaults (awaited, local-only); fire-and-forget model discovery; emit one-time key-conflict notify when env and saved keys differ |
| turn_end                     | model is on gateway provider          | Update footer (context + monthly usage); first turn_end also kicks refreshUsageDetails (daily activity, key list)                              |
| turn_end                     | model is not on gateway provider      | Clear footer status                                                                                                                            |
| model_select                 | selected model is on gateway provider | Set thinking to xhigh                                                                                                                          |
| after_provider_response      | gateway model + 2xx/3xx               | Clear any live throttle/upstream badge                                                                                                         |
| after_provider_response      | gateway model + 429                   | Record throttle signal, footer shows ⚠ badge for 60s                                                                                           |
| after_provider_response      | gateway model + >=500                 | Record upstream signal, footer shows ⚠ badge for 60s                                                                                           |
| session_shutdown             | —                                     | Clear footer status + provider signal                                                                                                          |
| /command (no args)           | interactive UI                        | Open the SF Pi Manager detail page                                                                                                             |
| /command (no args)           | no UI                                 | Print text status report                                                                                                                       |
| /command on                  | missing credentials                   | Prompt for credentials first                                                                                                                   |
| /command on                  | credentials present                   | Save config, set default gateway model, register, discover                                                                                     |
| /command off                 | additive scope                        | Disable, remove gateway pattern, switch to off-default                                                                                         |
| /command off                 | exclusive scope                       | Disable, restore previous scoped models, switch to off-default                                                                                 |
| /command refresh             | —                                     | Re-discover, refresh monthly usage                                                                                                             |
| /command usage-probe         | —                                     | Force a read-only usage probe and classify key/user spend scope                                                                                |
| /command latency-probe       | —                                     | Run read-only timing probes for discovery and a tiny streamed generation                                                                       |
| /command usage-probe --trace | —                                     | Render the per-endpoint trace (timings + status) from the last refresh, plus any active key-conflict warning                                   |
| /command beta \<name\> on    | —                                     | Toggle beta, re-register provider                                                                                                              |
| Monthly usage fetch          | cached < 60 s old                     | Use cache                                                                                                                                      |
| Monthly usage fetch          | stale or forced                       | Fetch from gateway /user/info                                                                                                                  |

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
    ca-bundle-fixer-state.ts← implementation module
    ca-bundle-fixer.ts      ← implementation module
    ca-probe-state.ts       ← implementation module
    claude-code-import.ts   ← implementation module
    command-surface.ts      ← implementation module
    config-panel.ts         ← implementation module
    config.ts               ← implementation module
    debug.ts                ← implementation module
    discovery.ts            ← implementation module
    doctor.ts               ← implementation module
    gateway-url.ts          ← implementation module
    latency-probe.ts        ← implementation module
    migrate-unify-provider.ts← implementation module
    models.ts               ← implementation module
    monthly-usage.ts        ← implementation module
    onboard-action.ts       ← implementation module
    onboarding-sources.ts   ← implementation module
    onboarding-state.ts     ← implementation module
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
    ca-bundle-fixer.test.ts ← unit / smoke test
    ca-probe-state.test.ts  ← unit / smoke test
    claude-code-import.test.ts← unit / smoke test
    codex-regression.test.ts← unit / smoke test
    command-parsing.test.ts ← unit / smoke test
    command-surface.test.ts ← unit / smoke test
    compaction-routes-through-gateway.test.ts← unit / smoke test
    config-panel-manager.test.ts← unit / smoke test
    config-panel-paste.test.ts← unit / smoke test
    config.test.ts          ← unit / smoke test
    cwd-migration.test.ts   ← unit / smoke test
    debug.test.ts           ← unit / smoke test
    discovery-cache.test.ts ← unit / smoke test
    doctor-tls-state.test.ts← unit / smoke test
    doctor.test.ts          ← unit / smoke test
    formatting.test.ts      ← unit / smoke test
    gateway-url.test.ts     ← unit / smoke test
    global-config.test.ts   ← unit / smoke test
    gpt55-live-regression.test.ts← unit / smoke test
    gpt55-responses.test.ts ← unit / smoke test
    latency-probe.test.ts   ← unit / smoke test
    lifecycle.test.ts       ← unit / smoke test
    manager-actions.test.ts ← unit / smoke test
    migrate-unify-provider.test.ts← unit / smoke test
    model-group-drift.test.ts← unit / smoke test
    models.test.ts          ← unit / smoke test
    monthly-usage.test.ts   ← unit / smoke test
    onboard-action.test.ts  ← unit / smoke test
    onboarding-sources.test.ts← unit / smoke test
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

## Doctor: `/sf-llm-gateway doctor`

Run `/sf-llm-gateway doctor` when the gateway appears connected but
requests fail. It is read-only and checks the configured URL, the normalized
OpenAI-compatible route, the Claude/admin root route, API key presence, model
discovery, and gateway health. It interprets common failures such as 401 auth
errors, SSO/browser redirects, and `model=v1` routing mistakes.

## Usage probe: `/sf-llm-gateway usage-probe`

Run `/sf-llm-gateway usage-probe` after key rotation or when usage
numbers look surprising. It forces a read-only `/user/info` + `/key/info` refresh,
reports the live gateway connection classification, shows monthly/user spend and
current-key spend separately, and explicitly explains whether the available data
proves a true lifetime user counter. The welcome splash does not render a Lifetime
Usage line because the currently available gateway endpoints do not prove true
user-lifetime spend.

## Debugging: `/sf-llm-gateway debug`

The gateway exposes `POST /utils/transform_request`, which echoes the exact
upstream URL, headers, and body LiteLLM would send for a given request. The
extension wraps that as a first-class command:

```
/sf-llm-gateway debug <modelId> [reasoning=<level>] [tool] [adaptive]
```

Examples:

```text
/sf-llm-gateway debug claude-opus-4-8 adaptive reasoning=xhigh
  → Upstream: https://api.anthropic.com/v1/messages
    Body:     { thinking: { type: "adaptive" }, output_config: { effort: "max" }, max_tokens: 128000, ... }
    Note:     pi `xhigh` maps to `max` for Opus 4.7+.

/sf-llm-gateway debug gpt-5 reasoning=high
  → Body:     { reasoning_effort: "high", allowed_openai_params: ["reasoning_effort"], ... }

/sf-llm-gateway debug gpt-5.3-codex reasoning=medium tool
  → Upstream: https://api.openai.com/v1/responses
    Body:     { reasoning: { effort: "medium", summary: "auto" }, tools: [...], ... }
```

This is the fastest way to verify that the shims are producing a payload shape
the gateway will accept, without burning tokens on a real completion.

## Latency probe: `/sf-llm-gateway latency-probe`

`latency-probe` runs direct gateway timing checks so you can separate provider /
gateway latency from pi's local transport overhead:

```text
/sf-llm-gateway latency-probe [modelId] [--large] [--beta-compare] [--bedrock]
```

Default mode performs metadata probes plus one tiny streamed generation. Claude
and Chat Completions probes use `max_tokens: 1`; Responses probes use
`max_output_tokens: 16` because some GPT-5-family routes reject smaller values
before a latency measurement can be taken. `--large` adds a large filler prompt
and should be used sparingly because it still consumes gateway quota. For Opus
4.7, `--beta-compare` compares no-beta vs `context-1m-2025-08-07`, and
`--bedrock` measures the Bedrock compatibility stream's first chunk.

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

The `/sf-llm-gateway status` report shows a `Wire trace: ON` line
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

**Opus 4.7/4.8 returns `api_error: Internal server error` on heavy turns:**
Transient mid-stream failures use Pi's provider retry budget
(`retry.provider.maxRetries`, Gateway default: 3) with exponential backoff
before bubbling. If the retry exhausts, the final error includes an inline
`Tip:` footer with next steps. For deeper inspection, enable wire tracing
(`SF_LLM_GATEWAY_INTERNAL_TRACE=1`). Note: the earlier instability at
`max_tokens=128000 + effort=max` has been resolved upstream (May 2026);
the transport no longer applies level-scaled output-token floors.

**gpt-5.5 fails with `Function tools with reasoning_effort are not supported for gpt-5.5 in /v1/chat/completions. Please use /v1/responses instead.`:**
Handled by the transport shim as of this extension version: gpt-5.5 and
other gpt-5-family non-Codex models, including versioned Bedrock IDs such as
`gpt-5.4-bedrock` and `gpt-5.5-bedrock`, route through
`POST <gateway-root>/responses` instead of `/v1/chat/completions`. The
Responses path accepts tool-shaped agentic requests and uses the model's
thinking-level map to keep effort values inside the gateway-safe window.
Versioned Bedrock GPT-5 IDs use the upstream default service tier because
`priority` is rejected for those model groups. They also finish the local pi
turn shortly after the last visible output block because their streamed terminal
`response.completed` event can lag behind visible text. If the Responses path is
unavailable, the `SF_LLM_GATEWAY_INTERNAL_GPT5_FORCE_CHAT=1` kill switch forces
the older chat path for emergency rollback.

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
Check the active betas with `/sf-llm-gateway beta`. Opus 4.7 sends no
Anthropic beta headers by default because the gateway now advertises 1M
context natively and live probes accept >200K-token prompts without
`context-1m-2025-08-07`. Older Claude presets that still need model-level
betas include `fine-grained-tool-streaming-2025-05-14` in the same header so
pi-ai's `Object.assign` header merge cannot silently drop it.

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

**Doctor reports `WARN: fetch failed` on macOS even though `curl` works:**
Node on macOS ignores the system keychain. When the gateway sits behind a
corporate CA, every Node fetch fails with a generic `fetch failed` while
`curl` (which uses the keychain) succeeds. The doctor recognizes this
fingerprint and points at `/sf-llm-gateway fix-ca-bundle`, which wires
`NODE_EXTRA_CA_CERTS` into both the LaunchAgent (Dock/Spotlight launches)
and `~/.zshenv` (Terminal launches) in one shot. The fix probes
well-known paths in Claude Code, DevBar, and AI Suite config folders, adopts
valid PEM paths already referenced by `NODE_EXTRA_CA_CERTS` in `~/.zshrc`,
`~/.zprofile`, `~/.zshenv`, or the sf-pi LaunchAgent, and includes any extras
saved under `caBundleCandidates` in the gateway saved config. If `NODE_EXTRA_CA_CERTS` is only
in `~/.zshrc` or `~/.zprofile`, doctor calls that out because pi may not see it
for every launch path; `fix-ca-bundle` mirrors the valid bundle into
`~/.zshenv` and the LaunchAgent. When no candidate is found and
saved `caBundleSource` (or `SF_LLM_GATEWAY_INTERNAL_CA_BUNDLE_SOURCE`)
is set, the action downloads the bundle into
`~/.pi/agent/sf-llm-gateway-internal/ca-bundle.pem` after explicit
confirmation. Each disk-mutating step is HITL-gated; a sentinel-guarded
block in `~/.zshenv` makes re-applies idempotent.

**`/sf-llm-gateway onboard` says `not configured`:**
The one-shot chain stops short when no saved gateway URL+key exists post‑
import. Either run `/sf-llm-gateway setup` to enter them manually, or
run `/sf-llm-gateway open-token` to grab a token from the gateway UI.
The chain also saves detected CA bundle candidates so a later TLS handoff can
adopt an existing bundle instead of requiring a download URL. It halts before
`set-default` when the doctor preflight fails — follow the next-action hint
embedded in the report (TLS → fix-ca-bundle, auth → setup, redirect → fix the
base URL).

**Splash keeps showing the `/sf-llm-gateway fix-ca-bundle` nudge after I
ran the fix:**
The nudge gates on `~/.pi/agent/sf-pi/sf-llm-gateway-internal/ca-bundle-fixer.json`
being populated. The fix-ca-bundle action writes that file on a successful
apply. If the file is missing (e.g. the apply was interrupted or you
rolled it back manually), re-run the action so the splash sees the
applied state. The same row also clears once the next doctor run
persists `failureClass: null` to `ca-probe.json`, which happens
automatically on the deferred `turn_end` refresh.
