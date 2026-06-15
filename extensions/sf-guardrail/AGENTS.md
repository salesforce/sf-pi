# AGENTS.md — sf-guardrail

Agent rules for editing this extension. Read this before any change.
Repo-level rules still apply; see root `AGENTS.md`.

## Read first

1. `extensions/sf-guardrail/README.md` — feature list and flow diagram
2. `extensions/sf-guardrail/CONTEXT.md` — canonical safety language
3. `extensions/sf-guardrail/REDESIGN.md` — simplification plan and target architecture
4. `extensions/sf-guardrail/ROADMAP.md` — what is explicitly out of MVP
5. `extensions/sf-guardrail/index.ts` — event wiring
6. `extensions/sf-guardrail/lib/types.ts` — schema boundary
7. The specific `lib/*.ts` module you're editing

## File map (what lives where)

One-file-per-concern split:

| Responsibility                       | File                                                |
| ------------------------------------ | --------------------------------------------------- |
| Event wiring + command handler       | `index.ts`                                          |
| Schema + persisted entry types       | `lib/types.ts`                                      |
| Safety decision seam                 | `lib/safety-kernel.ts`                              |
| Safety subject normalization         | `lib/safety-subject.ts`                             |
| Safety envelope construction         | `lib/safety-envelope.ts`                            |
| Rule behavior resolution             | `lib/rule-behavior.ts`                              |
| Bundled + override config loader     | `lib/config.ts`                                     |
| Shell tokenizer + AST matcher        | `lib/bash-ast.ts`                                   |
| File-policy risk gate                | `lib/file-policy-gate.ts`                           |
| File-path policy matcher             | `lib/policies.ts`                                   |
| Command risk gate                    | `lib/command-risk-gate.ts`                          |
| Dangerous-command matcher            | `lib/command-gate.ts`                               |
| Target-org resolution                | `lib/org-context.ts`                                |
| Org-aware risk gate                  | `lib/org-aware-risk-gate.ts`                        |
| Production-only rule matcher         | `lib/org-aware-gate.ts`                             |
| Confirmation dialog wrapper          | `lib/hitl.ts`                                       |
| Approval dialog detail formatter     | `lib/approval-detail.ts`                            |
| Approval memory seam                 | `lib/approval-ledger.ts`                            |
| Safety Envelope fingerprints         | `lib/fingerprint.ts`                                |
| Manager-backed Guardrail Preferences | `lib/config-panel.ts` + `lib/guardrail-settings.ts` |
| Settings panel model helpers         | `lib/config-panel-model.ts`                         |
| Common preference descriptors        | `lib/preferences.ts`                                |
| Production aliases editor            | `lib/production-aliases-panel.ts`                   |
| `/sf-guardrail install-preset`       | `lib/install-preset.ts`                             |
| Rule-derived agent guidance          | `lib/guidance.ts`                                   |
| Kernel body loader + override        | `lib/prompt-injection.ts`                           |
| Formatters for `/sf-guardrail`       | `lib/status.ts`                                     |
| SF Pi Manager settings adapter       | `lib/config-panel.ts`                               |

## Conventions

1. **Types live at the boundary.** `lib/types.ts` is the only place where
   the config schema and decision shapes are defined. Every other module
   imports its types from there.
2. **Pure evaluators.** `safety-kernel.ts`, `safety-subject.ts`,
   `safety-envelope.ts`, `rule-behavior.ts`, `guidance.ts`,
   `file-policy-gate.ts`, `policies.ts`, `command-gate.ts`,
   `org-aware-gate.ts` do not touch `ctx`, `pi`, or any pi API.
   They take config + input, return decisions.
   Side effects (prompts, appendEntry, notify) happen only in `index.ts`,
   `hitl.ts`, and approval-ledger/UI adapters.
3. **Fail-closed is the rule.** Any ambiguity — unknown org type,
   unreadable override, tokenizer failure, timeout — must default to
   blocking. The command-gate substring fallback for tokenizer failure
   is the sole exception: it prefers false-positive over false-negative
   because that error direction is safer.
4. **No new `tool_call` side effects without audit.** Every decision path
   must call `recordDecision(...)` through `lib/approval-ledger.ts` so
   `/sf-guardrail audit` stays truthful.
5. **No runtime deps.** Keep the tokenizer, globber, and matchers
   dependency-free. If we ever need a real shell AST, prefer a well-
   maintained package (`shell-quote`) and pin the version, rather than
   rolling another one.

## Editing the bundled ruleset

- `SF_GUARDRAIL_DEFAULTS.json` is the source of truth for rule behavior.
- Adding a new bundled rule means:
  1. Add the rule to `SF_GUARDRAIL_DEFAULTS.json` with a stable id.
  2. Update `tests/config.test.ts` to assert the id ships.
  3. Update `tests/safety-kernel-contract.test.ts` with a match + non-match case.
  4. Document the rule in `README.md` under the relevant feature tier.
- Never add a rule whose id collides with a rule already in the override
  merge path (bundled ids are stable API; renaming them breaks user
  overrides).

## HITL invariants

- Every gated path ends in one of the `DecisionOutcome` values in
  `lib/types.ts` (`allow_once`, `allow_session`, `allow_persisted`,
  `allow_auto`, `block`, `timeout`, `cancel`, `hard_block`,
  `headless_pass`, `headless_block`). Anything new needs plumb-through
  in `approval-ledger.ts` and `status.ts`.
- Headless escape hatch is an env var only. No config-file setting to
  "always allow headless" — that would hide behavior from the user.
- Timeouts equal block. User-facing copy may say "approval expired", but
  expired approval still fails closed. Never auto-accept on timeout.

## Non-goals

- Not a code reviewer — sf-lsp covers diagnostics.
- Not a secret scanner — gitleaks handles that in CI.
- No path-access gate (allow/ask/block outside cwd). sfdx projects touch
  `~/.sf/`, `~/.sfdx/`, and shared libs routinely; a blanket path gate
  would be hostile. Revisit as opt-in later.
- No opt-in LLM command explainer in MVP. It is a legitimate follow-up
  once we have telemetry on how often users accept without context.
- No project-local guardrail preference layer in MVP. Routine preferences
  are global Pi settings under `sfPi.guardrail`; project-local weakening is
  deferred with project-local rule overrides. Adding either means plumbing
  trust-aware `cwd` through settings resolution and recording a new ADR.
