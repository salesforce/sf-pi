# sf-llm-gateway-internal — Code Walkthrough

> **Optional gateway provider.** This extension ships with no default endpoint
> or credentials. To use it, run `/login sf-llm-gateway-internal`, or provide
> compatible automation environment variables. If you do not
> use a compatible gateway, disable it with
> `/sf-pi disable sf-llm-gateway-internal`.

This document explains the design and runtime flow of the LLM Gateway provider
extension. Read this before making changes.

## What It Does

Registers one complete Pi Provider and keeps Gateway-specific behavior in
focused adapters. Pi owns credential persistence/logout, provider-scoped model
storage, refresh coordination, and dispatch by real model API tags. SF Pi keeps
endpoint normalization, model inference, transport quirks, retries, diagnostics,
spend, and telemetry.

## Key Architecture: One Complete Provider, Three APIs

The Provider id remains `sf-llm-gateway-internal`, so `/login`, model settings,
and existing defaults remain stable. Models retain their real API tag:

| Model family                 | Registered API       | Gateway-aware adapter            | Request base URL                         |
| ---------------------------- | -------------------- | -------------------------------- | ---------------------------------------- |
| Gemini / Codex / chat routes | `openai-completions` | `streamSfGatewayOpenAI[Full]`    | `<gateway>/v1`                           |
| GPT Responses routes         | `openai-responses`   | `streamSfGatewayResponses[Full]` | `<gateway>`                              |
| Claude                       | `anthropic-messages` | `streamSfGatewayAnthropic[Full]` | `<gateway>` (SDK appends `/v1/messages`) |

Pi's Provider API map performs dispatch; SF Pi no longer strips API tags or
guesses the transport from model ids. Responses-to-Chat fallback remains local
to the Responses adapter. Claude stays on native Anthropic Messages because the
OpenAI-compatible translator can split thinking and text across choices and
occasionally drop the final text delta.

The Provider exposes a synchronous curated baseline. Pi restores and persists a
provider-scoped dynamic overlay through `ModelsStore`; configured endpoints are
materialized only at request time and are not copied into the model cache.
Startup performs no model-discovery network request. `/sf-llm-gateway refresh`
uses Pi's public model-registry refresh seam.

### Authentication

`/login sf-llm-gateway-internal` is the primary setup flow:

1. Pi always shows the non-secret gateway root URL. Press Enter to keep the
   current value or type a replacement.
2. SF Pi collects the API key through the shared fixed-mask
   `lib/common/secure-credential-prompt.ts` component; Pi's visible stock secret
   prompt is never called.
3. The Provider returns a canonical `ApiKeyCredential`. Pi persists the key and
   default URL and owns `/logout` removal.

Project/global saved URLs can override the credential's default URL. Environment
variables remain automation fallbacks. After the v0.235.0-v0.236.0 migration
window, existing global/project `apiKey` fields are detected for guidance but
never used for authentication. SF Pi never copies or silently deletes them.
`remove-legacy-token` removes only that field after the Pi credential passes
doctor checks and the user confirms.

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

1. **Codex** (`streamSfGatewayOpenAI`). Maps Pi's thinking selector to the
   gateway's live-proven `low|medium|high|max` Codex window (`minimal` clamps
   to `low`; `xhigh` and `max` map to `max`). Tool definitions pass through
   unchanged in pi-ai's native Chat Completions
   `{ type: "function", function: {...} }` shape.

   _Historical note:_ an earlier revision flattened Chat Completions tools
   into the Responses-API tool shape because one gateway route used to require
   it on `/v1/chat/completions`. The gateway has since been fixed to handle the
   Chat Completions shape correctly, and the flattened shape is no longer used.
   Live probe evidence lives in the `tests/codex-regression.test.ts` suite.

   For GPT-family models, the usable reasoning effort window is route-specific.
   Live probes on 2026-07-12 showed Codex accepts wire `max`, `gpt-5.5`
   accepts wire `xhigh` as its strongest tier, and `gpt-5`/`gpt-5-mini` top
   out at `high`. GPT-5.6 non-Bedrock routes accept wire `max`; GPT-5.6
   Bedrock routes clamp low-end selectors upward but still expose `max`. SF Pi
   exposes Pi `max` only when it can map to the strongest live-proven wire
   value for that route.

   Also: **gpt-5 family Responses routing**. GPT-5-family non-Codex models
   route through `POST <gateway-root>/responses` instead of
   `/v1/chat/completions` when that route is required for tool-shaped agentic
   requests. Non-Bedrock GPT-5.6 routes use priority traffic by default;
   Bedrock GPT-5.6 routes omit `service_tier` because `priority` is not valid
   for those routes.

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
   - Opus 4.7+ presets expose pi's user-facing `xhigh` and `max` thinking
     levels as Anthropic `effort=max`. Other gateway models expose `max` only
     after model-specific evidence exists.
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
`gpt-5.5` and non-Bedrock `gpt-5.6` variants are advertised as 1M-context
gateway models with 128K max output, while Codex-family and Bedrock GPT-5.6
presets stay capped at 272K/128K. Keep larger-than-upstream metadata behind
focused tests so it is clear the value is gateway-specific, not a stale copy of
Pi Runtime model metadata.

