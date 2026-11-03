# AGENTS.md — sf-fin

SF Fin owns the Fin (formerly Intercom) workspace credential and CLI execution inside SF Pi. Start from `index.ts`, the relevant implementation module, and its focused Behavior Proof.

## File map

| Responsibility                                              | File                     |
| ----------------------------------------------------------- | ------------------------ |
| Extension entry, provider, command routing, Manager actions | `index.ts`               |
| Pi-native region + masked token login and resolution        | `lib/auth.ts`            |
| Bounded Fin CLI child process and outcome classification    | `lib/cli-runner.ts`      |
| Read-only doctor (`--version`, `me`)                        | `lib/doctor.ts`          |
| One `sf_fin` family tool                                    | `lib/sf_fin-tool.ts`     |
| Cache-first status file and text                            | `lib/status.ts`          |
| Command metadata/help                                       | `lib/command-surface.ts` |
| Shared constants/types                                      | `lib/types.ts`           |

## Invariants

1. **Pi owns the credential.** `/login sf-fin` collects the region via a select prompt and the token via the shared fixed-mask bridge; Pi persists both and `/logout sf-fin` removes them. Never write `auth.json`, a keychain entry, or any other secret store.
2. **Token only in the child env.** `cli-runner.ts` passes `INTERCOM_TOKEN` through an allowlisted environment. Never put the token in argv, logs, status, tool `content`/`details`, or errors. Scrub CLI output with `redactSecret`.
3. **Private CLI config.** Always set `INTERCOM_CONFIG_DIR` to the SF Pi-private directory so the user's own CLI login is never read or mutated.
4. **No shell, bounded runs.** `spawn` with `shell: false`, a timeout, and an output cap.
5. **No hidden enablement.** Any Fin CLI `fin …` command can trigger `POST /fin-sdk/enable` on a `fin_sdk_not_enabled` response. Treat every `fin …` command as potentially mutating and route it through SF Guardrail before adding it.
6. **Cache-first boot.** Factory and `session_start` do no network, subprocess, or credential work.
7. **Public-safe.** Tests and docs use synthetic workspace ids, names, emails, and token sentinels only.

## Testing

- Auth changes: `tests/auth.test.ts` (Pi-native login, env fallback, status-only detection).
- Runner changes: `tests/cli-runner.test.ts` uses a fake `intercom` binary to prove argv/env/redaction behavior.
- Doctor changes: `tests/doctor.test.ts` with injected runner responses.
