---
name: sf-agentscript
description: Agent Script lifecycle — create, inspect, correct, and self-recover when authoring `.agent` files. Seven tools for the four-verb loop, all running on the local vendored SDK with a thin @salesforce/core Connection layer for live-org operations.
---

# SF Agent Script

Single plugin that owns the entire `.agent` developer loop:
**create → inspect → correct (mutate) → self-recover** (preview + eval).
Use this skill whenever the user is editing `.agent` files, debugging an
Agentforce agent, or running regression suites against the Salesforce
Evaluation API.

## The seven tools

| Tool                    | Action(s)                                                        | What it does                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_compile`   | `check` (default) / `format`                                     | Local-first compile via the vendored SDK. ~10ms. Returns diagnostics + `quick_fixes` with `apply_via` hints pointing at `agentscript_mutate`. `format` canonicalizes whitespace via emit() (refuses on parse errors). `fallback: "server"` retries via /authoring/scripts when local rejects.                                             |
| `agentscript_inspect`   | `structure` (default) / `find_references` / `definition`         | Read-only queries on a `.agent`. `structure` returns the navigable graph (~200 tokens vs ~3000 for a re-read). `find_references` returns every `@<ns>.<prop>` usage (with declaration site). `definition` returns the line where a symbol is declared.                                                                                    |
| `agentscript_create`    | (single)                                                         | Scaffolds a new `.agent` + `bundle-meta.xml`. Local-validates before writing. Returns `next_steps` you can chain.                                                                                                                                                                                                                         |
| `agentscript_mutate`    | `set_field` / `rename` / `insert` / `delete` / `apply_quick_fix` | AST-safe edits via `Document.mutateComponent`; coordinate fallback for `apply_quick_fix`. Always re-compiles after writing — `diagnostics_after` is in the same turn. Pass `dry_run: true` to preview a change as a unified diff without writing.                                                                                         |
| `agentscript_preview`   | `start` / `send` / `end` / `end_all` / `trace` / `cleanup`       | Live preview against the org. `start` accepts EITHER `agent_file` (local `.agent`, compiles + uploads) OR `agent_api_name` (converse with a published, activated agent). `send` captures traces and updates `turn-index.json`; `end_all` dry-runs by default for safe bulk cleanup. Sessions land at `.sfdx/agents/<id>/sessions/<sid>/`. |
| `agentscript_eval`      | `run` / `get_failure` / `trace` / `resolve_active`               | Multi-turn regression spec runner. Streams progress mid-flight. Hybrid result (inline failures small / `run_id` pointer big).                                                                                                                                                                                                             |
| `agentscript_lifecycle` | `publish` / `activate` / `deactivate` / `list_versions`          | Server-compile + publish (creates new agent OR new version, auto-detected). Idempotent activate / deactivate. SOQL-backed list_versions. Closes the dev loop.                                                                                                                                                                             |

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

Two placeholder families. Pick the one that matches your workflow:

| Placeholder                                                      | Resolves to                              | When to use                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$active_bot_id`, `$active_bot_version_id`, `$active_planner_id` | Latest BotVersion with `Status='Active'` | The standard regression loop — you're testing what end users see.                                                                                                                                                         |
| `$latest_bot_version_id`, `$latest_planner_id`                   | Latest BotVersion regardless of state    | The ship→eval→activate loop — you've published v12 but haven't activated it; regression-test it before flipping the switch. `$active_bot_id` works for both families because BotDefinition is per-agent, not per-version. |

Rules that apply to both:

- Pass `agent_api_name` on every call. Without it the run errors out
  with a `recover_via` pointing at `resolve_active`.
- JSON specs can omit `agent_id` / `agent_version_id` in
  `agent.create_session` when `agent_api_name` is supplied. The runner
  injects the Active BotVersion by default (`version_resolution='active'`),
  preserving production-version safety while keeping specs compact.
- Use `version_resolution='latest'` only for the ship→eval→activate loop;
  non-Active latest versions still require `acknowledge_inactive_version=true`.
  Use `version_resolution='version'` plus `version=N` to pin an exact version.
- Run `action=resolve_active` first when in doubt; it returns the
  `bot_version_id`, `version_number`, and `bot_version_status` so you
  can confirm which version a run will actually hit.

Inactive-version safety net:

- When `$latest_*` resolves to a non-Active version, the run **refuses
  to start** and returns a structured error pointing at
  `acknowledge_inactive_version=true`. Pass that flag only when you've
  deliberately chosen to test the non-production version (the ship loop
  above). Catches the "I thought v12 was Active but it's still v11"
  foot-gun.
- `metadata.json` records the resolved `bot_version_number` and
  `bot_version_status` so the run is auditable against the actual
  BotVersion exercised.