## Runtime Flow

```
Extension loads
  ├─ installWireTrace()                 ← opt-in, redacted gateway trace
  ├─ registerProvider(completeProvider) ← static baseline + Pi cache restore
  ├─ registerEntryRenderer()            ← human-only headless report renderer
  ├─ registerCommand("sf-llm-gateway")
  ├─ on("session_start")               → bind cwd/UI/model registry; local settings repair
  ├─ on("turn_end")                    → update footer status; first turn_end also
  │                                       kicks refreshUsageDetails (daily activity, key list)
  ├─ on("model_select")                → refresh footer; Pi/user settings retain thinking authority
  ├─ on("after_provider_response")     → record throttle/upstream signal (gateway provider)
  └─ on("session_shutdown")            → cancel auth UI; clear cwd/footer/provider state
```

## Connecting

Use Pi's provider login as the primary connection flow:

```text
/login sf-llm-gateway-internal
  → review URL (Enter keeps the current value)
  → enter API key in SF Pi's masked component
  → Pi persists the credential and refreshes provider models
```

`/sf-llm-gateway setup [global|project]` is now non-secret configuration only:
endpoint overrides, model scope, help URL, and certificate preferences.

Adjacent **Connect** group rows make the rest of the onboarding self-service:

- **Open token page in browser** — launches the configured gateway root in
  your browser so you can sign in and copy a token without leaving pi.
- **Import from Claude Code** — imports a non-secret URL and CA candidates.
  Credential presence can be detected for guidance, but the value is never
  returned or copied; authenticate through `/login`.
- **One-shot onboard** — chains non-secret Claude Code import + CA discovery →
  Pi model refresh → doctor preflight → set default in a single keystroke.
  When the doctor surfaces a TLS-class failure on macOS, the chain hands off to
  **Fix corporate CA**.
- **Fix corporate CA (macOS)** — wires `NODE_EXTRA_CA_CERTS` into both the
  LaunchAgent (Dock/Spotlight launches) and `~/.zshenv` (Terminal launches)
  in one shot. Adopts an existing PEM found in saved candidates, shell exports,
  or bounded Claude Code / DevBar / AI Suite locations such as
  `~/.claude/*.pem`, `~/.devbar/*.pem`, and `~/.aisuite/conf/*.pem`; falls
  back to downloading from saved `caBundleSource` (or
  `SF_LLM_GATEWAY_CA_BUNDLE_SOURCE`) when the bundle source is
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

Request authentication uses these explicit precedence rules:

- **API key**: Pi `ApiKeyCredential` > `SF_LLM_GATEWAY_API_KEY` > legacy env alias > missing. Saved global/project `apiKey` fields are inactive migration remnants.
- **Base URL**: project/global saved non-secret override > URL stored with the Pi credential > `SF_LLM_GATEWAY_BASE_URL` > legacy env alias > missing.
- **Help URL**: saved.helpUrl > `SF_LLM_GATEWAY_HELP_URL` > legacy env alias > unset.
  Optional. When set, the doctor appends a trailing `More info: <url>`
  recommendation. Empty by default; organizations can wire it via env or saved
  config.
- **CA bundle download URL**: saved.caBundleSource >
  `SF_LLM_GATEWAY_CA_BUNDLE_SOURCE` > legacy env alias > unset. Used by
  `fix-ca-bundle` when no local PEM is found. Empty default — set this to opt
  into the bootstrap path.
- **CA bundle candidate paths**: saved.caBundleCandidates (string[]).
  Extra absolute paths the `fix-ca-bundle` probe scans before the
  built-in well-known list (`~/.aisuite/conf/*.pem`).
