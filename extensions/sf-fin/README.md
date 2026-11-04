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

This version does not author, publish, or change any Fin workspace configuration.

## Commands

| Command                     | Purpose                                                 |
| --------------------------- | ------------------------------------------------------- |
| `/sf-fin`                   | Open SF Fin in the SF Pi Manager                        |
| `/sf-fin connect`           | Prefill native `/login sf-fin`                          |
| `/sf-fin disconnect`        | Prefill native `/logout sf-fin`                         |
| `/sf-fin status`            | Print cached credential, region, CLI, and doctor result |
| `/sf-fin install [version]` | Install or update the Fin CLI after confirmation        |
| `/sf-fin doctor`            | Live read-only checks                                   |
| `/sf-fin debug`             | Redacted support bundle                                 |
| `/sf-fin debug on [runs]`   | Trace the next doctor run(s) with the CLI's `--verbose` |
| `/sf-fin debug off`         | Disarm verbose tracing                                  |
| `/sf-fin help`              | Print setup guidance                                    |

The agent uses the same operations through `sf_fin`. `sf_fin action='install'`
returns a plan; executing it requires `allow_mutation=true` and is mediated by
SF Guardrail (see below).

## Configuration

1. Run `/sf-fin install`, or `npm install -g @intercom/cli` (0.14.0 or later).
2. In Fin, open **Settings → Personal → API tokens** and create a token. The
   token acts with your teammate permissions, including your conversation
   access.
3. Run `/login sf-fin`, choose the region that matches your workspace URL
   (`app.intercom.com` is US), and paste the token into the masked prompt.
4. Run `/sf-fin doctor`.

`INTERCOM_TOKEN` and `INTERCOM_REGION` are non-persisted automation fallbacks.
`INTERCOM_APP_ID` is forwarded only for legacy Basic-auth API keys.

## Safety and Data Boundaries

- Pi alone persists the token under provider id `sf-fin`; `/logout sf-fin`
  removes it. SF Fin writes no other secret store.
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
