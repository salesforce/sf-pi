# SF Fin

## What It Does

SF Fin connects SF Pi to a Fin (formerly Intercom) workspace. It owns one
credential, the workspace **personal API token**, and verifies it through the
user's installed Fin CLI (`@intercom/cli`).

- `/login sf-fin` asks for the workspace hosting region, then collects the token
  through SF Pi's fixed-mask input. Pi persists it; you stay connected across
  sessions until you log out or the token is revoked.
- `/sf-fin doctor` runs a read-only check (`intercom --version`, then
  `intercom me`) and records the confirmed workspace identity.
- `/sf-fin status` and `sf_fin action='status'` render the cached result
  without a network call.

This version does not author, publish, or change any Fin configuration.

## Commands

| Command              | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `/sf-fin`            | Open SF Fin in the SF Pi Manager                    |
| `/sf-fin connect`    | Prefill native `/login sf-fin`                      |
| `/sf-fin disconnect` | Prefill native `/logout sf-fin`                     |
| `/sf-fin status`     | Print cached credential, region, and doctor result  |
| `/sf-fin doctor`     | Verify the CLI and the saved credential (read-only) |
| `/sf-fin help`       | Print setup guidance                                |

## Configuration

1. Install the Fin CLI: `npm install -g @intercom/cli` (0.14.0 or later).
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
  workspace identity (app id, workspace name, admin name/email, region).
- `doctor` never calls Fin SDK endpoints, so it cannot trigger the CLI's
  automatic Fin SDK enablement.

## Troubleshooting

**Symptom:** `doctor` reports `cli_missing`.
Install the CLI globally with `npm install -g @intercom/cli` and make sure
`intercom` is on the `PATH` Pi was started with.

**Symptom:** `doctor` reports `auth_expired`.
The token was revoked, regenerated, or belongs to another region. Create a new
personal API token and run `/login sf-fin` again.

**Symptom:** `doctor` reports `timeout` or a network error.
Check connectivity and, if the workspace restricts API access by IP address,
add this machine to the allowlist.

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