- **Saved config**: `~/.pi/agent/sf-llm-gateway-internal.json` (global),
  `.pi/sf-llm-gateway-internal.json` (project)
- **Scoped model mode**: saved config can keep gateway scope **additive**
  (prepend `sf-llm-gateway-internal/*`) or **exclusive**
  (replace scoped models with only gateway models and restore the prior scope on disable)

Project-scoped non-secret config overrides global. A Pi-saved credential wins
over stale key environment variables. URL userinfo is rejected so credentials
cannot be embedded in non-secret endpoint configuration.

### Advanced / automation

Environment variables remain available for automation and CI:

- **Env vars**: `SF_LLM_GATEWAY_BASE_URL` + `SF_LLM_GATEWAY_API_KEY`
  for shell-driven automation. Older legacy aliases remain supported for
  existing automation.
  Direct edits of `sf-llm-gateway-internal.json` are supported only for
  non-secret settings. Existing `apiKey` fields are detected only for migration
  guidance and explicit confirmed cleanup; no request, setup, or import path uses,
  creates, copies, or silently removes them.

Configure the base URL as your organization's gateway **root URL**, for
example `https://your-gateway.example.com`. If a user pastes a known route
suffix such as `/v1` or a model-specific route suffix, the config layer
canonicalizes it back to the root. Runtime endpoint helpers then derive the
correct routes: OpenAI-compatible chat/model discovery uses the gateway's `/v1`
route, Anthropic Messages uses the gateway root because the SDK appends
`/v1/messages`, and admin calls such as `/v2/user/info`, `/user/info`, and
`/key/info` use the gateway root.

## Zero-cost gateway billing

All models report `cost: 0` because the gateway is pre-paid. Billing is tracked
separately via user-info endpoints. The footer prefers the lightweight
`/v2/user/info` self-lookup, uses `/key/info` only for key-scoped details, and
falls back to the legacy `/user/info` route for older or v2-denying gateways.

## Command Surface

`/sf-llm-gateway` with no args opens SF LLM Gateway in the SF Pi Manager. The first
group, **Connect**, exposes endpoint setup, native `/login` guidance, open
the token page in a browser, or import from Claude Code. Subsequent groups
cover post-connect tweaks (`on`, `off`, `set-default`), discovery and
diagnostics, utilities, and reference output.

The legacy `/sf-llm-gateway-internal` slash command was retired in v0.56.0
(see ADR 0007). Users land on `/sf-llm-gateway` as the single entry point.
The provider id is unchanged so pi-native model routing and `/login`
resolution still work.

The Manager detail page preserves the grouped command surface. Press `S` to switch global/project scope. The `setup` action edits only non-secret endpoint and model-scope settings; read-only reports use the standard Manager info popup. In headless/print/RPC mode, the no-args command falls back to text status.

Primary actions are grouped as:

| Group                   | Actions                                                                | Purpose                                                                                          |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Connect                 | `setup`, `import-claude`, `open-token`, `onboard`                      | Configure non-secret settings, discover existing setup, and hand credentials to native `/login`. |
| Setup                   | `on`, `off`, `remove-legacy-token`, `set-default`                      | Enable/disable routing, clean up verified legacy fields, and control defaults.                   |
| Discovery & diagnostics | `refresh`, `models`, `doctor`, `usage-probe`, `debug`, `latency-probe` | Re-probe model discovery, health, usage scope, latency, and transformed upstream payloads.       |
| Utilities               | `tokens`                                                               | Count prompt tokens/cost.                                                                        |
| Reference               | `status`, `help`                                                       | Print complete text reports for copying or headless use.                                         |

Slash completions use the same command metadata as the panel, so subcommands
such as `tokens`, `onboard`, `open-token`, `import-claude`, `doctor`, `debug`,
`latency-probe`, and `usage-probe` show short self-explanatory descriptions while typing.

Display-only command reports stay outside model context. TUI uses the existing
information panel, RPC emits notifications, JSON emits state-only custom-entry
events, and print mode writes the report while appending the same model-invisible
entry to the active session.

## Behavior Matrix

