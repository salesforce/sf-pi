---
name: sf-agentscript
description: Agent Script lifecycle — create, inspect, correct, and self-recover when authoring `.agent` files. Six tools for the four-verb loop, all running on the local vendored SDK with a thin @salesforce/core Connection layer for live-org operations.
---

# SF Agent Script

Single plugin that owns the entire `.agent` developer loop:
**create → inspect → correct (mutate) → self-recover** (preview + eval).
Use this skill whenever the user is editing `.agent` files, debugging an
Agentforce agent, or running regression suites against the Salesforce
Evaluation API.

## The seven tools

| Tool                    | Action(s)                                                        | What it does                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_compile`   | `check` (default) / `format`                                     | Local-first compile via the vendored SDK. ~10ms. Returns diagnostics + `quick_fixes` with `apply_via` hints pointing at `agentscript_mutate`. `format` canonicalizes whitespace via emit() (refuses on parse errors). `fallback: "server"` retries via /authoring/scripts when local rejects.                       |
| `agentscript_inspect`   | `structure` (default) / `find_references` / `definition`         | Read-only queries on a `.agent`. `structure` returns the navigable graph (~200 tokens vs ~3000 for a re-read). `find_references` returns every `@<ns>.<prop>` usage (with declaration site). `definition` returns the line where a symbol is declared.                                                              |
| `agentscript_create`    | (single)                                                         | Scaffolds a new `.agent` + `bundle-meta.xml`. Local-validates before writing. Returns `next_steps` you can chain.                                                                                                                                                                                                   |
| `agentscript_mutate`    | `set_field` / `rename` / `insert` / `delete` / `apply_quick_fix` | AST-safe edits via `Document.mutateComponent`; coordinate fallback for `apply_quick_fix`. Always re-compiles after writing — `diagnostics_after` is in the same turn. Pass `dry_run: true` to preview a change as a unified diff without writing.                                                                   |
| `agentscript_preview`   | `start` / `send` / `end` / `trace` / `cleanup`                   | Live preview against the org. `start` accepts EITHER `agent_file` (local `.agent`, compiles + uploads) OR `agent_api_name` (converse with a published, activated agent). `send` accepts `apex_debug: true` to capture the debug log produced during the turn. Sessions land at `.sfdx/agents/<id>/sessions/<sid>/`. |
| `agentscript_eval`      | `run` / `get_failure` / `trace` / `resolve_active`               | Multi-turn regression spec runner. Streams progress mid-flight. Hybrid result (inline failures small / `run_id` pointer big).                                                                                                                                                                                       |
| `agentscript_lifecycle` | `publish` / `activate` / `deactivate` / `list_versions`          | Server-compile + publish (creates new agent OR new version, auto-detected). Idempotent activate / deactivate. SOQL-backed list_versions. Closes the dev loop.                                                                                                                                                       |

## The self-recovery loop

```
USER: "Fix the billing topic so it always verifies before pulling balance."

LLM: agentscript_inspect path=...Billing_Bot.agent
  ← topics[billing] action_refs missing verify_customer; structure tells the
    LLM exactly where to mutate without re-reading the file.

LLM: agentscript_mutate {op: "set_field", path: ..., component: "topic.billing",
                          field: "actions", value: ["verify_customer", "pull_balance"]}
  ← applied_via:"ast", diagnostics_after:[]   (same turn)

LLM: agentscript_preview {action: "start", agent_file: ..., mock_mode: "Live Test"}
LLM: agentscript_preview {action: "send", session_id, message: "what's my balance?"}
  ← topic:"billing", invoked_actions:["verify_customer", "pull_balance"]   ✓

LLM: agentscript_eval {action: "run", spec_path: "specs/billing.json"}
  ← 12/12 passed
```

## How to succeed first time (read this before calling any tool)

This section captures the patterns that **avoid** the common error paths.
The goal is success on the first call, not graceful recovery from a fixable
mistake.

### Before any read or mutate, run `agentscript_compile`

`agentscript_mutate` refuses to touch a file with severity-1 parse errors
(it would emit a corrupt file). Always start with:

```
agentscript_compile path=<file>      → verify clean / get fresh quick fixes
```

If you intend to apply a quick fix, **use the `apply_via` field on the
compile result** — it carries the exact `agentscript_mutate apply_quick_fix`
call. Don't reconstruct it from the diagnostic message.

### Use `agentscript_inspect` for navigation, not `read`

The LLM is tempted to read the file to find a topic. Don't. `inspect`
returns:

- 1-based `line` numbers (match compile output exactly)
- `action_refs` / `subagent_refs` / `variable_refs` per topic/subagent
- `stats` so you know how big the surface is before drilling in

The inspect result is ~200 tokens. A `read` of a real `.agent` is
~3000+ tokens.

### `agentscript_mutate set_field` — value type matters

`set_field` wraps your value as a Literal node before writing. **Supported
value types: string, number, boolean, null.** List and object values are
rejected with `reason: "unsupported_value_type"` because the literal
shapes for `[a, b]` / `{k: v}` haven't been wired yet — use the generic
`edit` tool for those.

Multi-line strings work: pass a string with `\n` and the wrapper emits
the pipe-block form.

### `agentscript_inspect` may report partial results on broken files

`inspect` returns `ok: true` even on a malformed file because the SDK is
error-tolerant. **Always check `has_parse_errors` and `parse_error_count`
on the result.** If `has_parse_errors === true`, the structural surface
may be incomplete — run `agentscript_compile` first to see the errors
and fix them before navigating.

```
inspect.has_parse_errors === true
  → don't trust stats / topics. compile first, fix sev-1, then re-inspect.
