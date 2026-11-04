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

## Addendum: procedure draft lifecycle

`sf_fin action='sdk'` adds `validate`, `upload`, `upload_simulations`, and `simulate`:

- **`validate`** is local. It parses the YAML and checks it against the workspace's downloaded `.fin/schema/procedure.json` using TypeBox, which validates raw JSON Schema, so SF Fin adds no validator dependency. It also enforces SF Fin draft rules: no `state`, and a `version` when editing an existing procedure.
- **`upload`** validates first, then runs `intercom fin procedures upload`. It never sets `state`, so an upload cannot publish; publishing remains a separate explicit step. SF Fin verifies the round-trip semantically rather than with the CLI's raw `--verify`. Fin canonicalizes on save:
  - it drops redundant `type:` keys and the default `condition_type: natural_language`;
  - it collapses one-element `then` / `else` lists;
  - it rewrites `{ type: escalate, escalate: reason }` as `reason <escalate />`;
  - it re-chomps block scalars and adds server fields.

  Comparing raw fields would therefore report false drift. `procedure-normalize.ts` normalizes both documents to that canonical form, so only real changes surface.

- **`upload_simulations`** uploads a `simulation_set` (`type`, `procedure_id`, `tests[]`) through `intercom fin simulations upload`. Uploads are additive: a test with an `id` updates that test, a test without one is added, and nothing is deleted, so SF Fin warns about duplicate names. The public Fin CLI rejects single `simulation_test` resources. Each test is checked against the workspace `simulation.json`, plus rules observed from the live API: attribute assertions on `temporary.*` are rejected, and a default escalation is asserted with `escalated_to: DEFAULT`.
- **`simulate`** optionally generates tests, then waits a bounded number of polls for them to appear, because generation completes asynchronously and can produce none. It then runs the tests, polls each result a bounded number of times, and summarizes `assertions_results`, including the evaluator's reasoning for each failed assertion.

SF Guardrail classifies `upload`, `upload_simulations`, and `simulate` as `native-sf-fin-procedure-write` (family `fin procedure write`, Power Tool family `fin`, no Salesforce org); `validate` is prompt-free. ### Publish and pause

Live testing showed that Fin's simulator runs only **live** procedures. A draft runs without its instructions: Fin reports no procedure steps and falls back to help-center search. Testing a procedure therefore requires publishing it, so SF Fin adds `sdk publish` and `sdk pause` instead of leaving a gap that would push agents to the raw CLI.

- The action plans by default. It reads the current state and reports the transition. `allow_mutation=true` executes `intercom fin procedures publish|pause`, then verifies the state Fin reports and fails closed on a mismatch. Already-in-state calls are no-ops, and pausing a draft is refused. Fin never moves a procedure back to `draft`; `paused` is the only way to take it offline.
- SF Guardrail classifies execution as `native-sf-fin-procedure-state` (family `fin procedure state`, Power Tool family `fin`). It is an exact approval and is never session-approved, because publishing changes customer-facing behavior.
- `sdk simulate` reads the procedure state first and warns when the procedure is a draft.
- `sdk upload` still never sets `state`, so editing a procedure keeps its current state.

Procedure version history (`/fin-sdk/procedures/{id}/versions`) is gated by a separate Fin feature even after the SDK is enabled, and the CLI's `procedures versions` command would try its silent auto-enable on that 403. SF Fin therefore reads version history only through a direct request and reports the separate gate.

## Addendum: surfaces, guidance, data connectors, and the Fin Agent API harness

- **`sf_fin action='surfaces'`** answers "CLI or MCP?" from evidence instead of a hand-maintained table:
  - It crawls the installed CLI's `--help` tree locally, with no token or network.
  - It reads SF MCP's reviewed Intercom tool contract, the same one the preset uses.
  - It maps every CLI command and MCP tool to a capability, together with the surface SF Fin uses for it.
  - Unmapped or vanished commands and tools fail the action, so a CLI or MCP change can't add surface unnoticed.
- **Guidance** has only `live` and `paused`, and live guidance changes every answer at once. Upload therefore always sends `state: paused`. `sdk guidance_state` re-uploads the current guidance with only `state` changed. It plans by default and verifies the state Fin reports. Execution is an exact Guardrail approval with no session grant, using the same rule as procedure publish/pause.
- **Data connectors** upload only as drafts, because Fin publishes them in the web UI. SF Fin requires:
  - an existing numeric id, created first with `sdk create_data_connector`;
  - an `https://` request URL;
  - only inputs the request uses;
  - a `mock_response`.

  All three resource kinds use the CLI's generic `/fin-sdk/upload`, which routes on `type`.

  Verification uses the server-processed copy in the upload response, comparing name, method, URL path, and inputs. The `data-connectors get` endpoint returns only the published version, so a never-published draft reads back as an empty `Untitled` connector and can't be used to check the save. Fin also rewrites `<read attr='x' />` to `<read attr="input.x" />` on save, so the URL comparison ignores the query string.

- **The Fin Agent API** is granted per workspace on request and uses its own workspace key. The personal token is rejected with `forbidden`. SF Fin stores the key as a second Pi-owned provider (`/login sf-fin-agent`) and sends it only as an HTTPS `Authorization` header. Replies arrive by webhook, so the harness uses the Fin Agent API MCP server's `get_fin_response` instead of hosting a receiver:
  - `access` probes `tools/list` and reports when access isn't granted, when the wrong key was sent, or when the key was rejected;
  - `run` drives a scripted conversation with bounded polls and turns;
  - `run` is classified `native-sf-fin-agent-run`, because a resolved conversation is a billable outcome.

## Addendum: Fin Agent API key safety

The Fin Agent API key follows the same rules as the personal token: a masked Pi-native login, Pi as the only store, an environment fallback (`FIN_AGENT_API_KEY`), and status-only detection that never returns the value. It adds four rules of its own:

- **Separation.** The key and the personal token have different scopes. The Agent API key has `write_conversations` and `read_write_users` only. They also have different lifecycles. Login therefore rejects a key equal to the saved personal token, and every Agent API request first refuses a key equal to the active personal token from any source. Both checks compare SHA-256 digests in constant time.
- **Shape.** Login trims the pasted key and rejects empty, multi-line, `Bearer`-prefixed, or too-short values before Pi persists anything.
- **Transport.** The key is sent only as an HTTPS `Authorization` header to the region's fixed Fin Agent API host, with `redirect: "error"` and a per-request timeout. It never reaches the CLI, argv, child environments, logs, or tool output, and responses are scrubbed of it.
- **Observability without material.** `agent-api-status.json` (mode `0600`) stores only the last access outcome, time, and tool count. `/sf-pi doctor` (cached only), `/sf-fin status`, and the debug bundle report the source and outcome. Results that point at the wrong credential are errors whose fix is `/login sf-fin-agent`.