| Event/Trigger                | Condition                        | Result                                                                                                                                    |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Extension load               | —                                | Register one complete Provider; synchronously expose baseline and restore Pi's model cache offline                                        |
| session_start                | —                                | Bind cwd/UI/model registry and run local settings repair; no discovery network                                                            |
| turn_end                     | model is on gateway provider     | Update footer (context + monthly usage); first turn_end also kicks refreshUsageDetails (daily activity, key list)                         |
| turn_end                     | model is not on gateway provider | Clear footer status                                                                                                                       |
| model_select                 | any model change                 | Refresh footer; never mutate Pi's active thinking level                                                                                   |
| after_provider_response      | gateway model + 2xx/3xx          | Clear any live throttle/upstream badge                                                                                                    |
| after_provider_response      | gateway model + 429              | Record throttle signal, footer shows ⚠ badge for 60s                                                                                      |
| after_provider_response      | gateway model + >=500            | Record upstream signal, footer shows ⚠ badge for 60s                                                                                      |
| session_shutdown             | —                                | Cancel credential UI and clear cwd/auth/footer/provider state                                                                             |
| /command (no args)           | interactive UI                   | Open the SF Pi Manager detail page                                                                                                        |
| /command (no args)           | no UI                            | Print text status report                                                                                                                  |
| /command on                  | missing credentials              | Configure endpoint if needed and prefill `/login sf-llm-gateway-internal`                                                                 |
| /command on                  | credentials present              | Save non-secret scope/default settings and explicitly refresh Pi models                                                                   |
| /command off                 | additive scope                   | Disable, remove gateway pattern, switch to off-default                                                                                    |
| /command off                 | exclusive scope                  | Disable, restore previous scoped models, switch to off-default                                                                            |
| /command refresh             | —                                | Re-discover, refresh monthly usage                                                                                                        |
| /command usage-probe         | —                                | Force a read-only usage probe and classify key/user spend scope                                                                           |
| /command latency-probe       | —                                | Run read-only timing probes for discovery and a tiny streamed generation                                                                  |
| /command usage-probe --trace | —                                | Render the per-endpoint trace (timings + status) from the last refresh                                                                    |
| Monthly usage fetch          | cached < 60 s old                | Use cache                                                                                                                                 |
| Monthly usage fetch          | stale or forced                  | Fetch gateway `/v2/user/info`; retry with the `/key/info` user id only when required; fallback to legacy `/user/info` for older gateways. |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-llm-gateway-internal/
  lib/
    models-internal/
      discovery-sentinels.ts← implementation module
      fetchers.ts           ← implementation module
      presets.ts            ← implementation module
    transport-internal/
      anthropic.ts          ← implementation module
      openai-chat.ts        ← implementation module
      openai-responses.ts   ← implementation module
      payloads.ts           ← implementation module
      shared.ts             ← implementation module
    ca-bundle-fixer-state.ts← implementation module
    ca-bundle-fixer.ts      ← implementation module
    ca-probe-state.ts       ← implementation module
    claude-code-import.ts   ← implementation module
    command-surface.ts      ← implementation module
    config-panel.ts         ← implementation module
    config.ts               ← implementation module
    debug.ts                ← implementation module
    doctor.ts               ← implementation module
    gateway-url.ts          ← implementation module
    latency-probe.ts        ← implementation module
    legacy-token-migration.ts← implementation module
    migrate-gpt56-default.ts← implementation module
    migrate-unify-provider.ts← implementation module
    model-resolution.ts     ← implementation module
    models.ts               ← implementation module
    monthly-usage.ts        ← implementation module
    onboard-action.ts       ← implementation module
    onboarding-sources.ts   ← implementation module
    onboarding-state.ts     ← implementation module
    onboarding.ts           ← implementation module
    open-url.ts             ← implementation module
    pi-settings.ts          ← implementation module
    provider-auth.ts        ← implementation module
    provider-telemetry.ts   ← implementation module
    provider.ts             ← implementation module
    retry-telemetry.ts      ← implementation module
    setup-overlay.ts        ← implementation module
    stale-usage-refresh.ts  ← implementation module
    status.ts               ← implementation module
    token-counter.ts        ← implementation module
    transport.ts            ← implementation module
    wire-trace.ts           ← implementation module
  tests/
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
    doctor-tls-state.test.ts← unit / smoke test
    doctor.test.ts          ← unit / smoke test
    fetchers.test.ts        ← unit / smoke test
    formatting.test.ts      ← unit / smoke test
    gateway-header-proof-live.test.ts← unit / smoke test
    gateway-url.test.ts     ← unit / smoke test
    global-config.test.ts   ← unit / smoke test
    gpt55-live-regression.test.ts← unit / smoke test
    gpt55-responses.test.ts ← unit / smoke test
    latency-probe.test.ts   ← unit / smoke test
    legacy-token-migration.test.ts← unit / smoke test
    lifecycle.test.ts       ← unit / smoke test
    manager-actions.test.ts ← unit / smoke test
    migrate-gpt56-default.test.ts← unit / smoke test
    migrate-unify-provider.test.ts← unit / smoke test
    model-group-drift.test.ts← unit / smoke test
    model-resolution.test.ts← unit / smoke test
    models.test.ts          ← unit / smoke test
    monthly-usage.test.ts   ← unit / smoke test
    native-provider-live.test.ts← unit / smoke test
    onboard-action.test.ts  ← unit / smoke test
    onboarding-sources.test.ts← unit / smoke test
    onboarding.test.ts      ← unit / smoke test
    open-url.test.ts        ← unit / smoke test
    opus47-regression.test.ts← unit / smoke test
    provider-auth.test.ts   ← unit / smoke test
    provider-telemetry.test.ts← unit / smoke test
    provider.test.ts        ← unit / smoke test
    retry-telemetry.test.ts ← unit / smoke test
    robust-retry.test.ts    ← unit / smoke test
    setup-overlay-single-write.test.ts← unit / smoke test
    stale-usage-refresh.test.ts← unit / smoke test
    status.test.ts          ← unit / smoke test
    thinking-level.test.ts  ← unit / smoke test
    thinking-ownership-runtime.test.ts← unit / smoke test
    token-counter.test.ts   ← unit / smoke test
    transport.test.ts       ← unit / smoke test
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