```

### `agentscript_mutate apply_quick_fix` — always pass fresh `line`

The `line` parameter is 1-based and **must match a current diagnostic**.
If you applied a previous fix and lines shifted, run `agentscript_compile`
again to get the new line numbers before calling apply_quick_fix.

The coord-fallback path verifies the diagnostic still exists at
`(line, code)` and refuses with `reason: "no_matching_diagnostic"` if it
doesn't — that's a stale-line problem, not a missing fix.

### `agentscript_create` — default location matches Salesforce

Without `output_dir`, files land at
`<defaultPackageDir>/main/default/aiAuthoringBundles/<bundle_name>/`.
The SDK reads `sfdx-project.json` for the default package; falls back to
`force-app` if missing.

`overwrite: false` (default) refuses to clobber. The error returns
`recover_via` with `overwrite: true` set so you can retry intentionally.

### `agentscript_preview start` — know your org's SFAP routing

Not every org routes to `api.salesforce.com/einstein/ai-agent/...`.
Works: production orgs, sandboxes derived from production, Agentforce-
enabled enterprise orgs. **Dev-edition orgs typically do NOT** — they
return HTML 404 pages even when the Connection auth is fine.

If preview fails with 404 across all SFAP host variants, the org isn't
SFAP-enabled. There's no tool fix — use a different org.

### Diagnostics with no quick_fixes

Not every diagnostic ships with a fix. The SDK ships fixes for:
`deprecated-field`, `unused-variable`, `invalid-version`,
`unknown-dialect`, `invalid-modifier`, `unknown-type`.

For anything else (especially `missing-required-field` — e.g. a
start_agent missing its description), **`apply_quick_fix` won't help**.
Use `agentscript_mutate set_field` to add the missing scalar, or fall
back to the generic `edit` tool.

### `agentscript_eval action=run` — placeholder ergonomics

When the spec contains `$active_*`:

- Pass `agent_api_name` on every call. Without it the run errors out
  with a `recover_via` pointing at `resolve_active`.
- The Active version is what runs, not the latest — if you just
  deployed a new version and didn't activate it, runs target the
  previous Active version.
- Run `action=resolve_active` first when in doubt; it returns the
  `bot_version_id` and `version_number` so you can confirm.

### Connection caching

The `Connection` is cached per `target_org` per session. If you re-auth
the org outside pi (e.g. `sf org login web`), restart pi or run
`/sf-agentscript doctor` — the cache invalidates on session lifecycle
events but not on out-of-band auth changes.

## Tool ordering — when to use which

| When…                                                 | Use                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Need the structure of a `.agent` file                 | `agentscript_inspect` (NOT `read`)                                               |
| Compile-on-save reported diagnostics                  | `agentscript_compile` (auto-runs on save anyway)                                 |
| Want to fix a diagnostic                              | Use the `apply_via` hint on the quick fix → `agentscript_mutate apply_quick_fix` |
| Want to change a topic description / variable default | `agentscript_mutate set_field`                                                   |
| Want to migrate `topic.X` → `subagent.X`              | `agentscript_mutate rename`                                                      |
| Want a new agent from scratch                         | `agentscript_create`                                                             |
| Want to verify one utterance against the org          | `agentscript_preview send`                                                       |
| Want a full regression run                            | `agentscript_eval action=run`                                                    |
| Run was big, drilling into one failure                | `agentscript_eval action=get_failure`                                            |
| Need deeper context than llmEvents                    | `agentscript_eval action=trace`                                                  |
| Spec needs concrete ids                               | `agentscript_eval action=resolve_active`                                         |

## Local-first execution policy

Compile, inspect, mutate, validate, normalize — all run **locally** via the
vendored `@agentscript/agentforce` SDK. No auth, no network, ~10ms per check.

The only network calls happen on:

- `agentscript_preview start` (server compile + session start) — local-validated first
- `agentscript_preview send` (send message) — sandbox-routed via SFAP host fallback
- `agentscript_preview trace` and `agentscript_eval` — same SFAP transport
- SOQL via `Connection.query` for `resolve_active` and the `bypassUser` check

`agentscript_eval action=run` does a synchronous local pre-flight (compile +
normalize + ref resolution) before the first network call — saves a
30-second eval round trip when a typo could have been caught in 10ms.

## Programmatic error recovery

Every tool error returns:

```ts
{ ok: false, error: string, suggestion?: string,
  recover_via?: { tool: string, params: Record<string, unknown> } }
