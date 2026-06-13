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
   other dangerous commands prompt via `ctx.ui.select` (Allow once / Allow
   for this session / Block).

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
- **Persisted approval grants** — grant-eligible prompts keep three choices; the
  middle choice becomes a scoped TTL grant (for example, allow verified
  production deploys in this project for 60 minutes, or allow deleting one
  verified non-production org target for 30 minutes). Grants are user-local,
  project-scoped, auditable, and ignored in headless mode unless the explicit
  headless escape hatch is set.
- **Audit trail** — every decision (auto-allow, allow, persisted allow, block,
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
  │    └─ features.promptInjection on     → inject SF_GUARDRAIL_PROMPT.md
  │                                        as a hidden custom message
  └─ tool_call
       ├─ guardrail disabled                             → pass through
       ├─ policies hit + protection blocks this tool     → { block: true, reason }, audit
       ├─ commandGate hit (safe temp cleanup)             → pass through, audit as allow_auto
       ├─ commandGate hit (allow)                         → pass through
       ├─ commandGate hit (autoDeny)                      → { block }, audit
       ├─ commandGate hit (confirm) OR orgAwareGate hit   →
       │      previously granted for this session         → pass through, audit as allow_session
       │      active persisted grant + UI/headless opt-in  → pass through, audit as allow_persisted
       │      interactive                                 → ctx.ui.select (Allow once / scoped allow / Block)
       │      headless + env opt-in                       → pass through, audit as headless_pass
       │      headless + no opt-in                        → { block }, audit as headless_block
       └─ no rule matched                                 → pass through
```

## Config Layers

Bundled defaults live in `SF_GUARDRAIL_DEFAULTS.json` next to `index.ts`.
A user override file at `<globalAgentDir>/sf-guardrail/rules.json`
(typically `~/.pi/agent/sf-guardrail/rules.json`) merges over the
bundled defaults by rule `id` — last wins. To disable a bundled rule
without removing it, override with `{ "id": "...", "enabled": false }`.

Project-level overrides (`.pi/sf-guardrail/rules.json`) are on the
roadmap — see `ROADMAP.md`.

## Commands

- `/sf-guardrail` → open status & controls panel in UI; status summary in no-UI mode
- `/sf-guardrail list` → full dump of active rules
- `/sf-guardrail audit` → up to 50 recent decisions from the session
- `/sf-guardrail grants` → list active persisted approval grants for the current project
- `/sf-guardrail forget` → revoke session allow-memory for this branch and clear
  active persisted approval grants for the current project
- `/sf-guardrail install-preset` → write bundled defaults to the user
  override file, with per-rule reconciliation when the file already
  exists

## Key Architecture Decisions

### Why standalone, not a wrapper around `@aliou/pi-guardrails`?

`@aliou/pi-guardrails` is a well-designed generic safety extension but
cannot see Salesforce context: it can't distinguish
`sf project deploy start -o sandbox` from `sf project deploy start -o prod`
because it doesn't know what the alias resolves to. The design here
keeps the good ideas — glob+regex policies, three-level protection,
AST-matched dangerous commands, config layering by id — and adds the
missing piece: `whenOrgType` filters that read the shared sf-devbar
environment cache and map aliases to org types without a CLI call on
the hot path.

### Why read the env cache instead of calling `sf` on every tool_call?

`sf org display` takes tens to hundreds of milliseconds and can stall
on an expired token. sf-devbar already populates the shared cache at
`session_start`. `tool_call` is the hot path; we read the cache
synchronously first and only run a bounded in-process lookup when an explicit
non-default alias would otherwise be treated as guessed production. Lookup
failure still fails closed. Users who frequently target a non-default
production alias can list it in `productionAliases` to override detection.

### Why mediate `herdr.run` like `bash`?

Herdr Workflow Mode lets agents run commands in other panes without blocking the
main Pi pane. Those pane commands are still shell commands, so they must not
become a safety bypass around dangerous-command confirmation or production-org
confirmation. `sf-guardrail` therefore extracts commands from both
`bash.command` and `herdr.run.command`, evaluates them through the same gates,
and records the original tool name in the audit trail.

Only `herdr.run` is mediated in v1. Pane reads, watches, waits, splits, tab
creation, focus changes, and low-level `herdr.send` are not complete command
submissions and stay outside this command-safety seam.

### Why hand-rolled tokenizer instead of a shell parser package?

The only three things we extract from bash commands are the head word,
positional subcommand arguments, and `-o`/`--target-org` values. The
popular parser packages either have ancient dependencies (`shell-parse`,
last published 2012) or ship more features than a `tool_call` hook
should be pulling in. A small tokenizer/splitter covers the shapes we care
about, keeps the dependency graph at zero, and is documented in
`lib/bash-ast.ts`. Exotic shell syntax (heredocs, process substitution)
falls back to the conservative prompt/block paths rather than silent allow.

### Why "Allow for this session" persists via `pi.appendEntry`?

Because `/resume` and `/fork` inherit session entries, the allowance
survives session replacement — the user only has to grant once per
investigation. `/sf-guardrail forget` appends a native Pi session-entry
revocation marker so `/reload` and tree navigation do not restore older
session allows, and it also clears active persisted grants for the current
project.

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
    allowlist.ts            ← implementation module
    approval-grants.ts      ← implementation module
    approval-scope.ts       ← implementation module
    audit.ts                ← implementation module
    bash-ast.ts             ← implementation module
    classify.ts             ← implementation module
    command-gate.ts         ← implementation module
    config-panel.ts         ← implementation module
    config.ts               ← implementation module
    extension-doctor.ts     ← implementation module
    hitl.ts                 ← implementation module
    install-preset.ts       ← implementation module
    org-aware-gate.ts       ← implementation module
    org-context.ts          ← implementation module
    policies.ts             ← implementation module
    prompt-injection.ts     ← implementation module
    status.ts               ← implementation module
    temp-cleanup.ts         ← implementation module
    types.ts                ← implementation module
  tests/
    allowlist.test.ts       ← unit / smoke test
    approval-grants.test.ts ← unit / smoke test
    approval-scope.test.ts  ← unit / smoke test
    bash-ast.test.ts        ← unit / smoke test
    classify.test.ts        ← unit / smoke test
    command-gate.test.ts    ← unit / smoke test
    config.test.ts          ← unit / smoke test
    hitl.test.ts            ← unit / smoke test
    hook-order.test.ts      ← unit / smoke test
    org-context.test.ts     ← unit / smoke test
    policies.test.ts        ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  ROADMAP.md                ← extension-specific phased roadmap
  SF_GUARDRAIL_DEFAULTS.json← supporting file
  SF_GUARDRAIL_PROMPT.md    ← supporting file
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
- `classify` end-to-end produces the right decision for representative
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
