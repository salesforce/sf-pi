# SF Fin Agent Guide

Use `sf_fin` to check, install, and debug the Fin (formerly Intercom) workspace connection that SF Fin manages.

## Workflow

1. Call `sf_fin action='status'` first. It reads the cached result and makes no network call.
2. Call `sf_fin action='doctor'` when you need verified workspace identity, install readiness, or the cached status is missing, stale, or failed.
3. For `cli_missing`, `cli_outdated`, or an available update the user wants, call `sf_fin action='install'` without `allow_mutation` to show the plan. Then call it again with `allow_mutation=true`, passing the planned `version`. SF Guardrail asks the user to approve unless Power Tool Mode covers the Fin CLI install family. Rerun `doctor` afterwards.
4. For an unexplained doctor failure, call `sf_fin action='debug'` for the redacted bundle. If the HTTP exchange matters, call `sf_fin action='debug' verbose='on'`, then `doctor` once, and read the trace file path it returns.

## Fin as code

- `sf_fin action='sdk' operation='manifest'` summarizes procedures, workflows, guidance, data connectors, and tasks.
- `sf_fin action='sdk' operation='download'` downloads and extracts all Fin SDK resources (editable `src/`, read-only `.fin/` reference data and JSON schemas, docs, and bundled agent skills). The result lists the extraction path; read the workspace `AGENTS.md` there before editing.
- The first SDK call on a workspace enables the Fin SDK (Guardrail-mediated). Never run `intercom fin …` through `bash`.

### Procedure draft loop

1. Write `procedure.yaml` following the downloaded workspace `AGENTS.md`, `docs/PROCEDURES.md`, and the procedure-generator skill.
2. `sf_fin action='sdk' operation='validate' file=…`, and fix every issue it reports.
3. `operation='upload' file=…`. New files use `id: new`; after the first upload, set `id` and the returned `version` before editing again. Never add `state`. Upload saves a draft only, and the result reports whether the saved copy is semantically identical.
4. Write a `simulation_set` (`type: simulation_set`, `procedure_id`, `tests:` of `type: simulation_test`). Assert on `outcome`, `agent_response`, or `escalated_to` (use `DEFAULT` for the default inbox), never on `temporary.*` attributes. Then `operation='upload_simulations' file=…`.
5. `operation='simulate' procedure_id=…`. Fin simulates **live** procedures only; on a draft, runs ignore the procedure's steps and SF Fin warns. Read each failed assertion's reasoning, fix the procedure or the test, and repeat from step 2.
6. To test or release, `operation='publish' procedure_id=…` returns a plan; ask the user, then repeat with `allow_mutation=true`. `operation='pause'` takes it offline again. A procedure never returns to draft, so after testing, pause it unless the user wants it live.

- Publishing puts the procedure in front of customers. Never publish without the user's explicit request for that procedure.

### Guidance and data connectors

- Guidance (`type: guidance`) and data connectors (`type: data_connector`) use the same `operation='validate'` / `operation='upload'`; SF Fin routes by the file's `type` and validates against the workspace `guidance.json` / `data-connector.json`.
- Guidance has no draft state, and live guidance changes every answer at once. Upload always saves it **paused**. To make it live, call `operation='guidance_state' guidance_id=… state='live'` for the plan, ask the user, then repeat with `allow_mutation=true`.
- Data connectors: first `operation='create_data_connector' name=…` to get a numeric id. Then write the JSON with that `id`, an `https://` request URL, only the inputs the request uses (`<read attr='…' />`), and a `mock_response`, and upload it. It saves as a draft. Publishing is done by the user in the Intercom web UI.

### Choosing a surface

- `sf_fin action='surfaces'` compares the installed Fin CLI, the Intercom MCP, and the Fin Agent API and says which one SF Fin uses for each capability. It fails when either surface has changed since the map was reviewed.

### Fin Agent API runs

- `sf_fin action='agent' operation='access'` checks access first. The Fin Agent API is granted per workspace on request and uses its own key, generated under Fin AI Agent → Deploy → Fin Agent API. The user saves it with `/sf-fin connect agent` (`/login sf-fin-agent`), never in chat. SF Fin rejects the personal token as an Agent API key at login and before every request.
- Results `not_granted`, `wrong_key`, `auth_failed`, and `same_as_personal_token` each name the fix; relay it, and never retry with a different credential.
- `operation='capabilities'` lists the procedures a test user can trigger. It creates no conversation.
- `operation='run'` starts a real Fin conversation, using `procedure_id` (or `message` to ask Fin) plus scripted `replies`, and returns the transcript and final status. It is Guardrail-mediated, because a conversation Fin resolves is a billable outcome. The procedure must be live and available on the Fin Agent API channel.

## Recovery

| Outcome             | Next step                                                                             |
| ------------------- | ------------------------------------------------------------------------------------- |
| `not_connected`     | Ask the user to run `/login sf-fin` (region select, then masked token).               |
| `auth_expired`      | Ask the user to create a new personal API token in Fin and run `/login sf-fin` again. |
| `cli_missing`       | `sf_fin action='install'` (plan), then execute with `allow_mutation=true`.            |
| `cli_outdated`      | Same as `cli_missing`.                                                                |
| `permission_denied` | The token's teammate lacks access; the user must adjust permissions in Fin.           |
| `rate_limited`      | Wait, then run `doctor` once more.                                                    |
| `timeout`           | Check network access and any workspace IP allowlist; use `debug` for details.         |

Install plan outcomes:

- `refused` because the CLI is unmanaged (not installed by global npm): tell the user; do not try another install method.
- `EACCES`: do not retry, and never suggest `sudo`. Relay the user-owned npm prefix guidance.

## Boundaries

- Never ask the user to paste a token into chat, and never run `intercom auth login` yourself. `/login sf-fin` is the only credential entry path.
- Do not run the Fin CLI or `npm install -g @intercom/cli` directly through `bash`. Use `sf_fin`, which keeps the token out of argv and the user's own CLI config, pins exact versions, and routes installs through SF Guardrail.
- `allow_mutation=true` states intent; it is not approval. Never claim an install was approved unless the tool result shows it ran.
- `sf_fin` changes only Fin-as-code resources: procedure drafts, simulations, publish/pause, paused guidance and its state, draft data connectors, and Fin Agent API test conversations. It changes no other workspace configuration, and never publishes a data connector.
