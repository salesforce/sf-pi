# sf-guardrail Roadmap

Phased plan for sf-guardrail after the safety-mediator redesign. Items here
are not promises — priority is the rough order.

## Shipped (MVP safety coverage)

- [x] Policies tier: `noAccess` / `readOnly` / `none`, glob + regex,
      allowedPatterns short-circuit, strongest-wins conflict resolution,
      `onlyIfExists` (default true).
- [x] Bundled rules for `destructiveChanges*.xml`, `.forceignore`,
      `.sf/**`, `.sfdx/**`, dotenv-style secret files, and
      `.sfdx/agents/**` carve-out.
- [x] Command gate: structural token matching for recursive deletion variants,
      permission/ownership changes, destructive git, pipe-to-shell,
      base64-to-shell, process/system disruption, container/cloud/database
      destruction, Salesforce CLI project/package/plugin/org/agent destructive
      operations, credential reveal commands, and commands later in simple shell
      chains.
- [x] Strict temp cleanup auto-allow for literal, single-target OS temp
      `rm -rf` / `rm -fr` cleanup with audit.
- [x] Org-aware gate: mutating `sf project deploy start|resume|quick`,
      `sf apex run`, `sf data (create|delete|update|upsert|import)`,
      `sf package install`, `sf agent activate|deactivate|publish`, and
      `sf org api --method DELETE|PATCH|PUT` — production only.
- [x] Target-org resolution via shared sf-devbar env cache plus bounded cached
      lookup for explicit aliases, with `productionAliases` user override and
      fail-closed default.
- [x] Session allow-memory via `pi.appendEntry`; survives /resume,
      /fork, /tree; `/sf-guardrail forget` writes a native session revocation
      marker so older allows do not restore.
- [x] Session-scoped Safety Envelope approvals for repeated risky actions in
      the current Pi session path.
- [x] Audit trail persisted as session entries; shown by
      `/sf-guardrail audit`.
- [x] Headless fail-closed with `SF_GUARDRAIL_ALLOW_HEADLESS=1` escape.
- [x] `/sf-guardrail` command surface: status, list, audit, grants, settings,
      aliases, forget.
- [x] SF Pi Manager config panel for status and routine Guardrail Preferences.

## Shipped (simplification/redesign slices)

- [x] Extension-specific `CONTEXT.md` with canonical safety language.
- [x] Redesign ADRs 0033–0041 and `REDESIGN.md` implementation plan.
- [x] Safety Kernel seam (`lib/safety-kernel.ts`) over current evaluation.
- [x] Safety Subject normalization (`lib/safety-subject.ts`).
- [x] Safety Envelope builder seam (`lib/safety-envelope.ts`).
- [x] Approval Ledger facade (`lib/approval-ledger.ts`).
- [x] Rule-derived agent guidance (`lib/guidance.ts`) replacing the bundled
      static prompt file while preserving the user override path.
- [x] Pi settings-backed Guardrail Preferences under `sfPi.guardrail`, with
      nested SF Pi Manager settings pages as the mutable settings surface.
- [x] `/sf-guardrail settings` compatibility help that redirects users to the
      Manager Surface instead of opening an extension-owned settings editor.
- [x] Envelope-first HIL detail copy (`lib/approval-detail.ts`).
- [x] Dedicated Safety Kernel risk gates for file policies, command risk, and
      org-aware operations (`file-policy-gate.ts`, `command-risk-gate.ts`,
      `org-aware-risk-gate.ts`).

## Next

- [x] Retired `classify.ts` compatibility wrapper; runtime and broad contract
      tests use `evaluateSafety`.
- [x] Deepened Approval Ledger internals by moving audit, session approval, and
      persisted-grant storage into `approval-ledger.ts` and deleting the old
      helper modules.
- [x] Protected org aliases editor via `/sf-guardrail aliases` and the nested
      Manager settings page.
- [x] Command-gate per-pattern behavior semantics and settings toggles.
- [x] Rule-only settings model; bulk posture presets removed in favor of per-rule behavior.
- [ ] **README user-facing cleanup follow-up** — keep detailed rationale in
      `CONTEXT.md`, `REDESIGN.md`, and ADRs; keep README focused on usage and
      troubleshooting.
- [ ] **Events bus** — emit `sf-guardrail:blocked`,
      `sf-guardrail:confirmed`, `sf-guardrail:dangerous` so sf-devbar can show
      a live block count pill.

## Later

- [ ] **Tier 3 — regex/pattern confirms for anonymous Apex bodies**
      (`Database.delete`, `delete [SOQL]`, `Database.emptyRecycleBin`, raw DML
      keywords) and deploy flags (`--tests NoTestRun`, `--test-level NoTestRun`)
      on prod or UAT. Requires lightweight Apex token scanning to avoid false
      positives inside string literals.
- [ ] **Optional LLM command explainer** — before showing the confirm dialog,
      call a small model to explain what the command will do, as an extra
      decision aid. Off by default, latency-capped, and degradable.
- [ ] **Type-to-confirm for explicit production actions** — upgrade selected
      `action: "confirm"` rules to require retyping the org alias for actions
      with real blast radius.
- [ ] **Project-local overrides / preferences** — project-local rule overrides
      and project-local guardrail weakening are deferred by ADR 0041 and ADR 0049. If added later, they must require trusted project context and stay
      subordinate to the Safety Mediator posture.
- [ ] **Deploy-rehearsal enforcement** — require a preceding
      `sf project deploy validate` or `sf project deploy preview` before
      production deploy. ADR 0040 keeps this advisory until a separate decision
      revisits the trade-off.
- [ ] **Path-access gate (opt-in)** — allow/ask/block access to paths outside
      cwd. Off by default because Salesforce tooling legitimately touches
      `~/.sf/`, `~/.sfdx/`, and shared libs.
- [ ] **Large-deploy warning** — informational-only: run deploy preview and
      surface a warning if more than N components change. Does not block.
- [ ] **API version drift warning** — cross-check `--api-version` flags against
      the cached `<sf_environment>` API version and notify when they disagree.

## Non-goals (permanent)

- Not a code reviewer — sf-lsp owns Apex/LWC diagnostics.
- Not a secret scanner — CI's secret scanning owns commits.
- Not a generic sandbox/containment layer — pi itself, not an extension, owns
  that class of enforcement.
- No LLM-callable guardrail tools — ADR 0039 keeps approvals under mediator and
  command/HIL surfaces.
- No telemetry collection by default. Local audit log only.
