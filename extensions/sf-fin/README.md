# SF Fin

## What It Does

SF Fin connects SF Pi to a Fin (formerly Intercom) workspace. It owns one
credential, the workspace **personal API token**, and manages the Fin CLI
(`@intercom/cli`) it uses to reach the workspace.

- `/login sf-fin` asks for the workspace hosting region, then collects the token
  through SF Pi's fixed-mask input. Pi persists it; you stay connected across
  sessions until you log out or the token is revoked.
- `/sf-fin install` installs or updates the Fin CLI with global npm after
  confirmation, pinned to an exact version.
- `/sf-fin doctor` runs live read-only checks: Node, Fin CLI presence and
  version, credential, and workspace identity (`intercom me`).
- `/sf-fin debug` prints a redacted support bundle; `debug on` arms a one-shot
  verbose CLI trace saved to an owner-only file.
- `/sf-pi doctor` includes SF Fin's cached checks without network or
  credential use.

For Fin as code, SF Fin authors and tests procedures (validation, draft upload, simulations, publish and pause), guidance (always uploaded paused), and draft data connectors. It also compares the Fin CLI, Intercom MCP, and Fin Agent API surfaces, and runs end-to-end Fin Agent API conversations once your workspace has access. Each step that changes the workspace goes through SF Guardrail.

## Commands

