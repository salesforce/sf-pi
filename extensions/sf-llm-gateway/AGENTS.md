# AGENTS.md — sf-llm-gateway

Agent rules for editing this extension. Read this before any change.
Repo-level rules still apply; see root `AGENTS.md`.

> ⚠️ **No bundled endpoint.** Do not introduce private hostnames, keys, or
> other confidential endpoints into source. See root `ROADMAP.md` non-goals.

## Read first

1. `extensions/sf-llm-gateway/index.ts` — registration, lifecycle, and command dispatch
2. `extensions/sf-llm-gateway/lib/config.ts` — env vars, constants, saved-config schema
3. `extensions/sf-llm-gateway/lib/models.ts` — discovery metadata and family inference
4. The specific implementation module and matching focused Behavior Proof

## File map (what lives where)

| Responsibility                                 | File                               |
| ---------------------------------------------- | ---------------------------------- |
| Extension entry, lifecycle, command dispatch   | `index.ts`                         |
| Env vars, constants, saved-config I/O          | `lib/config.ts`                    |
| Gateway URL normalization                      | `lib/gateway-url.ts`               |
| Discovery metadata + family inference          | `lib/models.ts`                    |
| Complete Provider + model discovery            | `lib/provider.ts`                  |
| Provider auth + session context                | `lib/provider-auth.ts`             |
| Masked API-key input                           | `common secure credential prompt`  |
| HTTP transport (OpenAI-compat + Anthropic)     | `lib/transport.ts`                 |
| Monthly usage / key info / health fetcher      | `lib/monthly-usage.ts`             |
| Pi settings mutation (defaults, enabledModels) | `lib/pi-settings.ts`               |
| Footer + status report formatting              | `lib/status.ts`                    |
| Standard command metadata + completions        | `lib/command-surface.ts`           |
| Standalone slash-command setup overlay         | `lib/setup-overlay.ts`             |
| Manager settings/setup action panel content    | `lib/config-panel.ts`              |
| `/sf-llm-gateway doctor` diagnostics           | `lib/doctor.ts`                    |
| `/sf-llm-gateway tokens` counter               | `lib/token-counter.ts`             |
| `/sf-llm-gateway onboard` SSO link             | `lib/onboarding.ts`                |
| Existing setup discovery (Claude/DevBar/CA)    | `lib/onboarding-sources.ts`        |
| Provider-telemetry (429/5xx footer badge)      | `lib/provider-telemetry.ts`        |
| Anthropic terminal error normalization         | `lib/transport-internal/shared.ts` |
| Wire-level request/response tracing            | `lib/wire-trace.ts`                |

The masked input implementation is shared at
`lib/common/secure-credential-prompt.ts`; do not reintroduce an extension-local
copy.

## Cross-extension contracts

- Monthly usage state lives in the shared store at
  `lib/common/monthly-usage/store.ts`. On `session_start` this extension
  registers the refresher via `registerGatewayMonthlyUsageRefresher()`.
  **Do not** have sf-welcome or sf-devbar import from this extension
  directly — both read the shared store.

## Conventions

1. **One complete Provider, three real APIs.** The extension registers one
   `sf-llm-gateway` Pi Provider. Models retain their real
   `anthropic-messages`, `openai-completions`, or `openai-responses` API tag;
   Pi's Provider API map dispatches to the matching provider-neutral full/simple
   adapter. Request-time auth materializes root versus `/v1` endpoints. Do not
   add an ID-based dispatcher.
2. **Dynamic catalog with Pi-owned cache.** The Provider registers with no
   static models. Authenticated discovery supplies callable IDs, and Pi restores
   and persists the last successful catalog through its provider-scoped
   ModelsStore. Exact discovered IDs may inherit portable metadata from Pi's
   public built-in catalog; never copy provider identity, cost, headers, or
   provider-specific compatibility. Startup is network-free; refresh is explicit.
3. **Pi owns credentials.** `/login` stores the API key and default URL in
   Pi's credential store. SF Pi's custom component masks key input; extension
   config contains only non-secret settings. Never copy, print, or delete Pi
   credential material.
4. **Keep thinking capability-only.** Gateway model metadata may expose
   reasoning support, but SF Pi must never infer advanced levels from model IDs,
   call `pi.setThinkingLevel()`, or write `defaultThinkingLevel`. Pi/user settings
   own the active level. Preserve user-owned `enabledModels` behavior as well.
5. **Settings mutations go through `lib/pi-settings.ts`.** Don't write JSON from
   ad-hoc call sites. The helpers handle global vs project scope, additive vs
   exclusive mode, and generic stale-suffix repair.
6. **Runtime connectivity comes from provider auth.** `getGatewayConfig()` is
   the non-secret saved/env configuration view; request, status, usage, token,
   and readiness paths use `authController.resolveRuntimeAuth()` for the
   effective endpoint and credential. Never require both views to contain a URL.
7. **Setup is persistence-only.** Saving endpoint or scope overrides performs no
   discovery, usage probe, enable, disable, or model selection. Keep network and
   lifecycle intent on the existing explicit actions.

## Command handler pattern

All subcommands route through `handleCommand` in `index.ts`:

```
/sf-llm-gateway <sub> [scope]
            ↓
      parseCommandArgs
            ↓
       handleCommand
            ↓
runSetupWizard / handleRefreshCommand / enableGateway / …
```

When adding a subcommand:

1. Add it to the `CommandArgs["subcommand"]` union
2. Update `parseCommandArgs`
3. Add a `handle<Name>Command` function (prefer extracting to `lib/` if
   it's more than ~30 lines of non-wiring logic)
4. Wire it in the `switch` in `handleCommand`
5. Add command metadata to `lib/command-surface.ts` so completions, help,
   and the no-args panel stay aligned
6. If the command should be runnable from the panel, wire it in
   `handlePanelAction`

## Testing

- `tests/command-parsing.test.ts` — every new subcommand needs a parse case
- `tests/config.test.ts` — settings mutations covered by the `apply*` / `restore*` helpers
- `tests/models.test.ts` — family inference / discovered metadata
- `tests/native-retry-lifecycle.test.ts` — exact-Pi agent retry lifecycle behavior
- `tests/anthropic-transport.test.ts` — Gateway error normalization without local retries

## Non-goals

- No default base URL in source. Base URL ships empty; users should provide
  one via the setup wizard. `SF_LLM_GATEWAY_BASE_URL` remains an automation
  fallback when saved config is blank.
- No secret materials in source, config, or tests.
- No exact route aliases, backend placement, traffic-tier policy, or
  model-specific payload mutations in source, tests, or docs.
