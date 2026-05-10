# sf-agentscript

Single plugin owning the entire `.agent` developer loop — **agent-first** authoring,
local-first compile, AST-safe edits, live-org preview, and multi-turn regression
testing against the Salesforce Evaluation API. One npm dep
(`@salesforce/core`); no subprocess shelling on the hot path.

## What It Does

Six LLM-callable tools that close the **inspect → create → correct → self-recover** loop:

| Tool                  | What it does                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_compile` | Local-first compile via vendored `@agentscript/agentforce` SDK (~10 ms). Quick fixes carry `apply_via` pointing at `agentscript_mutate`.                                   |
| `agentscript_create`  | Scaffold new `.agent` + `bundle-meta.xml`. Validates locally before writing. Returns `next_steps`.                                                                         |
| `agentscript_inspect` | Walks the parsed AST and returns a navigable JSON graph (topics, subagents, variables, actions, line numbers, `@`-references). LLM uses it instead of re-reading the file. |
| `agentscript_mutate`  | AST-safe edits via `Document.mutateComponent` + `emit`; coordinate fallback for `apply_quick_fix`. Always re-compiles after writing.                                       |
| `agentscript_preview` | Live-org preview — `start` / `send` / `end` / `trace` / `cleanup`. Sessions land at `.sfdx/agents/<id>/sessions/<sid>/`. Streams progress on `send`.                       |
| `agentscript_eval`    | Multi-turn regression — `run` / `get_failure` / `trace` / `resolve_active`. Streams progress mid-flight. Hybrid result (inline failures small / `run_id` pointer big).     |

Plus an automatic **compile-on-save hook** that runs after every successful
`write` / `edit` of a `.agent` file and appends `LSP feedback:` to the tool result.

## Slash commands

```
/sf-agentscript                   Open status & controls panel
/sf-agentscript doctor            SDK + @salesforce/core + .sfdx/agents writability
/sf-agentscript check <file>      Manually compile a `.agent` file
/sf-agentscript eval <spec.json>  Run a multi-turn regression suite
  [--org <alias>] [--agent <api-name>] [--traces failed|all|off]
  [--concurrency N] [--prompt-chars N] [--verbose]
/sf-agentscript help              Show command usage
```

## Runtime Flow

```
edit/write a .agent file ──▶ on-save hook ──▶ agentscript_compile (auto, ~10ms)
                                                       │
                                                       ▼
agent loop (the four verbs):
  CREATE → INSPECT → CORRECT (mutate) → SELF-RECOVER
   │        │           │                      │
   │        │           │                      ├─ preview {start,send,end,trace,cleanup}
   │        │           │                      └─ eval {run,get_failure,trace,resolve_active}
   │        │           └─ on-save compile re-runs after every mutate
   │        └─ navigable graph: topics, subagents, variables, actions
   └─ scaffolds .agent + bundle-meta.xml from a job spec
```

Every API call goes through `@salesforce/core` `Connection.request` — same
auth context as the `sf` CLI, automatic token refresh, no subprocess fork.
SFAP host fallback (`api → test.api → dev.api` on 404) keeps sandbox
routing safe. 5xx-only retry with jittered exponential backoff.

## Diagnostics

`agentscript_compile action='check'` runs `parseAndLint()` + `compile()`
together through the SDK's `compileSource()` entry point. The returned
`diagnostics` array therefore includes:

- **parse / lint diagnostics** (e.g. unbalanced parens, misspelled
  modifiers, unterminated strings)
- **compile diagnostics** (e.g. `invalid-action-target`,
  `action-missing-input`, `linked-variable-missing-source`,
  `unused-variable`)

This is intentional: we surface every issue either pass detects so the
LLM (or human) sees the full picture even when the underlying compiler
is willing to tolerate some of them. The summary line emits a short
sample of diagnostic codes and line numbers —

```
❌ X.agent — 4 issue(s) (2E·2W), 4 fix(es) ready
  • [E] action-missing-input @ L42
  • [E] invalid-action-target @ L67
  • [W] unused-variable @ L11
  • [W] unused-variable @ L13
  …and 0 more in details.diagnostics
