# AGENTS.md — sf-fin

SF Fin owns the Fin (formerly Intercom) workspace credential, Fin CLI install lifecycle, diagnostics, and CLI execution inside SF Pi. Start from `index.ts`, the relevant implementation module, and its focused Behavior Proof.

## File map

| Responsibility                                                                         | File                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Extension entry, provider, command routing, Manager actions                            | `index.ts`                                        |
| Shared doctor/install/debug service for command, tool, and Manager                     | `lib/service.ts`                                  |
| Pi-native region + masked token login and resolution                                   | `lib/auth.ts`                                     |
| Bounded Fin CLI child process, outcome classes, trace scrubbing                        | `lib/cli-runner.ts`                               |
| Live six-check doctor and cached `/sf-pi doctor` checks                                | `lib/doctor.ts`                                   |
| CLI detection, npm global root, registry metadata                                      | `lib/install/detect.ts`                           |
| Install planning and the single npm install execution                                  | `lib/install/installer.ts`                        |
| Debug bundle, verbose arming, trace artifacts                                          | `lib/debug.ts`                                    |
| Pattern-based failure advice                                                           | `lib/failure-diagnostics.ts`                      |
| Direct Fin SDK probe and explicit enable                                               | `lib/sdk-gate.ts`                                 |
| Fin-as-code reads (manifest, download) that enable on first use                        | `lib/sdk-reads.ts`                                |
| Procedure validate, draft upload, simulation sets, simulate                            | `lib/sdk-procedures.ts`                           |
| Semantic procedure round-trip comparison                                               | `lib/procedure-normalize.ts`                      |
| Guidance and data connector validate/upload, guidance state                            | `lib/sdk-resources.ts`                            |
| CLI vs MCP vs Agent API capability map and drift report                                | `lib/surfaces.ts`                                 |
| Fin Agent API harness (access, capabilities, scripted runs)                            | `lib/agent-api.ts`                                |
| Named workspace profiles and per-workspace sign-in names                               | `lib/workspaces.ts`                               |
| Automatic region discovery from `/me`                                                  | `lib/region.ts`                                   |
| Unified setup evaluation (credentials, capabilities, mismatches)                       | `lib/setup.ts`                                    |
| Fin admin pages in the shared SF Pi browser (navigate, verify app, masked read)        | `lib/admin.ts`                                    |
| Pi-persisted Fin admin sign-in (cookies) and its agent-browser boundary                | `lib/browser-signin.ts`, `lib/signin-browser.ts`  |
| Manager install confirm page                                                           | `lib/manager-action-panels.ts`                    |
| Fin for Salesforce contract: declared fields, permissions, readiness, XML              | `lib/salesforce/contract.ts`                      |
| Salesforce org adapter (shared sf-conn; reads and the exact writes)                    | `lib/salesforce/org.ts`                           |
| Salesforce readiness, install, audit fields, Digital Experiences, permissions, connect | `lib/salesforce/setup.ts`                         |
| Fin Connect browser runbook and its agent-browser adapter                              | `lib/salesforce/connect.ts`, `connect-browser.ts` |
| One `sf_fin` family tool                                                               | `lib/sf_fin-tool.ts`                              |
| Result Cards (human) and bounded model packets (LLM)                                   | `lib/cards.ts`, `lib/render.ts`                   |
| Cache-first status file and text                                                       | `lib/status.ts`                                   |
| Command metadata/help                                                                  | `lib/command-surface.ts`                          |
| Shared constants/types                                                                 | `lib/types.ts`                                    |

## Invariants

