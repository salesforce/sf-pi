# AGENTS.md — sf-guardrail

Agent rules for editing this extension. Read this before any change.
Repo-level rules still apply; see root `AGENTS.md`.

## Read first

1. `extensions/sf-guardrail/README.md` — feature list and flow diagram
2. `extensions/sf-guardrail/ROADMAP.md` — what is explicitly out of MVP
3. `extensions/sf-guardrail/index.ts` — event wiring
4. `extensions/sf-guardrail/lib/types.ts` — schema boundary
5. The specific `lib/*.ts` module you're editing

## File map (what lives where)

One-file-per-concern split:

| Responsibility                   | File                      |
| -------------------------------- | ------------------------- |
| Event wiring + command handler   | `index.ts`                |
| Schema + persisted entry types   | `lib/types.ts`            |
| Bundled + override config loader | `lib/config.ts`           |
| Shell tokenizer + AST matcher    | `lib/bash-ast.ts`         |
| File-path policy matcher         | `lib/policies.ts`         |
| Dangerous-command matcher        | `lib/command-gate.ts`     |
| Target-org resolution            | `lib/org-context.ts`      |
| Production-only rule matcher     | `lib/org-aware-gate.ts`   |
| Classification orchestrator      | `lib/classify.ts`         |
| Confirmation dialog wrapper      | `lib/hitl.ts`             |
| Session allow-memory             | `lib/allowlist.ts`        |
| Decision audit trail             | `lib/audit.ts`            |
| `/sf-guardrail install-preset`   | `lib/install-preset.ts`   |
| Kernel body loader + override    | `lib/prompt-injection.ts` |
| Formatters for `/sf-guardrail`   | `lib/status.ts`           |
| Read-only config panel           | `lib/config-panel.ts`     |

## Conventions

1. **Types live at the boundary.** `lib/types.ts` is the only place where
   the config schema and decision shapes are defined. Every other module
   imports its types from there.
2. **Pure evaluators.** `policies.ts`, `command-gate.ts`,
   `org-aware-gate.ts`, `classify.ts` do not touch `ctx`, `pi`, or any
   pi API. They take config + input, return decisions. Side effects
   (prompts, appendEntry, notify) happen only in `index.ts` and `hitl.ts`.
3. **Fail-closed is the rule.** Any ambiguity — unknown org type,
   unreadable override, tokenizer failure, timeout — must default to
   blocking. The command-gate substring fallback for tokenizer failure
   is the sole exception: it prefers false-positive over false-negative
   because that error direction is safer.
4. **No new `tool_call` side effects without audit.** Every decision path
   must call `record(...)` in `lib/audit.ts` so `/sf-guardrail audit`
   stays truthful.
5. **No runtime deps.** Keep the tokenizer, globber, and matchers
   dependency-free. If we ever need a real shell AST, prefer a well-
   maintained package (`shell-quote`) and pin the version, rather than
   rolling another one.

## Editing the bundled ruleset

- `SF_GUARDRAIL_DEFAULTS.json` is the source of truth for rule behavior.
- Adding a new bundled rule means:
  1. Add the rule to `SF_GUARDRAIL_DEFAULTS.json` with a stable id.
  2. Update `tests/config.test.ts` to assert the id ships.
  3. Update `tests/classify.test.ts` with a match + non-match case.
  4. Document the rule in `README.md` under the relevant feature tier.
- Never add a rule whose id collides with a rule already in the override
  merge path (bundled ids are stable API; renaming them breaks user
  overrides).

## HITL invariants

- Every gated path ends in exactly one of: `allow_once`, `allow_session`,
  `block`, `hard_block`, `headless_pass`, `headless_block`. That set
  is defined in `lib/types.ts` and anything new needs a plumb-through
  in `audit.ts` and `status.ts`.
- Headless escape hatch is an env var only. No config-file setting to
  "always allow headless" — that would hide behavior from the user.
- Timeouts equal block. Never auto-accept on timeout.

## Non-goals

- Not a code reviewer — sf-lsp covers diagnostics.
- Not a secret scanner — gitleaks handles that in CI.
- No path-access gate (allow/ask/block outside cwd). sfdx projects touch
  `~/.sf/`, `~/.sfdx/`, and shared libs routinely; a blanket path gate
  would be hostile. Revisit as opt-in later.
- No opt-in LLM command explainer in MVP. It is a legitimate follow-up
  once we have telemetry on how often users accept without context.
- No project-local config layer in MVP (`.pi/sf-guardrail/rules.json`).
  Roadmap item. Adding it means plumbing `cwd` through `loadConfig()`
  and updating the merge to three layers.