- `SF_LLM_GATEWAY_BASE_URL`
- `SF_LLM_GATEWAY_API_KEY`

Optional env vars:

- `SF_LLM_GATEWAY_CODEX_TEST_MODEL` — defaults to the current Codex smoke-test model
- `SF_LLM_GATEWAY_CODEX_TEST_TIMEOUT_MS` — request timeout override

Exported helpers are marked with `// Exported for unit tests.` in the source.

## Doctor: `/sf-llm-gateway doctor`

Run `/sf-llm-gateway doctor` when the gateway appears connected but
requests fail. It is read-only and checks the configured URL, the normalized
OpenAI-compatible route, the Claude/admin root route, API key presence, model
discovery, and gateway health. It interprets common failures such as 401 auth
errors, SSO/browser redirects, and `model=v1` routing mistakes.

## Usage probe: `/sf-llm-gateway usage-probe`

Run `/sf-llm-gateway usage-probe` after key rotation or when usage
numbers look surprising. It forces a read-only user-info + `/key/info` refresh,
reports the live gateway connection classification, shows monthly/user spend and
current-key spend separately, and explicitly explains whether the available data
proves a true lifetime user counter. The welcome splash does not render a Lifetime
Usage line because the currently available gateway endpoints do not prove true
user-lifetime spend.

## Debugging: `/sf-llm-gateway debug`

The gateway exposes `POST /utils/transform_request`, which echoes the exact
provider-bound URL, headers, and body the gateway would send for a given
request. The extension wraps that as a first-class command:

```
/sf-llm-gateway debug <modelId> [reasoning=<level>] [tool] [adaptive]
```

Examples:

```text
/sf-llm-gateway debug claude-opus-4-8 adaptive reasoning=max
  → Upstream: https://api.anthropic.com/v1/messages
    Body:     { thinking: { type: "adaptive" }, output_config: { effort: "max" }, max_tokens: 128000, ... }
    Note:     pi `max` is exposed only for gateway models with explicit support.

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
/sf-llm-gateway latency-probe [modelId] [--large]
```

Default mode performs metadata probes plus one tiny streamed generation. Claude
and Chat Completions probes use `max_tokens: 1`; Responses probes use
`max_output_tokens: 16` because some GPT-5-family routes reject smaller values
before a latency measurement can be taken. `--large` adds a large filler prompt
and should be used sparingly because it still consumes gateway quota.

## Debugging: wire trace

When the gateway returns empty or unexpected responses, enable the opt-in
wire trace to capture raw request/response bytes on disk:

```bash
SF_LLM_GATEWAY_TRACE=1 pi
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
finished on this first run. The bootstrap catalog now seeds the curated static
gateway model set synchronously, so this warning should not appear on a
configured gateway. If it persists, run `/sf-llm-gateway refresh`.

**Model discovery only returns `no-default-models`:**
Some LiteLLM configurations use `no-default-models` as an access-control
sentinel rather than a callable model id. The extension filters that sentinel
from `/v1/models` and falls back to the static bootstrap catalog when the
sentinel is the only returned entry. Verify the gateway with
`/sf-llm-gateway latency-probe <modelId>` or `/sf-llm-gateway debug <modelId>`;
those commands exercise the inference routes instead of relying only on model
listing metadata.

**Gateway fails on startup or tool calls error out immediately:**
Run `/login sf-llm-gateway-internal` for first-time onboarding. Login collects
a missing non-secret root URL and then opens SF Pi's masked API-key component.
`/sf-llm-gateway setup` edits only non-secret project/global overrides; Claude
Code import never copies credentials. Environment variables remain automation
fallbacks. The base URL should be the gateway root, for
example `https://your-gateway.example.com`. If a user pastes a route with a
known suffix such as `/v1` or a model-specific route suffix, the extension
canonicalizes it back to the gateway root before building OpenAI, Claude, and
admin endpoints. Run `/sf-llm-gateway doctor` for endpoint/key preflight checks,
or `/sf-llm-gateway debug <model>` to inspect the exact provider-bound payload
the gateway would send.

**Claude responses appear to truncate and the agent asks you to type "continue":**
This is the OpenAI-compatible translator splitting Claude thinking + text
across multiple choices. The fix is already in place — Claude models retain the
`anthropic-messages` API tag, and Pi's complete Provider API map dispatches them
to the Gateway-aware Anthropic adapter. If you still see
truncation, confirm the selected model is a Claude id in
`/sf-llm-gateway models`.

**Opus 4.7/4.8 returns `api_error: Internal server error` on heavy turns:**
Transient mid-stream failures use Pi's provider retry budget
(`retry.provider.maxRetries`, Gateway default: 3) with exponential backoff
before bubbling. If the retry exhausts, the final error includes an inline
`Tip:` footer with next steps. For deeper inspection, enable wire tracing
(`SF_LLM_GATEWAY_TRACE=1`). Note: the earlier instability at
`max_tokens=128000 + effort=max` has been resolved upstream (May 2026);
the transport no longer applies level-scaled output-token floors.

**GPT-5-family models fail with a message asking to use `/v1/responses`:**
Handled by the transport shim as of this extension version: GPT-5-family
non-Codex models route through `POST <gateway-root>/responses` instead of
`/v1/chat/completions` when the Responses path is required for tool-shaped
agentic requests. The Responses path accepts tool-shaped requests and uses the
model's thinking-level map to keep effort values inside the gateway-safe window.
Non-Bedrock GPT-5.6 routes use `service_tier: "priority"`; Bedrock GPT-5.6
routes omit the service tier because `priority` is not valid for those routes.

**Footer shows `⚠` badge after a 429 or 5xx:**
`provider-telemetry.ts` parses retry-after headers and surfaces a 60s
badge. The next successful 2xx/3xx clears it. If the badge sticks, check
`/sf-llm-gateway status` for the live throttle/upstream signal.

**I set `/thinking` to a different level but subsequent model switches reset it:**
SF Pi never selects or persists a Gateway thinking level. Gateway model metadata
only advertises proven capabilities such as `max`; Pi inherits and clamps the
active user/settings choice when models change. Check Pi's `/thinking` selection
and `defaultThinkingLevel` setting if an unexpected level remains active.

**Monthly-usage footer is stale or missing:**
Usage is cached for 60 seconds and refreshes automatically on every
`turn_end`; run `/sf-llm-gateway refresh` to force a usage probe
immediately. The extension first tries the lightweight `/v2/user/info`
self-lookup. If a gateway requires an explicit user id, it derives the
current id from `/key/info` and retries `/v2/user/info?user_id=...`; if v2
is unavailable, it falls back to legacy `/user/info`. If you're using
sf-welcome or sf-devbar as consumers, they read from the shared store in
`lib/common/monthly-usage/` — the gateway must be registered and have
succeeded at least once.

**Old and new gateway keys are confusing status or tests:**
Saved pi config wins over `SF_LLM_GATEWAY_API_KEY`. If both are set
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
saved `caBundleSource` (or `SF_LLM_GATEWAY_CA_BUNDLE_SOURCE`)
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
