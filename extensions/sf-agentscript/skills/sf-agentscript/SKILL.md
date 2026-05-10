---
name: sf-agentscript
description: Agent Script lifecycle — author, compile, and regression-test `.agent` files. Use for in-process compile-on-save, multi-turn eval against the Salesforce Evaluation API, planner-trace fetching, and Active BotVersion resolution.
---

# SF Agent Script

Single plugin owning the entire Agent Script developer loop: authoring
assist, compile, and multi-turn regression testing. Use this skill when
the user is editing `.agent` files, debugging an Agentforce agent, or
running regression suites against the Salesforce Evaluation API.

## Tool ordering

| When…                                                | Use                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| User edited a `.agent` file and wants quick feedback | `agentscript_compile` (or just save — the on-save hook runs it automatically) |
| User wants to run a regression suite                 | `agentscript_eval_run`                                                        |
| Previous run returned a summary + run_id (large run) | `agentscript_eval_get_failure`                                                |
| Need deeper context than llmEvents inline            | `agentscript_eval_trace`                                                      |
| Authoring a spec and need concrete ids               | `agentscript_eval_resolve`                                                    |

## Default workflow

1. **Edit `.agent`** → on-save hook compiles in-process and posts `LSP feedback:` if anything is off.
2. **Run regression** → `agentscript_eval_run` with the spec path.
3. **Triage failures** → for each failed test the inline `failures` array carries
   the LLM-debug context (utterance, agent reply, topic, llmEvents, executionHistory,
   plugins, state) plus paths to per-turn planner traces.
4. **Fix the `.agent`** → compile-on-save validates the change.
5. **Re-run** → ideally a green eval.

## How the eval API run actually works

- POST `/einstein/evaluation/v1/tests` (5 tests / batch hard limit).
- All batches fan out concurrently (default `concurrency: 8`).
- Endpoint fallback: `api → test.api → dev.api` on 404 (sandbox-safe).
- 5xx-only retry with jittered exponential backoff (1s / 2s / 4s).
- HTML entity decoding on every response string (typography preserved).
- Planner trace GET `/einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid}`
  fans out for failed tests by default.

## Disk artifacts

Every run writes to `<cwd>/.pi/state/sf-agentscript/runs/<run_id>/`:

```
<run_dir>/
├── metadata.json        # spec, org, version, timing, totals, latency
├── raw.json             # full HTML-decoded merged eval response
├── transcript.jsonl     # one entry per turn, sortable + diff-able
├── failures.jsonl       # one entry per failed test, LLM-shaped
└── traces/<planId>.json # per-turn planner traces (failed tests by default)
```

`failures.jsonl` is the LLM-debug contract. Each line is a self-contained
`FailureRecord` with utterance, agent response, topic, invokedActions,
latency, llmEvents (prompt + literal LLM response), executionHistory
(last 5), plugins, filtered stateVariables, and absolute paths to the
trace files.

## Spec format

The eval module accepts the raw `/einstein/evaluation/v1/tests` payload
plus three placeholder strings auto-resolved against the live org's
**Active** BotVersion (not the latest):

- `$active_bot_id` → `BotDefinition.Id` for the agent
- `$active_bot_version_id` → `BotVersion.Id` of the Active version
- `$active_planner_id` → `GenAiPlannerDefinition.Id` matching `<agent>_v<n>`

Pass `agent_api_name` to `agentscript_eval_run` whenever the spec uses
any placeholder.

## Mutable seeds and the 2026-04 workaround

Pass mutable seeds via `context_variables` on `agent.send_message`
**not** at session creation. The platform regression that landed
2026-04 silently drops session-level state seeds; per-message seeding
is the live workaround. The eval module preserves this field during
spec normalization (does not strip it like the upstream SDK whitelist).

## When to dial things down

- `traces_mode: "off"` — fast smoke runs where you only care about pass/fail.
- `traces_mode: "all"` — exhaustive debug, expects extra round-trips.
- `prompt_chars: 200` — keep llmEvents.prompt_content short on context-tight LLM
  loops (default 600 is tuned for Claude/GPT-class context windows).
- `inline_threshold: 1` — force the summary-and-pointer shape even on
  small runs (useful when chaining many runs in one LLM turn).

## Compile-on-save

- Runs after every successful `write`/`edit` on `.agent` files.
- Severity 1 (Error) — always surfaced.
- Severity 2 (Warning) — surfaced only for actionable codes:
  `deprecated-field`, `unused-variable`, `invalid-version`,
  `unknown-dialect`, `invalid-modifier`, `unknown-type`.
- Severity 3+ (Info/Hint) — always dropped to keep feedback focused.
- First feedback per file per session includes a one-line dialect banner.

## Coordination with sf-lsp

- sf-lsp checks `pi.getCommands()` for `sf-agentscript`. When this plugin
  is loaded, sf-lsp yields `.agent` files to us.
- Disabling sf-agentscript falls sf-lsp back to the subprocess `.agent`
  LSP path with no configuration required.

## Troubleshooting

- "Agent Script SDK unavailable" → `/sf-agentscript doctor` shows the
  vendored bundle path. The SDK is `lib/vendor/agentforce/browser.js`.
- "No Active BotVersion" → activate a version in Setup → Einstein → Agents.
- "All SFAP endpoints failed" → the user lacks AIPlatformEvaluation
  entitlement, or the BotVersion doesn't exist in the target org.
- Trace fetch returning null → the session has been garbage-collected by
  the planner. Non-fatal; the failure record still has llmEvents inline.
