# SF Guardrail — Code Walkthrough

## What It Does

A Salesforce-aware safety layer on top of pi's `tool_call` hook. Three
feature tiers, all toggleable via the config:

1. **policies** — file-protection rules with three levels:
   - `noAccess` blocks `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`
   - `readOnly` blocks `write`, `edit`
   - `none` is an explicit no-op (useful for disabling a bundled rule
     without removing it — override the `id` with `protection: "none"`)

   Ships with bundled rules for `destructiveChanges*.xml`, `.forceignore`,
   `.sf/**`, `.sfdx/**` (with a `.sfdx/agents/**` carve-out for sf-agentscript
   preview sessions — the Salesforce-standard agent session layout), and
   dotenv-style secret files.

2. **commandGate** — dangerous-command patterns matched structurally
   against tokenized shell commands from `bash.command` or
   `herdr.run.command`, including commands later in simple shell chains.
   Ships with `rm -rf`, `sudo`, `chmod -R 777`, `chown -R`, `dd of=`,
   `mkfs.*`, `sf org delete`, explicit Salesforce CLI credential reveal
   commands, `SF_TEMP_SHOW_SECRETS=true`, and `git push --force`.
   Strictly validated OS temp-directory cleanup is auto-allowed and audited;
   other dangerous commands default to `confirm` behavior and prompt via
   `ctx.ui.select` (Allow once / Allow for this session / Block). Individual
   rules can be set to `off`, `confirm`, or `hard block` in settings.

3. **orgAwareGate** — shell-command rules that fire only when the resolved
   target-org type matches. Explicit non-default target aliases get a bounded,
   cached, in-process org lookup before a guessed-production prompt; lookup
   failure still fails closed. Ships with four production-only rules:
   - `sf project deploy start | resume | quick` (recognized validate,
     preview, report, check-only, and dry-run rehearsals are allowed)
   - `sf apex run`
   - `sf data delete | update | upsert | import`
   - `sf org api --method DELETE | PATCH | PUT`

Plus:

- **promptInjection** — once-per-session sf-brain-style kernel telling
  the LLM which categories are gated and which rehearsal patterns to
  prefer (`deploy validate`, `--check-only`, `Savepoint` + `rollback`).
- **Session allow-memory** — "Allow for this session" persists via
  `pi.appendEntry` so `/resume` and `/fork` inherit the allowance. Org-aware
  allows use a safety envelope (rule + resolved org + command family) instead
  of an exact command string where that reduces repeat prompts safely.
- **Session-scoped approvals** — confirm prompts keep three choices; the
  middle choice allows the same Safety Envelope for the current session path.
  Session approvals are auditable and can be cleared with `/sf-guardrail forget`.
- **Audit trail** — every decision (auto-allow, allow, session allow, block,
  timeout, cancel, headless-pass) is persisted as a session entry. Inspect with
  `/sf-guardrail audit`.
- **Headless mode** — fail-closed by default; set
  `SF_GUARDRAIL_ALLOW_HEADLESS=1` to let gated calls through with an
  audit warning when there is no TUI.

## Runtime Flow

```
Extension loads
  ├─ session_start    → hydrate session allow-memory from entries
  ├─ session_tree     → rehydrate after tree navigation
  ├─ before_agent_start
  │    ├─ prompt entry already in session → skip
  │    └─ features.promptInjection on     → inject rule-derived guidance
  │                                        as a hidden custom message
  └─ tool_call
       ├─ guardrail disabled                             → pass through
       ├─ policies hit + protection blocks this tool     → { block: true, reason }, audit
       ├─ commandGate hit (safe temp cleanup)             → pass through, audit as allow_auto
       ├─ commandGate hit (allow)                         → pass through
       ├─ commandGate hit (autoDeny)                      → { block }, audit
       ├─ commandGate hit (confirm) OR orgAwareGate hit   →
       │      previously granted for this session         → pass through, audit as allow_session
       │      interactive                                 → ctx.ui.select (Allow once / Allow for session / Block)
       │      headless + env opt-in                       → pass through, audit as headless_pass
       │      headless + no opt-in                        → { block }, audit as headless_block
       └─ no rule matched                                 → pass through
```

## Config Layers

Bundled defaults live in `SF_GUARDRAIL_DEFAULTS.json` next to `index.ts`.
Routine Guardrail Preferences live in Pi's global settings file under
`sfPi.guardrail` (typically `~/.pi/agent/settings.json`). These cover feature
toggles, confirmation timeout, production aliases, and bundled-rule behavior
(`off`, `confirm`, or `block`).

Advanced rule overrides remain in `<globalAgentDir>/sf-guardrail/rules.json`
(typically `~/.pi/agent/sf-guardrail/rules.json`). Use that file only for
custom patterns or full bundled-rule replacement by stable rule `id`.

Effective config is resolved in this order: bundled defaults, advanced override
JSON, then Pi settings for routine preferences. Project-local guardrail
weakening remains deferred — see `ROADMAP.md`.