Specific-version pinning (when `$latest_*` won't do):

- `action=resolve_active version=12` returns ids for VersionNumber=12
  regardless of state. Bake the returned `bot_version_id` and
  `planner_id` into the spec as plain strings — there's deliberately
  no `$version_<N>_*` placeholder so re-running the spec after a
  republish doesn't silently pick up a different version.
- `action=resolve_active status='any'` returns the latest version
  regardless of state — same lookup as `$latest_*`, exposed as a
  diagnostic.

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

## Pre-flight checklist (before `agentscript_compile`)

A fast mental pass that catches the most common Agent Script mistakes
before the SDK compile. Skim before mutating; skim again before publishing.
Grouped by where the error usually lands.

### Block ordering & top-level shape

1. Block order is `system:` → `config:` → `variables:` → `connection:`
   → `knowledge:` → `language:` → `start_agent agent_router:` → `subagent:`
   blocks. Out-of-order blocks parse but emit warnings or silently lose
   features.
2. `config:` has `developer_name`. Service agents also need
   `default_agent_user`. Employee agents must NOT have `default_agent_user`,
   `connection messaging:`, or MessagingSession-linked variables.
3. `system:` has `messages.welcome`, `messages.error`, AND `instructions`.
   Missing any of the three is a publish-time failure.
4. `start_agent` has a `description` and at least one transition action.
   Without a transition, it's a dead hub anti-pattern.
5. Each `subagent` has a `description` AND a `reasoning:` block. Without
   reasoning, the planner can route to it but never invoke any action.

### Variables & action I/O

6. Every `mutable` variable needs a `default:`. The compiler refuses
   without one.
7. Every `linked` variable needs a `source:` AND no `default:`. Linked +
   default is a contradiction the compiler catches.
8. Numeric action I/O: bare `number` works for variables but **fails at
   publish** in action `inputs:`/`outputs:`. Use `object` +
   `complex_data_type_name: "GenAiNumberType"` (or the matching custom
   Lightning type) for action params.
9. `@inputs` and `@outputs` are ephemeral. `@inputs` only inside `with`;
   `@outputs` only inside the `set`/`if` immediately following the
   action. `@inputs` referenced inside `set` is a **silent failure** at
   runtime — your variable just never updates.

### Syntax that's easy to get wrong

10. **Indent with 4 spaces, not tabs.** Mixed indentation breaks the
    parser with errors that point to the wrong line.
11. **Booleans are `True` / `False`, capitalized.** Lowercase silently
    parses as a string in some places and as a literal elsewhere.
12. **Strings always double-quoted.** Single quotes are not Agent Script.
13. **No `else if`.** Use `if x and y:` or sequential flat `if` blocks.
14. **Two transition syntaxes for two contexts.** Inside `reasoning:
actions:` use `@utils.transition to @subagent.X`. Inside
    `before_reasoning:`/`after_reasoning:` directive blocks use bare
    `transition to @subagent.X`. Mix them up and the planner ignores the
    transition silently.

### The four mistakes that bite hardest

```yaml
# WRONG — bare transition inside a reasoning action
go_billing: transition to @subagent.billing
# RIGHT
go_billing: @utils.transition to @subagent.billing
```

```yaml
# WRONG — mutable without default
variables:
    customer_name:
        type: string
        mutable: True
# RIGHT
variables:
    customer_name:
        type: string
        mutable: True
        default: ""
```

```yaml
# WRONG — numeric action input as bare number; fails at publish
inputs:
    case_count: { type: number }
# RIGHT
inputs:
    case_count:
        type: object
        complex_data_type_name: "GenAiNumberType"
```

```yaml
# WRONG — @inputs referenced after the action runs (silent failure)
set:
    customer_name: @inputs.full_name
# RIGHT — echo the input through @outputs, or capture before the call
set:
    customer_name: @outputs.echoed_full_name
```

### When the LLM should escalate to `agentscript_compile`

Run the compile when the answer to any of the above is unclear, when
`agentscript_inspect` reports `has_parse_errors: true`, or whenever
you're about to publish. The compiler is ~10ms; it's cheaper than
guessing.

## Review pass before publish

The pre-flight checklist above catches mechanical mistakes. The review
below catches **architectural** mistakes — the kind that compile clean
and pass eval but blow up in front of real users. Read each block of
the `.agent` and ask the relevant questions; treat any `❌` as a fix
location before activate.

Seven things to look at — not a score, just questions.

### Shape and structure

- Are all required blocks present and ordered correctly?
- Does `config:` carry the right values for the agent type (employee vs
  service)?
- Does `system:` have all three of `messages.welcome`,
  `messages.error`, and `instructions:`?
- Does every named identifier match its file/folder name?
- Is the file emit-clean (run `agentscript_compile action='format'`)?

### Safety and responsibility

- Does the agent disclose what it is to users? No impersonation of a
  human or a different brand.
- Are there clear escalation paths for sensitive topics (medical,
  financial, legal, harm)?
- Is data handling appropriate for the channel — no unsolicited PII
  capture, no echoing back card numbers / SSNs?
- Are scope boundaries explicit? An off-topic utterance should redirect,
  not improvise.
- Does the system prompt resist obvious prompt-injection attempts? The
  spec generator's safety probes (prompt-injection / system-prompt-leak
  / off-topic / regulated advice) are a fast smoke test.

### Deterministic flow

- Does every subagent have at least one transition out? An orphan with
  no exit traps the conversation.
