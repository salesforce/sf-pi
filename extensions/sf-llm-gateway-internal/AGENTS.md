# AGENTS.md — sf-llm-gateway-internal

Agent rules for editing this extension. Read this before any change.
Repo-level rules still apply; see root `AGENTS.md`.

> ⚠️ **No bundled endpoint.** Do not introduce private hostnames, keys, or
> other confidential endpoints into source. See root `ROADMAP.md` non-goals.

## Read first

1. `extensions/sf-llm-gateway-internal/README.md` — unified-provider architecture + two-transport routing
2. `extensions/sf-llm-gateway-internal/index.ts` header comment — configuration + behavior matrix
3. `extensions/sf-llm-gateway-internal/lib/config.ts` — env vars, constants, saved-config schema
4. `extensions/sf-llm-gateway-internal/lib/models.ts` — model presets and family inference

## File map (what lives where)

| Responsibility                                 | File                              |
| ---------------------------------------------- | --------------------------------- |
| Extension entry, lifecycle, command dispatch   | `index.ts`                        |
| Env vars, constants, saved-config I/O          | `lib/config.ts`                   |
| Gateway URL normalization                      | `lib/gateway-url.ts`              |
| Model presets + family inference               | `lib/models.ts`                   |
| Complete Provider + model discovery            | `lib/provider.ts`                 |
| Provider auth + session context                | `lib/provider-auth.ts`            |
| Masked API-key input                           | `lib/secure-credential-prompt.ts` |
| HTTP transport (OpenAI-compat + Anthropic)     | `lib/transport.ts`                |
| Monthly usage / key info / health fetcher      | `lib/monthly-usage.ts`            |
| Pi settings mutation (defaults, enabledModels) | `lib/pi-settings.ts`              |
| Legacy provider-id settings migration          | `lib/migrate-unify-provider.ts`   |
| GPT-5.6 default settings migration             | `lib/migrate-gpt56-default.ts`    |
| Footer + status report formatting              | `lib/status.ts`                   |
| Standard command metadata + completions        | `lib/command-surface.ts`          |
| Standalone slash-command setup overlay         | `lib/setup-overlay.ts`            |
| Manager settings/setup action panel content    | `lib/config-panel.ts`             |
| Transform debug probe                          | `lib/debug.ts`                    |
| `/sf-llm-gateway doctor` diagnostics           | `lib/doctor.ts`                   |
| `/sf-llm-gateway tokens` counter               | `lib/token-counter.ts`            |
| `/sf-llm-gateway onboard` SSO link             | `lib/onboarding.ts`               |
| Existing setup discovery (Claude/DevBar/CA)    | `lib/onboarding-sources.ts`       |
| Provider-telemetry (429/5xx footer badge)      | `lib/provider-telemetry.ts`       |
| Transparent inner-stream retry telemetry       | `lib/retry-telemetry.ts`          |
| Wire-level request/response tracing            | `lib/wire-trace.ts`               |

## Cross-extension contracts

- Monthly usage state lives in the shared store at
  `lib/common/monthly-usage/store.ts`. On `session_start` this extension
  registers the refresher via `registerGatewayMonthlyUsageRefresher()`.
  **Do not** have sf-welcome or sf-devbar import from this extension
  directly — both read the shared store.

## Conventions

1. **One complete Provider, three real APIs.** The extension registers one
   `sf-llm-gateway-internal` Pi Provider. Models retain their real
   `anthropic-messages`, `openai-completions`, or `openai-responses` API tag;
   Pi's Provider API map dispatches to the matching Gateway-aware full/simple
   adapter. Request-time auth materializes root versus `/v1` endpoints.
   The retired `sf-llm-gateway-internal-anthropic` id is only referenced
   from `lib/migrate-unify-provider.ts` (one-shot settings migration) and
   from `lib/pi-settings.ts` (legacy-pattern normalization).
   Do not re-introduce it as a real registration or add an ID-based dispatcher.
2. **Static baseline plus Pi-owned overlay.** The Provider exposes a bootstrap
   catalog synchronously. Pi restores/persists the dynamic overlay through its
   provider-scoped ModelsStore. Startup is network-free; refresh is explicit.
3. **Pi owns credentials.** `/login` stores the API key and default URL in
   Pi's credential store. SF Pi's custom component masks key input; project
   config may override only non-secret settings. Legacy config tokens are
   read-only during the bounded migration window.
4. **Keep thinking capability-only.** Gateway model metadata may expose
   live-proven levels such as `max`, but SF Pi must never call
   `pi.setThinkingLevel()` or write `defaultThinkingLevel`. Pi/user settings
   own the active level. Preserve user-owned `enabledModels` behavior as well.
5. **Settings mutations go through `lib/pi-settings.ts`.** Don't write
   JSON from ad-hoc call sites. The helpers handle global vs project
   scope, additive vs exclusive mode, and legacy-entry migration.

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
- `tests/models.test.ts` — family inference / new presets
- `tests/robust-retry.test.ts` — Anthropic early-stream retry behavior
- `tests/codex-regression.test.ts` — gated live test; runs only when
  `SF_LLM_GATEWAY_*` env vars are present (legacy internal aliases still work)

## Non-goals

- No default base URL in source. Base URL ships empty; users should provide
  one via the setup wizard. `SF_LLM_GATEWAY_BASE_URL` remains an automation
  fallback when saved config is blank; legacy aliases continue to work.
- No secret materials in source, config, or tests.
- No OpenAI-compat path for Claude — it has known truncation issues,
  documented in the README's "Key Architecture" section.