## Commands

- `/sf-guardrail` → open status & controls panel in UI; status summary in no-UI mode
- `/sf-guardrail list` → full dump of active rules
- `/sf-guardrail audit` → up to 50 recent decisions from the session
- `/sf-guardrail grants` → list legacy persisted approval grants, if any
- `/sf-guardrail settings` → compatibility help that points to `/sf-pi` →
  SF Guardrail → Settings, where routine preferences are edited
- `/sf-guardrail aliases` → edit aliases that should be treated as production;
  saved to Pi settings
- `/sf-guardrail power-tool` → set every rule to `confirm` in Pi settings
- `/sf-guardrail strict` → hard-block secret, credential, and CLI-state rules;
  set other rules to `confirm` in Pi settings
- `/sf-guardrail forget` → revoke session allow-memory for this branch and clear
  legacy persisted approval grants for the current project
- `/sf-guardrail install-preset` → write bundled defaults to the advanced
  override file for expert customization

## Architecture References

SF Guardrail is intentionally a **Safety Mediator**, not a general policy
engine. The canonical terms live in `CONTEXT.md`; the redesign plan lives in
`REDESIGN.md`; stable trade-offs are recorded in repo ADRs, especially:

- ADR 0004 — fail-closed guardrail behavior
- ADR 0033 — safety mediator posture
- ADR 0034 — Safety Envelope approvals
- ADR 0035 — Safety Kernel seam
- ADR 0036 — Approval Ledger seam
- ADR 0037 — rule-derived guidance
- ADR 0038 — pi-native preferences with advanced rule overrides
- ADR 0039 — no LLM tools
- ADR 0040 — workflow rehearsals stay advisory
- ADR 0041 — project-local overrides are deferred
- ADR 0042 — session-scoped approval envelopes
- ADR 0043 — detected Salesforce org type is the classification source
- ADR 0044 — Power Tool mode defaults to confirmable actions
- ADR 0046 — per-rule behavior is `off`, `confirm`, or `hard block`
- ADR 0047 — settings use a section chooser (superseded by ADR 0049)
- ADR 0049 — routine preferences live in Pi settings and the Manager Surface

## Behavior Matrix

| Event              | Condition                               | Result                                           |
| ------------------ | --------------------------------------- | ------------------------------------------------ |
| session_start      | —                                       | Hydrate allow-memory from entries                |
| session_tree       | —                                       | Rehydrate allow-memory from new branch           |
| before_agent_start | prompt entry already in session         | Skip                                             |
| before_agent_start | features.promptInjection on, first call | Inject hidden kernel message                     |
| tool_call          | guardrail disabled                      | Pass through                                     |
| tool_call          | policies protection blocks tool         | `{ block: true, reason }`, audit                 |
| tool_call          | commandGate safe temp cleanup           | Pass through, audit as allow_auto                |
| tool_call          | commandGate allowedPatterns             | Pass through                                     |
| tool_call          | commandGate autoDenyPatterns            | `{ block }`, audit                               |
| tool_call          | `herdr.run` command matches a gate      | same confirmation path as `bash`                 |
| tool_call          | previously allowed (session memory)     | Pass through, audit as allow_session             |
| tool_call          | interactive confirmation                | `ctx.ui.select`, status/notify, audit per choice |
| tool_call          | headless + env opt-in                   | Pass through, audit as headless_pass             |
| tool_call          | headless + no env opt-in                | `{ block }`, audit as headless_block             |
| /sf-guardrail      | UI available                            | Open status & controls panel                     |
| /sf-guardrail      | no UI                                   | Show status summary                              |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-guardrail/
  lib/
    approval-detail.ts      ← implementation module
    approval-ledger.ts      ← implementation module
    approval-scope.ts       ← implementation module
    bash-ast.ts             ← implementation module
    command-gate.ts         ← implementation module
    command-risk-gate.ts    ← implementation module
    config-panel.ts         ← implementation module
    config.ts               ← implementation module
    extension-doctor.ts     ← implementation module
    file-policy-gate.ts     ← implementation module
    fingerprint.ts          ← implementation module
    guardrail-settings.ts   ← implementation module
    guidance.ts             ← implementation module
    hitl.ts                 ← implementation module
    install-preset.ts       ← implementation module
    org-aware-gate.ts       ← implementation module
    org-aware-risk-gate.ts  ← implementation module
    org-context.ts          ← implementation module
    policies.ts             ← implementation module
    preferences-panel.ts    ← implementation module
    preferences.ts          ← implementation module
    production-aliases-panel.ts← implementation module
    prompt-injection.ts     ← implementation module
    rule-behavior.ts        ← implementation module
    safety-envelope.ts      ← implementation module
    safety-kernel.ts        ← implementation module
    safety-subject.ts       ← implementation module
    status.ts               ← implementation module
    temp-cleanup.ts         ← implementation module
    types.ts                ← implementation module
  tests/
    approval-detail.test.ts ← unit / smoke test
    approval-ledger.test.ts ← unit / smoke test
    approval-scope.test.ts  ← unit / smoke test
    bash-ast.test.ts        ← unit / smoke test
    command-gate.test.ts    ← unit / smoke test
    command-risk-gate.test.ts← unit / smoke test
    config.test.ts          ← unit / smoke test
    file-policy-gate.test.ts← unit / smoke test
    guidance.test.ts        ← unit / smoke test
    hitl.test.ts            ← unit / smoke test
    hook-order.test.ts      ← unit / smoke test
    org-aware-risk-gate.test.ts← unit / smoke test
    org-context.test.ts     ← unit / smoke test
    policies.test.ts        ← unit / smoke test
    preferences.test.ts     ← unit / smoke test
    prompt-injection.test.ts← unit / smoke test
    rule-behavior.test.ts   ← unit / smoke test
    safety-envelope.test.ts ← unit / smoke test
    safety-kernel-contract.test.ts← unit / smoke test
    safety-kernel.test.ts   ← unit / smoke test
    safety-subject.test.ts  ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  ROADMAP.md                ← extension-specific phased roadmap
  SF_GUARDRAIL_DEFAULTS.json← supporting file
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run: `npm test`