```

When `recover_via` is set, dispatch that tool call directly — no prose
parsing required. Common cases:

| Error                                          | recover_via                                      |
| ---------------------------------------------- | ------------------------------------------------ |
| `eval action=run` says "Agent X not found"     | `eval action=resolve_active agent_api_name=X`    |
| `eval action=run` says "spec uses $active\_\*" | `eval action=resolve_active`                     |
| Any tool says "SDK unavailable"                | `sf-agentscript` (open `/sf-agentscript doctor`) |
| `mutate` says "has parse errors"               | `agentscript_compile` to see the errors first    |
| `create` says "exists"                         | same `create` call with `overwrite: true`        |
| `preview start` says "Local compile rejected"  | `agentscript_compile` on the file                |

## Disk artifacts

### Eval runs

`<cwd>/.pi/state/sf-agentscript/runs/<run_id>/`:

```
metadata.json        # spec, org, version, timing, totals, latency summary
raw.json             # full HTML-decoded merged eval response
transcript.jsonl     # one line per turn, sortable + diff-able
failures.jsonl       # one line per failed test, LLM-shaped
traces/<planId>.json # per-turn planner traces (failed tests by default)
```

`failures.jsonl` is the LLM-debug contract — every line is a self-contained
`FailureRecord` with utterance, agent_response, topic, llmEvents (prompt +
literal LLM response), executionHistory (last 5), plugins, filtered
stateVariables, plan_id, and absolute paths to the per-turn planner trace
files. Each record carries a `trace_hint` describing the trace JSON shape so
you know what's inside before opening it.

### Preview sessions

`<cwd>/.sfdx/agents/<agentName>/sessions/<sessionId>/` (Salesforce-standard
layout; sf-guardrail allows `.sfdx/agents/**` specifically):

```
metadata.json        # sessionId, agentName, startTime, endTime?, mockMode, planIds[]
transcript.jsonl     # append-only turn log
traces/<planId>.json # full PlannerResponse per turn (auto-fetched on send)
```

`agentscript_preview cleanup older_than_days=N` removes session dirs older
than N days. Use `dry_run=true` to preview the deletion.

## Trace files

Every `agentscript_eval action='run'` produces per-turn trace docs at
`<run_dir>/traces/<planId>.json` (when `traces_mode != 'off'`). Two
sources contribute, and they're merged under the same
`${sessionId}::${planId}` key:

| Source                                                                                | Shape                                                                                                                                                                                                                                         | Coverage                                                                                                                                               | When it works                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Synthesized from inline eval data** (default)                                       | `{source: 'synthesized-from-eval-api', plan: [UserInputStep, LLMExecutionStep[], FunctionStep[], VariableUpdateStep[], ErrorStep[], PlannerResponseStep], topic, agentResponse, latency, executionHistory, stateVariables, message, notes[]}` | LLM prompt+response, action invocations, variable diffs (across turns), errors, final agent message + topic. ~80–90% of what the live trace gives you. | Always. Built deterministically from `lastExecution` + `sessionContext` + `sessionProperties` in the eval response.                                                                                                       |
| **Live-fetched** via `GET /einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid}` | Full `PlannerResponse` with explicit step timeline including `UpdateTopicStep`, `NodeEntryStateStep`, `ReasoningStep`, etc.                                                                                                                   | Everything above plus the explicit step ordering.                                                                                                      | Rare for eval-spawned sessions — the eval API closes its sessions immediately, so the trace endpoint typically 404s with `Session not found`. Reachable for `agentscript_preview action='start' agent_file=...` sessions. |

The orchestrator runs synthesis unconditionally and overlays the live
fetch when it succeeds. `metadata.json` records both counts:
`traces_synthesized` and `traces_live_fetched`. Reading the synthesized
trace shape is identical to reading a live trace for the fields above
— walk `plan[]`, switch on `type`. The `notes[]` field surfaces caveats
in natural language so an LLM consumer knows what's reconstructed vs.
live without re-parsing the source.

**Why field paths matter**: `planId` lives at
`planner_response.sessionProperties.planId` for the current eval API
response shape — NOT at `lastExecution.message.planId`. Earlier code
(and the upstream Python harness) read the wrong path and silently
fetched zero traces per run. `lib/eval/trace-client.ts` reads the
correct path with a fallback for the older shape.

## Injecting deterministic state (`context_variables`)

Both the eval API path and the live preview path accept the same
`context_variables` shape — use it to bypass auth gates, pre-seed identity,
or reproduce a known-good session state. The `sf agent test` / `sf agent
preview` CLI surfaces don't expose this field; this plugin does.

**Wire shape (identical for both surfaces):**

```json
[
  { "name": "verified_check", "type": "Text", "value": "true" },
  { "name": "RoutableId", "type": "Text", "value": "0Mwbb00000ABCDEF" }
]
```

`type` defaults to `"Text"` when omitted. Numbers and booleans are
stringified internally.

**Eval spec — attach to every `agent.send_message` step:**

```json
{
  "type": "agent.send_message",
  "id": "turn1",
  "session_id": "$.outputs[0].session_id",
  "utterance": "I need a payment link",
  "context_variables": [{ "name": "verified_check", "type": "Text", "value": "true" }]
}
```

**Preview — pass on `agentscript_preview action='send'`:**

```
agentscript_preview {
  action: "send",
  agent_name: "Billing_Bot",
  session_id: "...",
  message: "I need a payment link",
  context_variables: [{ name: "verified_check", value: "true" }]
}
```

**Why per-message and not on session start:** the platform regression that
landed 2026-04 silently drops session-level state seeds. Per-message
seeding is the live workaround. Our eval normalizer preserves
`context_variables` on `agent.send_message` (no `stripUnrecognizedFields`)
and the preview client wires it through to the SFAP `/messages` body.

## Generating a starter regression spec from a `.agent` file

`agentscript_eval action='generate_spec'` reads a `.agent` file and emits
a runnable JSON spec that exercises:

- one routing test per non-start subagent (utterance synthesized from
  the description; assertion on `lastExecution.topic`)
- one invocation probe per top-level action with a `target:` (assertion
  on `lastExecution.invokedActions`)
- one curated off-topic guardrail probe
- a curated safety / adversarial block (prompt injection, system-prompt
  leak, unsolicited PII, regulated advice)

All generated steps use `$active_*` placeholders so the runner resolves
the live BotVersion at run time. Pass `context_variables` to attach a
default auth-bypass / identity seed to every generated `send_message`.

```
agentscript_eval {
  action: "generate_spec",
  agent_file: "force-app/.../Billing_Bot.agent",
  output_path: "specs/billing-smoke.json",
  context_variables: [
    { name: "verified_check", value: "true" },
    { name: "RoutableId",     value: "0Mwbb00000ABCDEF" }
  ]
}
```

IDs are stable across re-generations (`subagent_<slug>`, `action_<slug>`,
`safety_<probe>`) so re-running the generator after editing the agent
produces a small, reviewable diff. Multi-turn scenarios are deliberately
not generated — grow those by hand from the failure records of the first
few runs.

## Compile-on-save

Runs after every successful `write` / `edit` on a `.agent` file. Same
filter as `agentscript_compile`:

- Severity 1 (Error) — always surfaced.
- Severity 2 (Warning) — surfaced only for actionable codes:
  `deprecated-field`, `unused-variable`, `invalid-version`,
  `unknown-dialect`, `invalid-modifier`, `unknown-type`.
- Severity 3+ (Info/Hint) — always dropped.
- First feedback per file per session includes a one-line dialect banner.

## Coordination with sf-lsp

sf-lsp checks `pi.getCommands()` for `sf-agentscript`. When this plugin is
loaded, sf-lsp yields `.agent` files to us. Disabling sf-agentscript falls
sf-lsp back to the subprocess `.agent` LSP path with no config required.

## Troubleshooting

- **"Agent Script SDK unavailable"** — `/sf-agentscript doctor` shows the
  vendored bundle path and any load error. The SDK is
  `lib/vendor/agentforce/browser.js`.
- **"@salesforce/core not resolvable"** — run `npm install` at the repo root.
- **".sfdx/agents/ is not writable"** — confirm sf-guardrail's carve-out is
  active (`/sf-guardrail` → look for the `.sfdx/agents/**` allowedPattern).
- **"No Active BotVersion"** — activate a version in Setup → Einstein → Agents.
- **"All SFAP endpoints failed"** — the user lacks AIPlatformEvaluation
  entitlement, or the BotVersion doesn't exist in the target org.
- **Trace fetch returning null** — the session has been garbage-collected by
  the planner. Non-fatal; the failure record still has llmEvents inline.
