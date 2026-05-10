# SF Agent Script

Single plugin owning the entire Agent Script developer loop:

- **Authoring assist** — in-process compile-on-save with `LSP feedback:` blocks for `.agent` files.
- **First-class compile tool** — `agentscript_compile` exposes the same parser/compiler the on-save hook uses.
- **Multi-turn eval** — `agentscript_eval_run` runs regression specs against the Salesforce Evaluation API with full LLM-debug context.
- **Planner trace fetch** — `agentscript_eval_trace` pulls the per-turn LLMExecutionStep / UpdateTopicStep / FunctionCallStep sequence for deep debugging.
- **Active BotVersion resolution** — `agentscript_eval_resolve` materializes `$active_*` placeholders.
- **LSP placeholder** — directory reserved for the future Agent Script LSP server (replaces the vendored SDK approach when ready).

This extension is the canonical owner of the `.agent` namespace within sf-pi.
sf-lsp yields `.agent` files when this plugin is loaded.

## Slash commands

```
/sf-agentscript                   Open status & controls panel
/sf-agentscript doctor            Show vendored SDK status + readiness
/sf-agentscript check <file>      Manually compile a `.agent` file
/sf-agentscript eval <spec.json>  Run a multi-turn regression suite
  [--org <alias>] [--agent <api-name>] [--traces failed|all|off]
  [--concurrency N] [--prompt-chars N] [--verbose]
/sf-agentscript help              Show command usage
```

## Tools (LLM-callable)

| Tool                           | Purpose                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `agentscript_compile`          | In-process `.agent` compile + diagnostics + quick fixes                    |
| `agentscript_eval_run`         | Multi-turn regression run against `/einstein/evaluation/v1/tests`          |
| `agentscript_eval_get_failure` | Drill into one failure from a previous run by `(run_id, test_id)`          |
| `agentscript_eval_trace`       | Fetch full planner trace for one `(session_id, plan_id)`                   |
| `agentscript_eval_resolve`     | Resolve `$active_bot_id` / `$active_bot_version_id` / `$active_planner_id` |

## Disk layout per run

`<cwd>/.pi/state/sf-agentscript/runs/<run_id>/`:

```
metadata.json        # spec, org, version, timing, totals, latency summary
raw.json             # full HTML-decoded merged eval response
transcript.jsonl     # one line per turn, sortable + diff-able
failures.jsonl       # one line per failed test, LLM-shaped
traces/<planId>.json # per-turn planner traces (failed tests by default)
```

The `failures.jsonl` shape is the LLM-debug contract — every line is a
self-contained `FailureRecord` carrying utterance, agent response, topic,
invokedActions, latency, llmEvents (prompt + literal LLM response),
executionHistory (last 5), plugins, filtered stateVariables, step errors,
and absolute paths to the per-turn planner trace files.

## Eval module — what's in the box (full Python-v2 parity)

| Capability                  | Implementation                                                         |
| --------------------------- | ---------------------------------------------------------------------- |
| SFAP endpoint fallback      | `api -> test.api -> dev.api` on 404 (sandbox-safe)                     |
| Retry policy                | 5xx-only with jittered exponential backoff (1s / 2s / 4s)              |
| HTML entity decoding        | 30-entity table + numeric refs; typography preserved                   |
| llmEvents surfacing         | Prompt content + literal LLM response per turn                         |
| Per-turn latency            | p50/p95/p99/max footer                                                 |
| `lastExecution.errors`      | Per-turn turn-error capture                                            |
| `executionHistory` (last 5) | Which topics/actions the planner considered                            |
| `sessionContext.plugins`    | Which plugins were in scope                                            |
| Full planner trace fetch    | Parallel GETs, failed tests by default                                 |
| Disk persistence            | metadata.json + raw.json + transcript.jsonl + failures.jsonl + traces/ |
| Spec normalization          | camelCase + planner alias remap                                        |
| `$active_*` placeholders    | Resolved from BotDefinition + Active BotVersion                        |
| Threshold post-processing   | `_thrNN` id encoding for text_quality / text_alignment                 |
| OR-group collapse           | `__optN` id pattern -> synthetic any-of evaluator                      |

## Authentication

All SFAP calls (eval API, trace API, oauth2/userinfo) shell through
`sf api request rest` so the active org's auth context is reused. The
extension never holds raw access tokens — token refresh, JWT, named-creds,
all keep working without code changes here.

## Coordination with sf-lsp

sf-lsp checks `pi.getCommands()` for `sf-agentscript`. When this plugin is
loaded, sf-lsp yields `.agent` files to us. Disabling sf-agentscript falls
sf-lsp back to the subprocess `.agent` LSP path with no config required.

## Migration from sf-agentscript-assist

This plugin is the rename + scope expansion of `sf-agentscript-assist`. All
existing on-save behavior is byte-equivalent. New surface: eval, compile-as-tool,
trace-fetch, active-id resolution, and the lifecycle slash command tree.

The slash command moved from `/sf-agentscript-assist` to `/sf-agentscript`.

## File structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-agentscript/
  lib/
    command/
      eval-action.ts        ← implementation module
    eval/
      decode.ts             ← implementation module
      eval-client.ts        ← implementation module
      http.ts               ← implementation module
      normalize.ts          ← implementation module
      orchestrator.ts       ← implementation module
      persist.ts            ← implementation module
      render.ts             ← implementation module
      sfap.ts               ← implementation module
      threshold.ts          ← implementation module
      trace-client.ts       ← implementation module
      types.ts              ← implementation module
    tools/
      compile.ts            ← implementation module
      eval-get-failure.ts   ← implementation module
      eval-resolve.ts       ← implementation module
      eval-run.ts           ← implementation module
      eval-trace.ts         ← implementation module
      inspect.ts            ← implementation module
      mutate.ts             ← implementation module
    code-actions.ts         ← implementation module
    connection.ts           ← implementation module
    diagnostics.ts          ← implementation module
    doctor.ts               ← implementation module
    feedback.ts             ← implementation module
    file-classify.ts        ← implementation module
    inspect.ts              ← implementation module
    mutate.ts               ← implementation module
    sdk.ts                  ← implementation module
    tool-types.ts           ← implementation module
    types.ts                ← implementation module
  tests/
    code-actions.test.ts    ← unit / smoke test
    connection.test.ts      ← unit / smoke test
    diagnostics.test.ts     ← unit / smoke test
    eval-normalize.test.ts  ← unit / smoke test
    eval-sfap.test.ts       ← unit / smoke test
    feedback.test.ts        ← unit / smoke test
    file-classify.test.ts   ← unit / smoke test
    inspect.test.ts         ← unit / smoke test
    mutate.test.ts          ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    tool-types.test.ts      ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Skill

The contributed skill (`skills/sf-agentscript/SKILL.md`) carries
progressive-disclosure guidance for the LLM in pi.
