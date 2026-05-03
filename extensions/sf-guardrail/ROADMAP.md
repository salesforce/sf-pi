# sf-guardrail Roadmap

Phased plan for sf-guardrail beyond MVP (Tier 1 policies + Tier 2
org-aware bash gates). Items here are not promises — priority is the
rough order.

## Shipped (MVP)

- [x] Policies tier: `noAccess` / `readOnly` / `none`, glob + regex,
      allowedPatterns short-circuit, strongest-wins conflict resolution,
      `onlyIfExists` (default true).
- [x] Bundled rules for `destructiveChanges*.xml`, `.forceignore`,
      `.sf/**`, `.sfdx/**`, `.env*`.
- [x] Command gate: structural token matching for `rm -rf`, `sudo`,
      `sf org delete`, `git push --force`.
- [x] Org-aware gate: `sf project deploy`, `sf apex run`, `sf data
(delete|update|upsert|import)`, `sf org api --method
DELETE|PATCH|PUT` — production only.
- [x] Target-org resolution via shared sf-devbar env cache, with
      `productionAliases` user override and fail-closed default.
- [x] Session allow-memory via `pi.appendEntry`; survives /resume,
      /fork, /tree.
- [x] Audit trail persisted as session entries; shown by
      `/sf-guardrail audit`.
- [x] Headless fail-closed with `SF_GUARDRAIL_ALLOW_HEADLESS=1` escape.
- [x] Once-per-session prompt injection (sf-brain style) with user
      override at `<globalAgentDir>/sf-guardrail/SF_GUARDRAIL_PROMPT.md`.
- [x] `/sf-guardrail` command surface: status, list, audit, forget,
      install-preset.
- [x] Read-only config panel in the `/sf-pi` manager overlay.

## Next

- [ ] **Project-local overrides** — `.pi/sf-guardrail/rules.json`
      merged between bundled and global per the three-layer pattern in
      sf-slack preferences. Needs `cwd` plumbed through `loadConfig()`.
- [ ] **Tier 3 — regex/pattern confirms for anonymous Apex bodies**
      (`Database.delete`, `delete [SOQL]`, `Database.emptyRecycleBin`,
      raw DML keywords) and deploy flags (`--tests NoTestRun`,
      `--test-level NoTestRun`) on prod or UAT. Requires lightweight
      Apex token scanning to avoid false positives inside string
      literals.
- [ ] **`/sf-guardrail settings` interactive editor** — pi-native
      `SettingsList` overlay toggling `features.*` booleans,
      `productionAliases`, and `confirmTimeoutMs`. Persist to the
      global override file.
- [ ] **Per-rule toggles without JSON editing** — extend the settings
      overlay to enable/disable individual bundled rule ids. Writes
      minimal `{ id, enabled: false }` stubs to the override.
- [ ] **Events bus** — emit `sf-guardrail:blocked`,
      `sf-guardrail:confirmed`, `sf-guardrail:dangerous` so sf-devbar
      can show a live block count pill. Mirrors @aliou's event contract
      to ease migration for users who try both.

## Later

- [ ] **Optional LLM command explainer** — before showing the confirm
      dialog, call a small model to explain what the command will do,
      as an extra decision aid. Off by default (opt-in via config),
      latency-capped, degrades gracefully on timeout. Revisit once we
      have telemetry on accept-without-read rates.
- [ ] **Type-to-confirm for explicit production actions** — upgrade
      `action: "confirm"` rules to `action: "typeToConfirm"` that
      requires the user to retype the org alias. GitHub-delete-repo
      UX for actions with real blast radius. Needs a new `ctx.ui.input`
      path in `hitl.ts`.
- [ ] **Deploy-rehearsal enforcement** — require a preceding
      `sf project deploy validate` or `sf project deploy preview` in
      the same turn before allowing `deploy start`. Implementation
      reads recent bash `tool_call` entries from the session.
- [ ] **Path-access gate (opt-in)** — allow/ask/block access to paths
      outside cwd. Off by default because sfdx tooling legitimately
      touches `~/.sf/`, `~/.sfdx/`, and shared libs. Ship a sane
      default `allowedPaths` list for SF projects first.
- [ ] **Large-deploy warning** — informational-only: run
      `deploy preview --json` before `deploy start` and surface a
      warning if > N components change. Does not block.
- [ ] **API version drift warning** — cross-check the `--api-version`
      flag (if any) against the `[Salesforce Environment]` cached
      version and notify when they disagree.

## Non-goals (permanent)

- Not a code reviewer — sf-lsp owns Apex/LWC diagnostics.
- Not a secret scanner — CI's gitleaks owns commits.
- Not a generic sandbox/containment layer — pi itself, not an
  extension, owns that class of enforcement.
- No telemetry collection by default. Local audit log only.
