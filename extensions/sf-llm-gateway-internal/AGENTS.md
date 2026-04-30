# AGENTS.md — sf-llm-gateway-internal

Agent rules for editing this extension. Read this before any change.
Repo-level rules still apply; see root `AGENTS.md`.

> ⚠️ **Internal-only.** Do not introduce Salesforce-internal hostnames,
> keys, or other confidential endpoints into source. See root `ROADMAP.md`
> non-goals.

## Read first

1. `extensions/sf-llm-gateway-internal/README.md` — architecture + dual-provider design
2. `extensions/sf-llm-gateway-internal/index.ts` header comment — configuration + behavior matrix
3. `extensions/sf-llm-gateway-internal/lib/config.ts` — env vars, constants, saved-config schema
4. `extensions/sf-llm-gateway-internal/lib/models.ts` — model presets, family inference, beta definitions

## File map (what lives where)

| Responsibility                                 | File                        |
| ---------------------------------------------- | --------------------------- |
| Extension entry, lifecycle, command dispatch   | `index.ts`                  |
| Env vars, constants, saved-config I/O          | `lib/config.ts`             |
| Gateway URL normalization                      | `lib/gateway-url.ts`        |
| Model presets + family inference + betas       | `lib/models.ts`             |
| Anthropic beta header runtime controls         | `lib/beta-controls.ts`      |
| Provider registration + model discovery        | `lib/discovery.ts`          |
| HTTP transport (OpenAI-compat + Anthropic)     | `lib/transport.ts`          |
| Monthly usage / key info / health fetcher      | `lib/monthly-usage.ts`      |
| Pi settings mutation (defaults, enabledModels) | `lib/pi-settings.ts`        |
| Footer + status report formatting              | `lib/status.ts`             |
| TUI setup wizard component                     | `lib/setup-overlay.ts`      |
| Config panel (advanced form)                   | `lib/config-panel.ts`       |
| Transform debug probe                          | `lib/debug.ts`              |
| Provider-telemetry (429/5xx footer badge)      | `lib/provider-telemetry.ts` |
| Transparent inner-stream retry telemetry       | `lib/retry-telemetry.ts`    |
| Wire-level request/response tracing            | `lib/wire-trace.ts`         |

## Cross-extension contracts

- Monthly usage state lives in the shared store at
  `lib/common/monthly-usage/store.ts`. On `session_start` this extension
  registers the refresher via `registerGatewayMonthlyUsageRefresher()`.
  **Do not** have sf-welcome or sf-devbar import from this extension
  directly — both read the shared store.

## Conventions

1. **Two providers, one gateway.** Claude goes through
   `sf-llm-gateway-internal-anthropic` (native Anthropic Messages path).
   Everything else uses `sf-llm-gateway-internal` (OpenAI-compat). New
   model families follow the family-inference logic in `lib/models.ts`.
2. **Static catalog first, discovery second.** The factory registers a
   bootstrap catalog synchronously so Pi startup resolves defaults before
   async discovery completes. Don't move registration out of the factory.
3. **Respect user overrides.** Thinking level, betas, enabledModels: the
   user always wins. See the `lastAppliedThinkingLevel` block comment in
   `index.ts` for the exact contract.
4. **Settings mutations go through `lib/pi-settings.ts`.** Don't write
   JSON from ad-hoc call sites. The helpers handle global vs project
   scope, additive vs exclusive mode, and legacy-entry migration.

## Command handler pattern

All subcommands route through `handleCommand` in `index.ts`:

```
/sf-llm-gateway-internal <sub> [scope]
                        ↓
                  parseCommandArgs
                        ↓
                   handleCommand
                        ↓
       handleSetupCommand / handleRefreshCommand / enableGateway / …
```

When adding a subcommand:

1. Add it to the `CommandArgs["subcommand"]` union
2. Update `parseCommandArgs`
3. Add a `handle<Name>Command` function (prefer extracting to `lib/` if
   it's more than ~30 lines of non-wiring logic)
4. Wire it in the `switch` in `handleCommand`
5. Add the completion to `getArgumentCompletions`
6. Update help in `handleHelpCommand`

## Testing

- `tests/command-parsing.test.ts` — every new subcommand needs a parse case
- `tests/config.test.ts` — settings mutations covered by the `apply*` / `restore*` helpers
- `tests/models.test.ts` — family inference / new presets / beta resolution
- `tests/robust-retry.test.ts` — transport-level retry behavior
- `tests/codex-regression.test.ts` — gated live test; runs only when
  `SF_LLM_GATEWAY_INTERNAL_*` env vars are present

## Non-goals

- No default base URL in source. Base URL ships empty; users must provide
  one via `SF_LLM_GATEWAY_INTERNAL_BASE_URL` or the setup wizard.
- No secret materials in source, config, or tests.
- No OpenAI-compat path for Claude — it has known truncation issues,
  documented in the README's "Key Architecture" section.
