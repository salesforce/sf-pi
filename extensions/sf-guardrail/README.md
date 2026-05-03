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
   `.sf/**`, `.sfdx/**`, and dotenv-style secret files.

2. **commandGate** — dangerous-command patterns matched structurally
   against the tokenized bash command. Ships with `rm -rf`, `sudo`,
   `sf org delete`, `git push --force`. Prompts user confirmation via
   `ctx.ui.select` (Allow once / Allow for this session / Block).

3. **orgAwareGate** — bash rules that fire only when the resolved
   target-org type matches. Ships with four production-only rules:
   - `sf project deploy start | resume`
   - `sf apex run`
   - `sf data delete | update | upsert | import`
   - `sf org api --method DELETE | PATCH | PUT`

Plus:

- **promptInjection** — once-per-session sf-brain-style kernel telling
  the LLM which categories are gated and which rehearsal patterns to
  prefer (`deploy validate`, `--check-only`, `Savepoint` + `rollback`).
- **Session allow-memory** — "Allow for this session" persists via
  `pi.appendEntry` so `/resume` and `/fork` inherit the allowance. Clear
  it with `/sf-guardrail forget`.
- **Audit trail** — every decision (allow, block, headless-pass) is
  persisted as a session entry. Inspect with `/sf-guardrail audit`.
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
       ├─ commandGate hit (allow)                         → pass through
       ├─ commandGate hit (autoDeny)                      → { block }, audit
       ├─ commandGate hit (confirm) OR orgAwareGate hit   →
       │      previously granted for this session         → pass through, audit as allow_session
       │      interactive                                 → ctx.ui.select (Allow once / Allow session / Block)
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

- `/sf-guardrail` → status summary + last 5 decisions
- `/sf-guardrail list` → full dump of active rules
- `/sf-guardrail audit` → up to 50 recent decisions from the session
- `/sf-guardrail forget` → clear session allow-memory (entries remain
  on disk; `/reload` will restore them)
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
synchronously and fail-closed (treat as production) when the alias is
unknown. Users who frequently target a non-default production alias can
list it in `productionAliases` to override detection.

### Why hand-rolled tokenizer instead of a shell parser package?

The only three things we extract from bash commands are the head word,
positional subcommand arguments, and `-o`/`--target-org` values. The
popular parser packages either have ancient dependencies (`shell-parse`,
last published 2012) or ship more features than a `tool_call` hook
should be pulling in. 60 lines of tokenizer covers the shapes we care
about, keeps the dependency graph at zero, and is documented in
`lib/bash-ast.ts`. Exotic shell syntax (heredocs, process substitution)
falls back to a whole-string substring check in the command gate so we
never silently miss a dangerous pattern.

### Why "Allow for this session" persists via `pi.appendEntry`?

Because `/resume` and `/fork` inherit session entries, the allowance
survives session replacement — the user only has to grant once per
investigation. `/sf-guardrail forget` drops the in-memory cache for the
current turn so hostile agent loops can't bypass a prior confirmation.

## Behavior Matrix

| Event              | Condition                               | Result                                 |
| ------------------ | --------------------------------------- | -------------------------------------- |
| session_start      | —                                       | Hydrate allow-memory from entries      |
| session_tree       | —                                       | Rehydrate allow-memory from new branch |
| before_agent_start | prompt entry already in session         | Skip                                   |
| before_agent_start | features.promptInjection on, first call | Inject hidden kernel message           |
| tool_call          | guardrail disabled                      | Pass through                           |
| tool_call          | policies protection blocks tool         | `{ block: true, reason }`, audit       |
| tool_call          | commandGate allowedPatterns             | Pass through                           |
| tool_call          | commandGate autoDenyPatterns            | `{ block }`, audit                     |
| tool_call          | previously allowed (session memory)     | Pass through, audit as allow_session   |
| tool_call          | interactive confirmation                | `ctx.ui.select`, audit per choice      |
| tool_call          | headless + env opt-in                   | Pass through, audit as headless_pass   |
| tool_call          | headless + no env opt-in                | `{ block }`, audit as headless_block   |

## File Structure

```
extensions/sf-guardrail/
  index.ts                        ← event wiring, /sf-guardrail command
  manifest.json                   ← metadata (source of truth for catalog)
  README.md                       ← this file
  AGENTS.md                       ← per-extension editing rules
  ROADMAP.md                      ← phased plan (Tier 3, project overrides, etc.)
  SF_GUARDRAIL_DEFAULTS.json      ← bundled rule set
  SF_GUARDRAIL_PROMPT.md          ← kernel injected into the system prompt
  lib/
    types.ts                      ← config schema + decision model
    config.ts                     ← bundled + override loader, merge by id
    bash-ast.ts                   ← tokenizer + ShellAstMatch evaluator
    policies.ts                   ← file-path matcher, glob+regex
    command-gate.ts               ← dangerous-command matcher
    org-context.ts                ← resolve target-org type from env cache
    org-aware-gate.ts             ← production-only bash rules
    classify.ts                   ← orchestrator: event → decision
    hitl.ts                       ← ctx.ui.select wrapper with headless
    allowlist.ts                  ← session allow-memory (pi.appendEntry)
    audit.ts                      ← decision log persistence
    install-preset.ts             ← /sf-guardrail install-preset
    prompt-injection.ts           ← kernel body loader + override
    status.ts                     ← pure formatters for /sf-guardrail output
    config-panel.ts               ← sf-pi manager read-only status panel
  tests/
    smoke.test.ts
    bash-ast.test.ts
    policies.test.ts
    command-gate.test.ts
    config.test.ts
    org-context.test.ts
    classify.test.ts
```

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
  patterns as individual tokens, and short-circuits on
  allowed/autoDeny.
- `resolveOrgContext` prefers `-o` over default alias, honors
  `productionAliases`, and fails closed to "production" on unknown
  aliases.
- `classify` end-to-end produces the right decision for representative
  `read`/`write`/`bash` tool calls with the bundled config.
- Config loader parses bundled defaults, merges user override by id,
  disables bundled rules via `enabled: false`, and falls back silently
  on malformed JSON.

## Troubleshooting

**All production confirms are firing on my sandbox:**

- The env cache couldn't resolve your org type. Run
  `sf org display -o <alias> --json` and confirm `orgType` is not
  `unknown`. If it reports `sandbox`, then sf-devbar's cache is stale —
  run `/sf-devbar refresh` or restart pi. If Salesforce genuinely
  reports `unknown`, list your non-production aliases in a user
  override under `productionAliases: []`, or disable the
  `sf-*-prod` rules you don't want via `{ "id": "...", "enabled": false }`.

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
