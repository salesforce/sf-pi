# SF Fin Agent Guide

Use `sf_fin` to check the Fin (formerly Intercom) workspace connection that SF Fin manages.

## Workflow

1. Call `sf_fin action='status'` first. It reads the cached result and makes no network call.
2. Call `sf_fin action='doctor'` when you need verified workspace identity or the cached status is missing, stale, or failed.
3. Report the outcome class and the next step from the result. Do not retry `auth_expired`, `permission_denied`, `cli_missing`, or `cli_outdated` in a loop.

## Recovery

| Outcome             | Next step                                                                             |
| ------------------- | ------------------------------------------------------------------------------------- |
| `not_connected`     | Ask the user to run `/login sf-fin` (region select, then masked token).               |
| `auth_expired`      | Ask the user to create a new personal API token in Fin and run `/login sf-fin` again. |
| `cli_missing`       | Ask the user to run `npm install -g @intercom/cli`.                                   |
| `cli_outdated`      | Ask the user to run `npm install -g @intercom/cli@latest`.                            |
| `permission_denied` | The token's teammate lacks access; the user must adjust permissions in Fin.           |
| `rate_limited`      | Wait, then run `doctor` once more.                                                    |
| `timeout`           | Check network access and any workspace IP allowlist.                                  |

## Boundaries

- Never ask the user to paste a token into chat, and never run `intercom auth login` yourself. `/login sf-fin` is the only credential entry path.
- Do not run the Fin CLI directly through `bash` with the user's credential. Use `sf_fin`, which keeps the token out of argv and out of the user's own CLI config.
- `sf_fin` does not author, publish, or change Fin configuration in this version.
