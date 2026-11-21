# SF Fin Agent Guide

Use `sf_fin` to check, install, and debug the Fin (formerly Intercom) workspace connection that SF Fin manages.

## Workflow

1. Call `sf_fin action='status'` first. It reads the cached result and makes no network call. For "what do I still need?", call `sf_fin action='setup'` (read-only). Pass `wants` to limit it to `build`, `operator`, or `test`. It proves each credential's workspace where possible and lists only the missing steps.

- Every action accepts `workspace=<name>` (default: the active workspace). Never assume a workspace: when the user names test or prod, pass it. `prod` workspaces need the user's explicit intent for each change; SF Guardrail never session-approves them.

2. Call `sf_fin action='doctor'` when you need verified workspace identity, install readiness, or the cached status is missing, stale, or failed.
3. For `cli_missing`, `cli_outdated`, or an available update the user wants, call `sf_fin action='install'` without `allow_mutation` to show the plan. Then call it again with `allow_mutation=true`, passing the planned `version`. SF Guardrail asks the user to approve unless Power Tool Mode covers the Fin CLI install family. Rerun `doctor` afterwards.
4. For an unexplained doctor failure, call `sf_fin action='debug'` for the redacted bundle. If the HTTP exchange matters, call `sf_fin action='debug' verbose='on'`, then `doctor` once, and read the trace file path it returns.

## Fin as code

- `sf_fin action='sdk' operation='manifest'` summarizes procedures, workflows, guidance, data connectors, and tasks.
- `sf_fin action='sdk' operation='download'` downloads and extracts all Fin SDK resources (editable `src/`, read-only `.fin/` reference data and JSON schemas, docs, and bundled agent skills). The result lists the extraction path; read the workspace `AGENTS.md` there before editing.
- The first SDK call on a workspace enables the Fin SDK (Guardrail-mediated). Never run `intercom fin …` through `bash`.

### Procedure draft loop

1. Write `procedure.yaml` following the downloaded workspace `AGENTS.md`, `docs/PROCEDURES.md`, and the procedure-generator skill.
2. `sf_fin action='sdk' operation='validate' file=…`, and fix every issue it reports. Run it after the command that writes the file has finished, not in the same parallel batch. A `⚠` warning does not block upload; an `api`, `inbox`, or `button_click` trigger needs Fin behavior settings in the Fin web UI before Fin will publish the procedure.
3. `operation='upload' file=…`. New files use `id: new`; after the first upload, set `id` and the returned `version` before editing again. Never add `state`. Upload saves a draft only, and the result reports whether the saved copy is semantically identical.
4. Write a `simulation_set` (`type: simulation_set`, `procedure_id`, `tests:` of `type: simulation_test`). Give each test exactly one outcome assertion (`outcome` or `escalated_to`; use `DEFAULT` for the default inbox), plus any `agent_response` checks, and never assert on `temporary.*` attributes. Then `operation='upload_simulations' file=…`. Fin saves tests one by one, so a failed upload can leave some saved; SF Fin refuses a re-upload whose id-less tests already exist by name and lists their ids to add.
5. `operation='simulate' procedure_id=…`. It tests the procedure's **draft** (nothing goes live); pass `live=true` only to test the live version. Read each failed assertion's reasoning, fix the procedure or the test, and repeat from step 2.
6. To release, `operation='publish' procedure_id=…` returns a plan; ask the user, then repeat with `allow_mutation=true`. Publish also promotes a live procedure's unpublished draft. `operation='pause'` takes it offline again. Testing never needs a publish, and a procedure never returns to draft.

- Publishing puts the procedure in front of customers. Never publish without the user's explicit request for that procedure.

### Guidance and data connectors