- Are security-gated actions guarded by `available when:` rather than
  by hoping the LLM reads instructions correctly?
- Are post-action checks at the **top** of `instructions: ->` (so they
  fire on the loop-back), not buried at the bottom?
- Does `start_agent` route somewhere on every utterance? A start_agent
  that answers user questions itself is a dead-hub anti-pattern.

### Instruction quality

- Are instructions actionable ("invoke action.X when Y") rather than
  vague ("help the customer")?
- Procedural mode (`->`) where conditional logic is needed; literal
  mode (`|`) for static text.
- Variable interpolation (`{!@variables.X}`) where the response
  depends on captured state.
- No nested `if` blocks — use compound conditions or sequential flat
  ifs (the parser tolerates nesting but the LLM frequently misreads it).

### Subagent map

- Is every subagent reachable from `start_agent` via at least one
  transition path?
- Does every subagent have a way back to the hub or to a terminal
  state?
- Are subagent `description:` fields specific enough that the router
  LLM picks the right one? Vague descriptions are the #1 cause of
  routing failures we see in eval runs.

### Action wiring

- Each top-level action declaration has a real `target:` (`flow://`,
  `apex://`, `prompt://`) that resolves in the org — run
  `agentscript_inspect action='check_targets'` before publish.
- I/O schemas for non-trivial types use `object` +
  `complex_data_type_name`. Bare `number` in action I/O fails at
  publish (we covered this in the pre-flight); same applies to
  `record`, `list`, etc.
- Slot-filling (`...`) is used for inputs the user supplies
  conversationally. Hard-coded inputs go in `with`.
- Every action that captures data sets a variable in the immediately-
  following `set:` so the value survives the turn.

### Deployment readiness

- For service agents: `default_agent_user` set, the user exists in the
  org, and has the right system + custom permission sets. Run
  `agentscript_lifecycle action='diagnose_agent_user'` to confirm.
- `bundle-meta.xml` is present and well-formed.
- The agent has been run end-to-end in `agentscript_preview` with
  `mock_mode: 'Live Test'` so the actual flows / Apex classes /
  prompt templates have been exercised, not just the planner.
- An eval spec exists for the headline flows. New `.agent` files should
  start with `agentscript_eval action='generate_spec'` to bootstrap one.

### When this review fires

The review is the layer between "compiles" and "production-ready". A
good time to run it:

- Before the first `agentscript_lifecycle action='publish'` on a new
  agent.
- After landing a behavioral change (new subagent, new action, new
  instruction block).
- When `agentscript_eval` keeps surfacing failures from the same root
  cause (e.g. always-wrong topic) — the rubric question "are subagent
  descriptions specific enough?" usually answers it.

Nothing here is enforced today. The LLM applies the questions when
reviewing a `.agent`. If we ever build a tool action for it (`inspect
action='review'`), the deterministic categories above (shape,
deployment, action-wiring) become structural checks; the rest stays
LLM-judged.

## Compile-on-save

Runs after every successful `write` / `edit` on a `.agent` file. Same
filter as `agentscript_compile`:

- Severity 1 (Error) — always surfaced.
- Severity 2 (Warning) — surfaced only for actionable codes:
  `deprecated-field`, `unused-variable`, `invalid-version`,
  `unknown-dialect`, `invalid-modifier`, `unknown-type`.
- Severity 3+ (Info/Hint) — always dropped.
- First feedback per file per session includes a one-line dialect banner.

## Coordination with sf-data360 (production observability)

When the user asks "why did agent X behave wrong in production?" —
start with the live Data Cloud observability data, not the local trace
files. Defer to the **sf-data360** skill for those queries.

Use **STDM** (Session Trace Data Model) when the question is about the
conversation: session, interaction, user message, topic, agent response,
planner step I/O, and STDM quirks (NOT_SET sentinel,
TRUST_GUARDRAILS_STEP `error: "None"`, LLM_STEP not-JSON output,
15/18-char ID inconsistency).

Use **Agent Platform Tracing** when the question is about backend
execution: LLM span timing, action execution, Flow/Apex spans,
retriever/search spans, `OK`/`ERROR` status, operation latency, or a full
OpenTelemetry-style trace tree. When both surfaces are available, join
`ssot__AiAgentInteraction__dlm.ssot__TelemetryTraceId__c` to
`ssot__TelemetryTraceSpan__dlm.ssot__TelemetryTrace__c`.

The end-to-end loop is **observe → reproduce → improve**:

1. `sf-data360` queries STDM and/or Agent Platform Tracing → finds
   problem sessions, interactions, spans, and root-cause signals
2. `agentscript_preview action='start' agent_file=…` → reproduce the
   issue with deterministic `context_variables`
3. `agentscript_mutate` → fix the `.agent` file
4. `agentscript_eval action='run'` → verify the fix doesn't regress
   adjacent flows
5. `agentscript_lifecycle action='publish'` → ship

See `references/agentforce-stdm.md` and
`references/agent-platform-tracing.md` in the `sf-data360` skill for the
DMO field references and copy-paste SQL.

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
