---
id: "0153"
status: accepted
date: 2026-11-03
---

# ADR 0153: SF Fin uses a Pi-owned token and the installed Fin CLI

SF Fin connects SF Pi to a Fin (formerly Intercom) workspace. Fin exposes two programmatic surfaces with different authentication: a remote MCP server that supports OAuth with dynamic client registration and refresh tokens, and a CLI (`@intercom/cli`) that accepts only a pasted workspace access token and has no refresh.

SF Fin owns only the CLI credential. Interactive `/login sf-fin` asks for the workspace hosting region (US, EU, or AU) with a select prompt, then collects the personal API token through SF Pi's shared fixed-mask credential input (ADR 0087). Pi alone persists the API-key credential under provider id `sf-fin`, with the region in `credential.env.INTERCOM_REGION`, and `/logout sf-fin` owns removal (ADR 0078). `INTERCOM_TOKEN` and `INTERCOM_REGION` remain non-persisted automation fallbacks.

SF Fin runs the user's installed CLI rather than bundling it or calling its endpoints directly, following the CLI-first boundary of ADR 0020. The CLI's build endpoints are versioned as unstable, and its native keyring dependency should not enter the SF Pi runtime. Each run uses `spawn` without a shell and enforces a timeout and output cap. The child receives an allowlisted environment containing the token and region, never argv. `INTERCOM_CONFIG_DIR` points at an SF Pi-private directory, so the user's own CLI keychain entry and `~/.intercom` files are never read or written. Output is scrubbed of the token, and outcomes map from the CLI's documented exit codes. The status file holds only non-secret workspace identity.

The first version exposes only `status` and a read-only `doctor` (`intercom --version`, `intercom me`). The CLI automatically calls `POST /fin-sdk/enable` when a Fin SDK request is refused as not enabled, so any `fin …` command is treated as potentially mutating and must be Guardrail-mediated before it is exposed.

The Fin MCP server is out of scope for SF Fin. It will be added as an SF MCP preset so that Pi's native MCP runtime owns its OAuth consent, token storage, and refresh (ADR 0137, ADR 0145).

## Addendum: install, doctor, and debug lifecycle

SF Fin manages the Fin CLI with global npm only. `/sf-fin install` and the Manager install page plan, confirm in the TUI, then run exactly `npm install -g @intercom/cli@<exact version> --no-audit --no-fund --loglevel=error`, and verify the installed version. Planning resolves the newest version allowed by npm's `before` / `min-release-age` policy. It refuses versions below the supported minimum, refuses CLIs that global npm did not install, and never uses `sudo` or `@latest`. An `EACCES` failure returns user-owned-prefix guidance without retrying.

The agent may install through `sf_fin action='install'`. Without `allow_mutation` the action returns the plan. With `allow_mutation=true`, SF Guardrail classifies the call as the native mutation `native-sf-fin-cli-install` in a new Power Tool Mode family, `fin` ("Fin CLI install"), with a version-bound fingerprint and no Salesforce org. Following ADR 0074, `allow_mutation` is an Execution Intent Flag rather than approval. The default posture asks for human approval. Power Tool Mode auto-approves the install when it is set to all confirm-class decisions, or to native tools with the `fin` family selected. Because no org is involved, the separate production/unknown-org opt-in does not apply. Hard blocks still apply.

The live doctor reports Node, CLI presence and source, CLI version freshness against the npm registry, credential source and region, workspace identity, and whether a separate personal CLI login exists. SF Fin registers a cached-only provider with `/sf-pi doctor` that makes no network or credentialed call. There is no startup reminder.

`/sf-fin debug` returns a redacted support bundle containing versions, paths, the names (never values) of set `INTERCOM_*` variables, the credential source, the private config directory state, and the last redacted CLI error. `debug on` arms the next one to five live doctor runs to add the CLI's own `--verbose` flag. Traces are scrubbed of the token, `Authorization`, `Cookie`, and bearer/basic values, written as `0600` files with a ten-file retention, and disarmed automatically after use. Only the file path reaches the model.

## Addendum: Fin SDK enabled by default on first use

Fin-as-code CLI commands (`intercom fin …`) call the Fin SDK endpoints. On a workspace without the SDK, those endpoints return `403 fin_sdk_not_enabled`, and the CLI responds by silently calling `POST /fin-sdk/enable` and retrying. SF Fin keeps the default — using SF Fin's SDK actions enables the SDK — but makes it explicit and observable.

`sf_fin action='sdk'` (`/sf-fin sdk manifest|download`) first probes `GET /fin-sdk/manifest` directly, without retry. When the probe reports `not_enabled`, SF Fin performs the single `POST /fin-sdk/enable`, verifies it with a second probe, and records the result in a shared credential-free state file (`lib/common/fin-sdk-state.ts`, holding state, app id, and timestamps). Only then does it run the CLI, so the CLI's silent auto-enable path can never fire. If enabling fails, the CLI is not run.

SF Guardrail reads that shared state. An `sf_fin sdk` call on a workspace not recorded as enabled is the native mutation `native-sf-fin-sdk-enable` (family `fin sdk enable`, Power Tool family `fin`, no Salesforce org). Once the workspace is recorded as enabled, SDK reads are prompt-free. `download` writes the ZIP and its extraction under the owner-only per-workspace directory `<globalAgentDir>/sf-pi/sf-fin/sdk/<app id>/`. Doctor and `me` remain free of SDK calls.