Covered by unit tests:

- Tokenizer handles quoting, escapes, and pipeline terminators.
- AST matcher supports alternatives, leading flags, `flagIn` constraints,
  and `--flag=value` shorthand.
- Target-org extraction prefers `-o` over `--target-org`, returns
  undefined when absent.
- Glob compiler: `**` crosses slashes, `*` does not; dots are escaped.
- `matchPath` routes basename patterns vs full-path patterns correctly,
  honors `allowedPatterns`, picks strongest protection when rules
  overlap, and respects `enabled: false`.
- `evaluateCommand` matches multi-word patterns only as consecutive
  tokens (so `echo "sf org delete"` does not misfire), single-word
  patterns as individual tokens, checks simple shell chains, and
  short-circuits on allowed/autoDeny.
- Strict temp cleanup validation only auto-allows literal, single-target
  `rm -rf` / `rm -fr` commands under the real OS temp directory.
- `resolveOrgContext` prefers `-o` over default alias, honors
  `productionAliases`, resolves explicit aliases through a bounded cached
  lookup when needed, and fails closed to "production" on unknown aliases.
- Safety Subject normalization covers file tools, `bash.command`, and
  `herdr.run.command`.
- Safety Kernel characterization tests preserve end-to-end decisions for
  protected files, dangerous commands, org-aware gates, Herdr mediation,
  and safe temp cleanup.
- Safety Envelope builders preserve exact-command, production deploy, and
  non-production org-delete approval coverage.
- Approval Ledger tests cover audit entries, session approvals, revocation,
  legacy persisted grant rendering, and clearing.
- Rule-derived guidance reflects the effective config and preserves the
  user override prompt path.
- Pi-native preferences are stored under `sfPi.guardrail`, surfaced from the
  SF Pi Manager config panel, and preserve advanced JSON overrides.
- Envelope-first HIL detail renders risk gate, subject, target org, approval
  coverage, session duration, and advisory recovery guidance.
- Safety Kernel contract tests produce the right decision for representative
  `read`/`write`/`bash`/`herdr.run` tool calls with the bundled config.
- Config loader parses bundled defaults, merges user override by id,
  disables bundled rules via `enabled: false`, and falls back silently
  on malformed JSON.

## Troubleshooting

**All production confirms are firing on my sandbox:**

- Run `/sf-guardrail audit` first. Recent entries include whether the org
  type was resolved from cache, lookup, `productionAliases`, or guessed. If the
  entry is guessed, run `sf org display -o <alias> --json` and confirm the org
  is authenticated and reports a non-production type. If the alias still cannot
  be resolved, run `/sf-devbar refresh` or restart pi. `productionAliases` is
  only for aliases you want treated as production; do not add sandbox/scratch
  aliases there.

**I cannot write to `destructiveChanges.xml` even though my rule is supposed to be off:**

- Override by id: add the rule with `"enabled": false` to
  `~/.pi/agent/sf-guardrail/rules.json`. Removing the entry from your
  override file is not enough — the bundled rule is still merged in
  unless you explicitly disable it.

**Headless CI fails with "Blocked by sf-guardrail in headless mode":**

- Set `SF_GUARDRAIL_ALLOW_HEADLESS=1` in the CI env. This logs a
  headless_pass audit entry but lets the call through. Prefer a CI
  role/alias that is not marked `production` as a first step.

**`/sf-guardrail audit` is empty after /resume:**

- Decisions are scoped to the session file. `/resume` into a different
  session file will show that file's history. Use `/sf-guardrail`
  (default view) to see the current session's summary.