- Guidance (`type: guidance`) and data connectors (`type: data_connector`) use the same `operation='validate'` / `operation='upload'`; SF Fin routes by the file's `type` and validates against the workspace `guidance.json` / `data-connector.json`.
- Guidance has no draft state, and live guidance changes every answer at once. Upload always saves it **paused**. To make it live, call `operation='guidance_state' guidance_id=… state='live'` for the plan, ask the user, then repeat with `allow_mutation=true`.
- Data connectors: first `operation='create_data_connector' name=…` to get a numeric id. Then write the JSON with that `id`, an `https://` request URL, only the inputs the request uses (`<read attr='…' />`), and a `mock_response`, and upload it. It saves as a draft. Check its token with `operation='auth_tokens'` (metadata only), then set it live with `operation='connector_state' connector_id=… state='live'`: it plans first; ask the user, then repeat with `allow_mutation=true`. A connector with no request URL is refused.
- `operation='agent_status' procedure_id=…` shows one agent's chain: procedure state and channels, each `<use action>` connector with its state and auth token, simulation count, and the next step.
- `operation='connector_logs' connector_id=…` (optional `since_hours`) lists recent runs without bodies; use it when a procedure step or simulation fails on a connector.
- `operation='simulations_delete' procedure_id=… test_id=…` deletes exactly one simulation (plan first; it cannot be undone).
- `validate` also checks `<use action="…">` against live connectors and `<escalate to="…">` against teams and teammates from the downloaded `.fin/` rosters, because Fin rejects a save that names one that does not exist.

### Choosing a surface

- `sf_fin action='surfaces'` compares the installed Fin CLI, the Intercom MCP, and the Fin Agent API and says which one SF Fin uses for each capability. It fails when either surface has changed since the map was reviewed.

### Fin Agent API runs

- `sf_fin action='agent' operation='access'` checks access first. The Fin Agent API is granted per workspace on request and uses its own key, generated under Fin AI Agent → Deploy → Fin Agent API. The user saves it with `/sf-fin connect agent` (`/login sf-fin-agent`), never in chat. SF Fin rejects the personal token as an Agent API key at login and before every request.
- Results `not_granted`, `wrong_key`, `auth_failed`, and `same_as_personal_token` each name the fix; relay it, and never retry with a different credential.
- `operation='capabilities'` lists the procedures a test user can trigger. It creates no conversation.
- `operation='run'` starts a real Fin conversation and returns the transcript and whether Fin answered (`answered` or `timed_out`). It takes `procedure_id` (or `message` to ask Fin) plus scripted `replies`. Asking is one-shot: one answer, with no follow-ups. A procedure run sends each scripted reply after each Fin turn. It is Guardrail-mediated, because a conversation Fin resolves is a billable outcome. The procedure must be live and available on the Fin Agent API channel with an API trigger.
- Pass `expect=[…]` (up to 10 phrases) to make a run a test: each phrase must appear in Fin's replies (case-insensitive; the user's own words never count), and any miss fails the run even when Fin answered. The result also reports citations (`[n]` markers) and whether Fin handed off to a teammate.

## Fin for Salesforce (Salesforce side)

`sf_fin action='salesforce'` sets up Fin for Salesforce Cases end to end in one explicit `target_org`. Always pass `target_org`; never assume the default org. Run the operation that `readiness` names in its **Next** line, in this order:

1. `operation='readiness'` is read-only. It reports the package (`finai`), the four Fin Case fields, the audit-field setting, Digital Experiences and `FeedItem.Visibility`, Enhanced Email, both permission sets, the Fin External Client App, the dedicated Fin user, the integration user, and whether Fin holds an OAuth token in the org. Once connected, it adds go-live checks: effective object access against Fin's matrix, case routing (an active record-triggered Case Flow and at least one case owned by the Fin user), a Case handoff queue, and Email-to-Case. Checks the org cannot be read for are omitted, never guessed.
2. `operation='package_install' package_version=…` takes the `04t` id or install link from Fin's **Connect → environment → Install package** dialog (Fin requires its latest version, so never reuse an old id). It installs for all users, blocks on name conflicts, refuses packages outside `finai`, and verifies the result in Installed Packages, which decides success even when the org cannot report the install request's own status.
3. `operation='audit_fields_enable'` deploys SecuritySettings with only `enableAuditFieldsInactiveOwner=true` and verifies it. It grants the audit permissions to nobody.
4. `operation='digital_experiences_enable'` deploys CommunitiesSettings with only `enableNetworksEnabled=true` and verifies that `FeedItem.Visibility` now exists (Fin reads it to tell internal case comments from public ones). It is **one-way**: Digital Experiences cannot be turned off again and the org's Lightning Platform domain name can no longer be changed, so confirm the user wants it before executing. It creates no site and no external users.
5. `operation='enhanced_email_enable'` deploys EmailAdministrationSettings with only `enableEnhancedEmailEnabled=true` and verifies it. It is org-wide; most orgs already have it on.
6. `operation='permissions_apply'` (optional `username`, `email`) deploys `SF_Fin_Salesforce_Access` (including `CreateAuditFields` once step 3 is done, and only permissions the org exposes), creates the dedicated Fin user (profile Minimum Access - Salesforce, Service Cloud User), and assigns both permission sets to the Fin user and to the integration user (the user holding Fin's OAuth token, or before connect the CLI user). It only fills gaps.
7. `operation='connect'` (optional `environment='live'|'test'`, default from the org type: live for production and Developer Edition, test for sandboxes) runs Fin's Connect flow in the shared SF Pi browser with the saved Fin admin sign-in: environment card → Connect to Salesforce → approves **Fin for Salesforce** on the target org's own My Domain as the CLI user (it refuses any other host, app, or user) → sets Fin's Salesforce user to the dedicated Fin user. It then verifies Fin's OAuth token in the org.

- Every change plans without `allow_mutation` and executes with `allow_mutation=true`. SF Guardrail mediates each execute as `native-sf-fin-salesforce-setup`: exact and org-bound, never session-approved, and blocked on production or unknown orgs.
- `connect` needs `/login sf-fin-browser`; on `signed_out` or `signin_expired`, ask the user to run it.
- `operation='observe'` (read-only, never prompts) shows how Fin has worked Cases in the org: Fin-involved cases, resolved (Soft or Hard Resolution) and routed counts with a resolution rate, counts by origin, cases the Fin user owns now, and the most recent cases (no descriptions or email bodies). Use it after go-live, or after assigning a test case.
- Case routing: when readiness reports no active Case Flow, build one with `sf_flow` (record-triggered, after-save, create, sets `OwnerId` to the Fin user found by username), activate it with `sf_flow`, then create one matching test case and run readiness again.
- Handoff queue: when readiness reports no Case queue, `operation='handoff_queue_create'` (optional `queue_name`, default `Fin Handoff`) creates one Case queue with no members, no member email, and no role-hierarchy access, and verifies it. It never changes an existing queue; a same-named queue for other objects is refused. Then the human picks it as the handoff target in Fin's Salesforce cases workflow and adds teammates in Setup → Queues.
- Email-to-Case stays guided: enabling it is one-way and Salesforce emails a verification link for each routing address. Not needed for Web-to-Case or manually created cases.
- Fin Messenger live chat (BYOC) is out of scope; it needs Digital Engagement with Partner Messaging.

## Fin admin pages

- `sf_fin action='admin' operation='pages'` lists the verified pages. `operation='read' page=<id>` opens one for the workspace's verified app and returns a masked summary; `operation='open'` only navigates, for follow-up `sf_browser_snapshot` work.
- `signed_out`, `signin_expired`, or `signin_rejected`: ask the user to run `/login sf-fin-browser` (named workspaces: `sf-fin-browser-<name>`) and sign in themselves in the window that opens. Pi keeps the sign-in for about two weeks. Never type a Fin email or password, never fill the sign-in form, and never ask for a verification code; codes are typed only in the browser window.
- `app_mismatch`: the browser is signed in to another Fin app. Do not continue; tell the user.
- On secret pages (agent-api, api-tokens, workspace-tokens), never click reveal, copy, or show controls to obtain a key, and never ask for one in chat. The user copies keys into `/sf-fin connect agent` or `/login sf-fin`.
- This release reads Fin admin pages only. Do not click buttons that change Fin (generate, publish, go live, connect, revoke, save); SF Guardrail treats them as Fin workspace commits.

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
- `sf_fin action='admin'` never changes Fin; it navigates and reads masked page text.
- In Fin, `sf_fin` changes only Fin-as-code resources: procedure drafts, simulations, publish/pause, paused guidance and its state, data connectors (draft upload and connector state), and Fin Agent API test conversations. It changes no other workspace configuration.
- In Salesforce, `sf_fin action='salesforce'` changes only the target org's Fin for Salesforce package, the one `enableAuditFieldsInactiveOwner` security setting, the one `enableNetworksEnabled` communities setting, the `SF_Fin_Salesforce_Access` permission set, the dedicated Fin user, the two Fin permission set assignments (Fin user and integration user), and, through `connect`, Fin's OAuth connection and Salesforce user choice.