1. **Pi owns the credential.** `/login sf-fin` collects the region via a select prompt and the token via the shared fixed-mask bridge; Pi persists both and `/logout sf-fin` removes them. Never write `auth.json`, a keychain entry, or any other secret store.
2. **Token only in the child env.** `cli-runner.ts` passes `INTERCOM_TOKEN` through an allowlisted environment. Never put the token in argv, logs, status, tool `content`/`details`, errors, or debug bundles. Scrub CLI output with `redactSecret`; scrub verbose traces with `scrubTrace`.
3. **Private CLI config.** Always set `INTERCOM_CONFIG_DIR` to the SF Pi-private directory so the user's own CLI login is never read or mutated.
4. **No shell, bounded runs.** `spawn`/`pi.exec` without a shell, with timeouts and output caps.
5. **Install is exact and unelevated.** Install args are built only by `buildInstallArgs(exactVersion)`. Never add `sudo`, `@latest`, or a retry with elevation; refuse unmanaged (non–global npm) CLIs; honor npm release-age policy.
6. **Install is Guardrail-mediated.** `sf_fin install` with `allow_mutation=true` is classified by `sf-guardrail` as `native-sf-fin-cli-install` (family `fin`). The tool must not ask the user itself or treat `allow_mutation` as approval. The human command path confirms in the TUI.
7. **Explicit SDK enablement.** Any Fin CLI `fin …` command can trigger `POST /fin-sdk/enable` on a `fin_sdk_not_enabled` response. Every SDK command must go through `sdk-reads.ts` `ensureFinSdkEnabled` (probe → explicit enable → verify → record shared state) before the CLI runs. Never run a `fin …` command on a workspace not verified as enabled. Procedure version history is gated separately; read it with `sdk-gate.ts` `readProcedureVersions`, never `intercom fin procedures versions` (its 403 triggers the CLI auto-enable).
8. **Cache-first boot and aggregate doctor.** Factory and `session_start` do no network, subprocess, or credential work. The `/sf-pi doctor` provider reads only cached state.
9. **Verbose traces are one-shot artifacts.** Arming is bounded (1–5 runs) and self-disarming; traces are `0600` files with retention; only paths reach the model.
10. **Public-safe.** Tests and docs use synthetic workspace ids, names, emails, and token sentinels only.
11. **Salesforce setup is explicit and verified.** `sf_fin action='salesforce'` requires an explicit `target_org`, reaches Salesforce only through `lib/common/sf-conn`, and loads it lazily. Executes (`allow_mutation=true`) are classified `native-sf-fin-salesforce-setup` (exact, org-bound, never session-approved, blocked on production or unknown). Never hardcode a package version id; refuse packages outside the `finai` namespace; change no org-wide setting except the single `enableAuditFieldsInactiveOwner` field (`audit_fields_enable`) the single one-way `enableNetworksEnabled` field (`digital_experiences_enable`, whose plan states it is one-way), and the single `enableEnhancedEmailEnabled` field (`enhanced_email_enable`, whose plan states it is org-wide); `handoff_queue_create` creates one member-less Case queue and never changes an existing queue; `token_transfer` refuses production/unknown orgs, toggles only `enableClientSecretInRestApiAccess` and only when it was off, restores it on every path, passes the consumer secret to the browser only over stdin, and never returns it; readiness never guesses a go-live check it cannot read; `connect` approves only the Fin for Salesforce app on the target org's own My Domain for the CLI user and opens OAuth/frontdoor URLs only through the browser's stdin channel; re-read org state after every execute and report only the verified result.
12. **Cards for people, packets for the model.** Every `sf_fin` result leaves through `finish()` in `lib/sf_fin-tool.ts`: `details.card` is an `SfPiResultCard` built from structured details (never by parsing secrets or URLs), and `content` is the model packet bounded by `MODEL_PACKET_MAX_CHARS` with session-bearing URLs removed. Plans and executes show the Guardrail rule and reversibility. Long operations stream `details.progress`.

## Testing

- Auth: `tests/auth.test.ts`.
- Runner: `tests/cli-runner.test.ts` (fake `intercom` binary proves argv/env/redaction).
- Doctor: `tests/doctor.test.ts` (injected exec/registry/runner).
- Install: `tests/install.test.ts` (plan states, exact args, EACCES, release-age policy, npm-global detection).
- Debug: `tests/debug.test.ts` (scrubbing, artifacts, arming, bundle redaction).
- Result Cards and model packets: `tests/cards.test.ts`.
- Salesforce setup: `tests/salesforce-setup.test.ts` (contract, readiness, plan/execute, refusals, verified results against an in-memory org).
- Fin Connect runbook: `tests/salesforce-connect.test.ts` (scripted fake Fin + Salesforce: host, app, and user checks; secret URLs only on the secret channel).
- Salesforce adapter: `tests/salesforce-org.test.ts` (package install completes from Installed Packages when the install request is unreadable).
- Guardrail classification: `extensions/sf-guardrail/tests/safety-kernel.test.ts` and `power-tool-mode.test.ts`.