| Command                                             | Purpose                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/sf-fin`                                           | Open SF Fin in the SF Pi Manager                                               |
| `/sf-fin connect`                                   | Prefill native `/login sf-fin`                                                 |
| `/sf-fin disconnect`                                | Prefill native `/logout sf-fin`                                                |
| `/sf-fin status`                                    | Print cached credential, region, CLI, and doctor result                        |
| `/sf-fin install [version]`                         | Install or update the Fin CLI after confirmation                               |
| `/sf-fin doctor`                                    | Live read-only checks                                                          |
| `/sf-fin debug`                                     | Redacted support bundle                                                        |
| `/sf-fin debug on [runs]`                           | Trace the next doctor run(s) with the CLI's `--verbose`                        |
| `/sf-fin debug off`                                 | Disarm verbose tracing                                                         |
| `/sf-fin sdk [manifest]`                            | Summarize Fin-as-code resources (enables the SDK once)                         |
| `/sf-fin sdk download`                              | Download and extract all Fin SDK resources locally                             |
| `/sf-fin sdk validate <file>`                       | Check a procedure.yaml against the workspace schema                            |
| `/sf-fin sdk upload <file>`                         | Upload an unpublished draft; verify the saved copy                             |
| `/sf-fin sdk upload_simulations <file>`             | Upload a simulation set for a procedure                                        |
| `/sf-fin sdk simulate <id>`                         | Generate (optional) and run simulations, with results                          |
| `/sf-fin sdk publish <id>`                          | Set a procedure live after confirmation                                        |
| `/sf-fin sdk pause <id>`                            | Take a live procedure offline after confirmation                               |
| `/sf-fin sdk create_data_connector <name>`          | Create a named draft data connector                                            |
| `/sf-fin sdk guidance_state <id> live\|paused`      | Set guidance live or paused after confirmation                                 |
| `/sf-fin surfaces`                                  | Compare Fin CLI, Intercom MCP, and Fin Agent API                               |
| `/sf-fin agent`                                     | Check Fin Agent API access                                                     |
| `/sf-fin setup [workspace] [build\|operator\|test]` | What is set up, what it unlocks, and only what is missing                      |
| `/sf-fin workspace [list\|add\|use\|remove]`        | Named workspaces, each with its own sign-ins                                   |
| `/sf-fin admin [sign-in\|open <page>\|read <page>]` | Verified Fin admin pages in the SF Pi browser (masked, navigate and read only) |
| `/sf-fin help`                                      | Print setup guidance                                                           |

The agent uses the same operations through `sf_fin`. `sf_fin action='install'`
returns a plan; executing it requires `allow_mutation=true` and is mediated by
SF Guardrail (see below).

## Configuration

1. Run `/sf-fin install`, or `npm install -g @intercom/cli` (0.14.0 or later).
2. In Fin, open **Settings → Personal → API tokens** and create a token. The
   token acts with your teammate permissions, including your conversation
   access.
3. Run `/login sf-fin` and paste the token into the masked prompt. SF Fin
   detects the region (US, EU, or AU) by asking each regional API who the token
   belongs to; it asks you only if none of them can be reached.
4. Run `/sf-fin setup` to see what each saved credential unlocks, whether they
   all point at the same workspace, and only what is still missing.

### Workspaces

Every credential belongs to a named workspace. The `default` workspace uses
the original sign-ins (`sf-fin`, `sf-fin-agent`, MCP connection `intercom`).
Add more with `/sf-fin workspace add <name> [test|prod]`. Each one gets its own
sign-ins: `/login sf-fin-<name>`, `/login sf-fin-agent-<name>`, and MCP
connection `intercom-<name>`. Switch with `/sf-fin workspace use <name>`, or
pass `workspace=<name>` to any `sf_fin` action. Setup binds each workspace to
the app id its personal token proves, and refuses a credential from a
different app.

A `prod` workspace is treated like a production Salesforce org: SF Guardrail
never session-approves its changes, and Power Tool Mode auto-approves them only
with the separate production opt-in. An unknown workspace name is treated the
same way.

For Fin Agent API runs (optional):

1. Request access in Fin under **Settings → Integrations → Fin Agent API**.
2. Once access is granted, open **Fin AI Agent → Deploy → Fin Agent API** and
   click **Generate API key**. Copy it with the copy button.
3. Run `/sf-fin connect agent` (or `/login sf-fin-agent`) and paste the key into
   the masked prompt. It is a separate key from the personal token, and SF Fin
   rejects the personal token here.
4. Run `/sf-fin agent` to check access. This starts no conversation and costs
   nothing.

`INTERCOM_TOKEN` and `INTERCOM_REGION` are non-persisted automation fallbacks.
`FIN_AGENT_API_KEY` is the automation fallback for the Fin Agent API key.
`INTERCOM_APP_ID` is forwarded only for legacy Basic-auth API keys.

### Fin admin pages

Some Fin setup has no API: Agent API keys, Help Center sites, data connector
publishing, and the Salesforce connection. `/sf-fin admin` opens these pages
in the shared SF Pi browser. This release navigates and reads; it changes
nothing in Fin.

1. Run `/login sf-fin-browser` once (`/sf-fin admin sign-in` prefills it). A
   browser window opens on your region's Fin sign-in page. Sign in yourself and
   tick **Keep me signed in**. SF Pi never types or sees your password.
2. When Fin shows your workspace, SF Fin saves Fin's two sign-in cookies in
   Pi's credential store, the same place as your token and Agent API key. It
   then removes them from the browser and closes the window.
3. Run `/sf-fin admin` to list the verified pages, then `/sf-fin admin read <page>`
   (or `open <page>`). No further sign-in is needed until Fin expires its
   remember cookie, about two weeks after you signed in. Then run
   `/login sf-fin-browser` again.

Named workspaces use `/login sf-fin-browser-<name>`. `/logout sf-fin-browser`
signs SF Pi out of the Fin admin.

Every page is opened for the app id that `/sf-fin setup` verified for the
workspace, and SF Fin checks after loading that the browser really shows that
app. It refuses if it lands somewhere else.

## Safety and Data Boundaries

- Pi alone persists the token under provider id `sf-fin`; `/logout sf-fin`
  removes it. SF Fin writes no other secret store.
- The Fin admin sign-in (`sf-fin-browser`) is two Fin cookies saved by Pi. SF
  Fin puts them into the shared browser only for the length of one admin
  action, and removes them on every path, so the browser's own saved-state file
  never holds a Fin sign-in. Cookie values go to the browser on stdin, never on
  a command line, and never appear in tool output.
- Fin admin pages: all browser text is masked before SF Pi sees it (secret-labelled
  values and key-shaped strings become `<masked>`). Pages that can show a key
  (Agent API, API tokens, workspace tokens), and any page with an open key
  dialog, never get screenshots or editor reads. Keys reach Pi only when you
  copy them yourself into a masked `/login` prompt.
- A committing click on a Fin admin page is bound to the Fin workspace that
  proved that app id (`native-sf-browser-fin-admin-commit`), not to a Salesforce
  org. It is never session-approved, and an unverified or `prod` app needs the
  production opt-in under Power Tool Mode.
- The token reaches the CLI only through an allowlisted child-process
  environment, never command-line arguments.
- The CLI runs with an SF Pi-private `INTERCOM_CONFIG_DIR`, so your own Fin CLI
  login (keychain or `~/.intercom`) is neither read nor modified.
- CLI output is scrubbed of the token. The status file keeps only non-secret
  workspace identity and install readiness.
- `doctor` never calls Fin SDK endpoints. Fin SDK actions (`sdk manifest`,
  `sdk download`) enable the Fin SDK by default on first use: SF Fin probes,
  performs one explicit `POST /fin-sdk/enable`, verifies it, and only then runs
  the CLI, so the CLI's silent auto-enable never fires. The first call on a
  not-yet-enabled workspace is an SF Guardrail mutation (Power Tool family
  **Fin CLI and Operator**); later reads are prompt-free.
- Install runs exactly `npm install -g @intercom/cli@<exact version>`, never
  `sudo` or `@latest`, honors npm's `before` / `min-release-age` policy, and
  refuses to modify a CLI that global npm did not install.
- Procedure upload validates against the workspace schema first and never sets
  `state`, so it keeps a procedure's current state. Upload, simulation-set
  upload, and simulate are SF Guardrail mutations
  (`native-sf-fin-procedure-write`); `validate` is local.
- Fin simulates **live** procedures only. A draft runs without its steps, and
  `sdk simulate` warns about it. Publish the procedure to test it, then pause it
  again. A procedure never returns to draft.
- `sdk publish|pause` only plans unless you pass `allow_mutation=true`. Executing
  it is an exact SF Guardrail mutation (`native-sf-fin-procedure-state`, Power
  Tool family **Fin CLI and Operator**) that is never session-approved, because
  publishing puts the procedure in front of customers. SF Fin then checks the
  state Fin reports.
- Guidance uploads are always saved `paused`, because live guidance changes
  every answer at once. `sdk guidance_state` plans by default; executing it is
  an exact SF Guardrail mutation that is never session-approved. Data
  connectors upload only as drafts, and publishing them stays in the Intercom
  web UI.
- The Fin Agent API key is a separate Pi credential (`sf-fin-agent`). Pi alone
  persists it, in `~/.pi/agent/auth.json` (owner-only), and SF Fin writes no
  second copy.
  - Login trims the key. It rejects empty, multi-line, `Bearer`-prefixed, or
    too-short values, and the personal token. Comparisons are constant-time.
  - Before every request, SF Fin refuses a key equal to the personal token,
    from any source.
  - The key is sent only as an HTTPS `Authorization` header to the region's
    fixed Fin Agent API host, never following redirects. It never reaches the
    CLI, argv, child environments, logs, status files, or tool output.
  - `agent-api-status.json` (owner-only) records only the last access outcome
    and its time.
  - `/sf-pi doctor`, `/sf-fin status`, and the debug bundle report the key's
    source and last access result, never its value.
  - `/sf-fin disconnect agent` prepares `/logout sf-fin-agent`. Revoke or
    regenerate the key in Fin if it may have been exposed.
- `agent run` is an SF Guardrail mutation (`native-sf-fin-agent-run`), because a
  conversation Fin resolves is a billable outcome. Access checks and capability
  listing create no conversation.
- `surfaces` runs only local `--help` commands, with no token and no network.
- Agent-initiated installs are SF Guardrail native mutations in the
  **Fin CLI install** family. They ask for approval by default and are
  auto-approved only when Guardrail Power Tool Mode includes that family (or
  is set to all confirm-class decisions).
- Verbose traces drop `Authorization`, `Cookie`, and bearer/basic values, are
  written with mode `0600`, keep the newest 10, and turn themselves off after
  the armed runs. Only the file path reaches the model.

## Troubleshooting

**Symptom:** `doctor` reports `cli_missing`.
Run `/sf-fin install`, and make sure `intercom` is on the `PATH` Pi was
started with.

**Symptom:** `install` reports `EACCES`.
npm cannot write to its global directory. SF Fin does not retry with `sudo`;
point npm at a user-owned prefix or use a Node version manager, then retry.

**Symptom:** `install` refuses to update the CLI.
The CLI on `PATH` was not installed by global npm (for example Homebrew).
Update it with that tool, or remove it and run `/sf-fin install`.

**Symptom:** `doctor` reports `auth_expired`.
The token was revoked, regenerated, or belongs to another region. Create a new
personal API token and run `/login sf-fin` again.

**Symptom:** `doctor` reports `timeout` or a network error.
Check connectivity and, if the workspace restricts API access by IP address,
add this machine to the allowlist. Run `/sf-fin debug on`, then
`/sf-fin doctor`, and inspect the scrubbed trace file it reports.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-fin/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