```

— enough for the LLM to decide whether to apply a quick fix, edit
manually, or keep digging without re-reading the full `diagnostics`
array. Errors are listed first, then warnings; severity-1 issues are
tagged `E`, severity-2 issues `W`.

## Behavior Matrix

| Trigger                                | Result                                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_start` / `session_shutdown`   | Reset assist state, drop cached `Connection`s                                                                                                               |
| `tool_result` (write/edit on `.agent`) | Compile in-process, append `LSP feedback:` block                                                                                                            |
| `agentscript_compile`                  | Same pipeline as on-save; quick fixes carry `apply_via`                                                                                                     |
| `agentscript_create`                   | Validate template locally before writing; refuse to overwrite without `overwrite: true`                                                                     |
| `agentscript_inspect`                  | One AST walk, JSON projection, line numbers 1-based                                                                                                         |
| `agentscript_mutate`                   | AST primary (`set_field` / `rename` / `apply_quick_fix`); refuses to mutate files with severity-1 errors; auto-recompiles                                   |
| `agentscript_preview start`            | Local-compile first; only hits `/authoring/scripts` on success                                                                                              |
| `agentscript_preview send`             | POST message, fetch trace inline, write to session store                                                                                                    |
| `agentscript_eval run`                 | Resolve `$active_*` if present → normalize (6 passes) → batch ≤ 5 tests → fan-out POST → HTML-decode → fetch traces (failed by default) → persist artifacts |
| Any tool error                         | Returns `{ ok: false, error, suggestion?, recover_via? }` so the LLM can chain a follow-up tool call programmatically                                       |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-agentscript/
  lib/
    command/
      eval-action.ts        ← implementation module
    eval/
      active-ids.ts         ← implementation module
      decode.ts             ← implementation module
      eval-client.ts        ← implementation module
      normalize.ts          ← implementation module
      orchestrator.ts       ← implementation module
      persist.ts            ← implementation module
      render.ts             ← implementation module
      sfap.ts               ← implementation module
      threshold.ts          ← implementation module
      trace-client.ts       ← implementation module
      types.ts              ← implementation module
    preview/
      client.ts             ← implementation module
      session-store.ts      ← implementation module
    templates/
      agentforce-default.ts ← implementation module
      minimal.ts            ← implementation module
    agent-api-auth.ts       ← implementation module
    code-actions.ts         ← implementation module
    compile-tool.ts         ← implementation module
    connection.ts           ← implementation module
    create-tool.ts          ← implementation module
    create.ts               ← implementation module
    diagnostics.ts          ← implementation module
    doctor.ts               ← implementation module
    eval-tool.ts            ← implementation module
    feedback.ts             ← implementation module
    file-classify.ts        ← implementation module
    inspect-tool.ts         ← implementation module
    inspect.ts              ← implementation module
    lifecycle-tool.ts       ← implementation module
    lifecycle.ts            ← implementation module
    mutate-tool.ts          ← implementation module
    mutate.ts               ← implementation module
    preview-tool.ts         ← implementation module
    sdk.ts                  ← implementation module
    sfap-readiness.ts       ← implementation module
    tool-types.ts           ← implementation module
    types.ts                ← implementation module
  tests/
    agent-api-auth.test.ts  ← unit / smoke test
    code-actions.test.ts    ← unit / smoke test
    compile-summary.test.ts ← unit / smoke test
    connection.test.ts      ← unit / smoke test
    create.test.ts          ← unit / smoke test
    diagnostics.test.ts     ← unit / smoke test
    eval-normalize.test.ts  ← unit / smoke test
    eval-sfap.test.ts       ← unit / smoke test
    eval-state-pairing.test.ts← unit / smoke test
    eval-utterance-index.test.ts← unit / smoke test
    feedback.test.ts        ← unit / smoke test
    file-classify.test.ts   ← unit / smoke test
    inspect-actions.test.ts ← unit / smoke test
    inspect-cycle-safety.test.ts← unit / smoke test
    inspect.test.ts         ← unit / smoke test
    mutate-dry-run.test.ts  ← unit / smoke test
    mutate.test.ts          ← unit / smoke test
    path-containment.test.ts← unit / smoke test
    preview-agent-api.test.ts← unit / smoke test
    preview-session-store.test.ts← unit / smoke test
    self-recovery.test.ts   ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    template-scaffold-vars.test.ts← unit / smoke test
    tool-schema-openai-strict.test.ts← unit / smoke test
    tool-types.test.ts      ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

