# AGENTS.md — sf-fin

SF Fin owns the Fin (formerly Intercom) workspace credential, Fin CLI install lifecycle, diagnostics, and CLI execution inside SF Pi. Start from `index.ts`, the relevant implementation module, and its focused Behavior Proof.

## File map

| Responsibility                                                     | File                           |
| ------------------------------------------------------------------ | ------------------------------ |
| Extension entry, provider, command routing, Manager actions        | `index.ts`                     |
| Shared doctor/install/debug service for command, tool, and Manager | `lib/service.ts`               |
| Pi-native region + masked token login and resolution               | `lib/auth.ts`                  |
| Bounded Fin CLI child process, outcome classes, trace scrubbing    | `lib/cli-runner.ts`            |
| Live six-check doctor and cached `/sf-pi doctor` checks            | `lib/doctor.ts`                |
| CLI detection, npm global root, registry metadata                  | `lib/install/detect.ts`        |
| Install planning and the single npm install execution              | `lib/install/installer.ts`     |
| Debug bundle, verbose arming, trace artifacts                      | `lib/debug.ts`                 |
| Pattern-based failure advice                                       | `lib/failure-diagnostics.ts`   |
| Manager install confirm page                                       | `lib/manager-action-panels.ts` |
| One `sf_fin` family tool                                           | `lib/sf_fin-tool.ts`           |
| Cache-first status file and text                                   | `lib/status.ts`                |
| Command metadata/help                                              | `lib/command-surface.ts`       |
| Shared constants/types                                             | `lib/types.ts`                 |

## Invariants

1. **Pi owns the credential.** `/login sf-fin` collects the region via a select prompt and the token via the shared fixed-mask bridge; Pi persists both and `/logout sf-fin` removes them. Never write `auth.json`, a keychain entry, or any other secret store.
2. **Token only in the child env.** `cli-runner.ts` passes `INTERCOM_TOKEN` through an allowlisted environment. Never put the token in argv, logs, status, tool `content`/`details`, errors, or debug bundles. Scrub CLI output with `redactSecret`; scrub verbose traces with `scrubTrace`.
3. **Private CLI config.** Always set `INTERCOM_CONFIG_DIR` to the SF Pi-private directory so the user's own CLI login is never read or mutated.
4. **No shell, bounded runs.** `spawn`/`pi.exec` without a shell, with timeouts and output caps.
5. **Install is exact and unelevated.** Install args are built only by `buildInstallArgs(exactVersion)`. Never add `sudo`, `@latest`, or a retry with elevation; refuse unmanaged (non–global npm) CLIs; honor npm release-age policy.
6. **Install is Guardrail-mediated.** `sf_fin install` with `allow_mutation=true` is classified by `sf-guardrail` as `native-sf-fin-cli-install` (family `fin`). The tool must not ask the user itself or treat `allow_mutation` as approval. The human command path confirms in the TUI.
7. **No hidden enablement.** Any Fin CLI `fin …` command can trigger `POST /fin-sdk/enable` on a `fin_sdk_not_enabled` response. Treat every `fin …` command as potentially mutating and route it through SF Guardrail before adding it.
8. **Cache-first boot and aggregate doctor.** Factory and `session_start` do no network, subprocess, or credential work. The `/sf-pi doctor` provider reads only cached state.
9. **Verbose traces are one-shot artifacts.** Arming is bounded (1–5 runs) and self-disarming; traces are `0600` files with retention; only paths reach the model.
10. **Public-safe.** Tests and docs use synthetic workspace ids, names, emails, and token sentinels only.

## Testing

- Auth: `tests/auth.test.ts`.
- Runner: `tests/cli-runner.test.ts` (fake `intercom` binary proves argv/env/redaction).
- Doctor: `tests/doctor.test.ts` (injected exec/registry/runner).
- Install: `tests/install.test.ts` (plan states, exact args, EACCES, release-age policy, npm-global detection).
- Debug: `tests/debug.test.ts` (scrubbing, artifacts, arming, bundle redaction).
- Guardrail classification: `extensions/sf-guardrail/tests/safety-kernel.test.ts` and `power-tool-mode.test.ts`.
