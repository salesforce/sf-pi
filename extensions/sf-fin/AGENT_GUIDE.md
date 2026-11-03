# SF Fin Agent Guide

Use `sf_fin` to check, install, and debug the Fin (formerly Intercom) workspace connection that SF Fin manages.

## Workflow

1. Call `sf_fin action='status'` first. It reads the cached result and makes no network call.
2. Call `sf_fin action='doctor'` when you need verified workspace identity, install readiness, or the cached status is missing, stale, or failed.
3. For `cli_missing`, `cli_outdated`, or an available update the user wants, call `sf_fin action='install'` without `allow_mutation` to show the plan. Then call it again with `allow_mutation=true`, passing the planned `version`. SF Guardrail asks the user to approve unless Power Tool Mode covers the Fin CLI install family. Rerun `doctor` afterwards.
4. For an unexplained doctor failure, call `sf_fin action='debug'` for the redacted bundle. If the HTTP exchange matters, call `sf_fin action='debug' verbose='on'`, then `doctor` once, and read the trace file path it returns.

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
- `sf_fin` does not author, publish, or change Fin workspace configuration in this version.