`lib/eval/` is the eval runner (sfap transport + normalize + active-ids + orchestrator + render + persist). `lib/preview/` is the live-org preview client + session store. `lib/templates/` is the scaffold templates for `agentscript_create`. `lib/vendor/agentforce/` is the upstream SDK bundle, refreshed via `scripts/sync-agentforce-sdk.mjs`.

## Testing Strategy

Run targeted tests:

```bash
npm test -- extensions/sf-agentscript/tests
```

Suite coverage:

- `tool-types.test.ts` — `ToolEnvelope` / `ToolError` / `recover_via` contract.
- `connection.test.ts` — cached `Org` / `clearConnectionCache`.
- `eval-sfap.test.ts` — SFAP host fallback + 5xx retry (mocked Connection, fake timers).
- `eval-normalize.test.ts` — six normalizer passes individually + composition.
- `compile.test.ts` (was `diagnostics.test.ts`) — local compile, severity filter, dialect.
- `feedback.test.ts` — on-save `LSP feedback:` rendering contract.
- `code-actions.test.ts` — coordinate-edit fallback fixes.
- `inspect.test.ts` — AST walk on a real fixture.
- `mutate.test.ts` — five ops × success / refuse-to-mutate paths.
- `create.test.ts` — round-trip scaffold; both templates compile clean.
- `preview-session-store.test.ts` — append-only transcript + `cleanup` (real + dry-run).
- `self-recovery.test.ts` — end-to-end loop pin: `create → compile → inspect → mutate → compile clean`.

## Authentication

All Salesforce API calls use `@salesforce/core` `Connection` (jsforce under the hood)
with the same auth files the `sf` CLI writes. Auto-refresh, JWT, named-creds all keep
working. No tokens leave the org connection.

## Coordination with sf-lsp

sf-lsp checks `pi.getCommands()` for `sf-agentscript`. When this plugin is
loaded, sf-lsp yields `.agent` files to us. Disabling sf-agentscript falls
sf-lsp back to the subprocess `.agent` LSP path with no config required.

## Skill

The contributed skill (`skills/sf-agentscript/SKILL.md`) carries the
progressive-disclosure guidance the LLM uses to pick the right tool for
each verb of the loop.

## Troubleshooting

- **Agent Script SDK unavailable.** Run `/sf-agentscript doctor` to see the vendored bundle path and load error. Re-run `scripts/sync-agentforce-sdk.mjs` if the bundle is corrupt.
- **`@salesforce/core` not resolvable.** Run `npm install` at the repo root; the dep was added in P0 of the rewrite.
- **`.sfdx/agents/` is not writable.** Confirm sf-guardrail's carve-out is active (look for `.sfdx/agents/**` in `allowedPatterns` on the `sf-cli-state` rule).
- **No Active BotVersion for `<agent>`.** Activate a version in Setup → Einstein → Agents → `<agent>`.
- **All SFAP endpoints failed.** The user lacks `AIPlatformEvaluation` entitlement, or the BotVersion doesn't exist in the target org.
- **Trace fetch returning null.** The session has been garbage-collected by the planner. Non-fatal; the failure record still has `llmEvents` inline.
- **Mutate refuses to touch the file.** Run `agentscript_compile` first — mutate refuses to emit when the source has severity-1 parse errors.
