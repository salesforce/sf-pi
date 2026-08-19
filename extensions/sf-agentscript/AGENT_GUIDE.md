# SF Agent Script Agent Guide

Use this guide whenever the user is editing `.agent` files, debugging an Agentforce agent, generating/running regression specs, previewing a local or published agent, or publishing/activating an agent.

## Tools

| Tool                    | Use it for                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_authoring` | Create bundles, compile/check or format `.agent` files, inspect structure/docs/targets/native quality, run deterministic review, and mutate source. Uses `verb` + `mode`.                    |
| `agentscript_preview`   | Start/send/end live preview sessions, fetch planner traces, bulk-end sessions, clean stale preview artifacts, render rich human Preview Trace Reports, and return compact LLM trace digests. |
| `agentscript_eval`      | Generate starter eval specs, run regression suites, drill into failures, synthesize trace artifacts, fetch explicit live traces, and resolve active/latest version ids.                      |
| `agentscript_lifecycle` | Publish, activate/deactivate, list versions, and diagnose/provision Service Agent users.                                                                                                     |

## Authoring contract

`agentscript_authoring` shape:

```json
{ "verb": "compile", "mode": "check", "agent_file": "force-app/.../Billing_Bot.agent" }
```

Rules:

- `verb="create"` omits `mode` and requires `bundle_name`. Both templates generate subagents, not deprecated topics, and include required welcome/error system messages: `minimal` deterministically enters one primary subagent; `agentforce-default` exposes planner-selectable transition actions for `job_spec.subagents`. `job_spec.topics` is a legacy alias and loses when both fields are supplied.
- `verb="compile"` defaults `mode` to `check`; `mode="format"` writes canonical SDK formatting.
- `verb="inspect"` defaults `mode` to `structure`; modes: `structure`, `context_profile`, `find_references`, `definition`, `check_targets`, `quality`, `review`, `runtime_smoke`.
- `verb="mutate"` requires `mode`; modes: `set_field`, `rename`, `insert`, `delete`, `apply_quick_fix`.
- Use `agent_file`, not a generic path field.
- `agent_file` may be omitted only when exactly one current `.agent` file exists on the active Pi branch. Ambiguity is refused with candidates.

## Preferred loop

```text
1. agentscript_authoring { verb:"compile", mode:"check", agent_file }
2. agentscript_authoring { verb:"inspect", mode:"structure", agent_file }
3. agentscript_authoring { verb:"mutate", mode:"...", agent_file, ... }
4. agentscript_authoring { verb:"compile", mode:"check" }
5. agentscript_preview   { action:"start", agent_file }
6. agentscript_preview   { action:"send", message:"..." }
7. agentscript_eval      { action:"generate_spec", agent_file, output_path:"..." }
8. agentscript_lifecycle { action:"publish", agent_file }
9. agentscript_eval      { action:"run_release", agent_file, agent_api_name:"..." }
10. agentscript_lifecycle { action:"activate", agent_api_name:"..." }
```

## Branch-Durable Tool State

Tool results may carry `details.sf_agentscript_branch_state`. Treat it as a branch-aware pointer layer, not evidence storage.

It may let you omit:

- `agent_file` when exactly one current `.agent` file exists on the branch
- preview `agent_name`/`session_id` when exactly one active preview session exists
- eval `spec_path` or failed `run_id` when exactly one candidate exists

It will not guess when multiple candidates exist. Pass explicit ids when ambiguous.

Heavy artifacts remain on disk:

- preview sessions/traces under `.sfdx/agents/**`
- eval run status/failures/synthesized traces under `.pi/state/sf-agentscript/**`
- optional review reports at `output_path`

## Authoring modes

### Compile

Use before inspecting deeply, mutating, previewing, or publishing.

```json
{ "verb": "compile", "mode": "check", "agent_file": "..." }
```

Use `fallback="server"` only when local severity-1 diagnostics look like dialect-version skew. It requires `target_org` and costs a network call.

Explicit compile/check composes both official upstream results: `compileSource` supplies compiler output, ranges, and the mutable document, while `processDocument` supplies dialect/LSP state, indexes, navigation, and code actions. Shared diagnostics are deduplicated by code, full range, and message; diagnostics unique to either result remain visible, and `clean=true` means no severity-1 diagnostic exists in the combined set. Detailed diagnostics remain position-first, the compact summary remains severity-first, and automatic compile-on-save feedback stays limited to errors and warnings.

`mode="format"` writes canonical SDK formatting and refuses parse errors.

### Inspect

Use `inspect/structure` instead of reading whole files. It returns stable workflow projections—not raw AST—including components, connected-agent targets, skills, runtime/file-upload settings, recommended prompts, line numbers, refs, stats, and parse-error flags.

Use `inspect/context_profile` before previewing or publishing voice, messaging, linked-variable, or stateful agents.

Use `inspect/find_references` before mutating a symbol. Use `inspect/definition` when you only need the declaration.

Use `inspect/check_targets` before publish when action or connected-agent targets must resolve in the org. Requires `target_org`; schemes without a proven resolver remain explicitly unverifiable. Actionable target rows always appear before resolved samples. Apex invocable input/output contracts come from Salesforce's registered Apex Action description so direct primitive and wrapper-based methods use the same runtime authority. Connected-agent existence and runtime readiness are separate: an existing target without an Active version warns and provides an activation hint without blocking parent publication. Local project sources are traversed cycle-safely to depth five; transitive gaps warn, while direct targets retain existing blocker semantics.

Use `inspect/quality` to run the global enabled 20-rule native quality catalog for one `.agent` file. It returns High/Moderate/Low/Info findings, rule coverage, suppressions, and report-only cyclomatic complexity. Variable descriptions over 255 characters are High publication risks; the official `instruction-template-syntax` compiler/LSP diagnostic is also projected as a Moderate quality recommendation without duplicating its evaluator. Collapsed cards show every finding header, while expansion adds details. Resolve High and Moderate findings before activation. Global per-rule toggles live under SF Pi Manager → SF Agent Script → Settings → Quality Rules. Disabled rules do not report, repair, compute metrics, or gate publication.

Use `inspect/review` before publish or after behavioral changes. It composes compile and quality with optional org checks and remains deterministic: no hidden model call, no numeric score. Readiness is `ready`, `ready_with_warnings`, `blocked`, or `partial`. Pass `target_org` to include read-only org checks: action-target resolution, Service Agent user readiness, and surface readiness probes such as Agentforce settings, phone number, voice/messaging channel, ServiceChannel, published voice planner, routing-flow, and fallback-queue checks for channel-linked agents. Locally valid `runtime`, `file_upload`, and experimental `collect` usage remain non-blocking org-compiler compatibility risks until live server compile succeeds. Pass `output_path` to write a Markdown report.

Use `inspect/runtime_smoke` only after a test call or message. It is read-only and diagnoses recent VoiceCall, AgentWork, and MessagingSession records; it does not place calls, send messages, or replace preview/eval.

### Mutate

Prefer `agentscript_authoring` mutate over generic file editing when the change matches a supported mode. It survives whitespace drift and returns post-mutation diagnostics.

Use `mode="apply_quick_fix"` from compile quick-fix `apply_via` hints. If line numbers may have shifted, compile/check again first.

`mode="set_field"` supports scalar values: string, number, boolean, null. It updates existing fields and may add known scalar fields such as `config.agent_type`; use generic editing for list/object/block construction.

`mode="rename"` is for reference-safe renames of declarable symbols (`@subagent.X`, `@topic.X`, `@actions.X`, `@variables.X`). It also accepts legacy component paths such as `subagent.billing`.

`mode="insert"` and `mode="delete"` intentionally guide you to the generic edit tool followed by compile/check; they are not broad structured source-construction engines.

Use `dry_run=true` for risky changes.

### Create

Use `verb="create"` for new bundles. It writes `.agent` plus `bundle-meta.xml`, validates locally before writing, and returns next steps using the family tools.

## Preview

`agentscript_preview action="start"` accepts either `agent_file` or `agent_api_name`.

- `agent_file`: local compile first, then server preview; supports context-variable patching for linked/state variables.
- `agent_api_name`: converse with a published active agent; surface digest only.

After a single preview session is active on the branch, `send` and `end` may omit `agent_name` and `session_id`. If more than one session is active, pass both explicitly.

Use `context_variables` to seed deterministic session state for preview or per-turn sends.

Preview send output uses two surfaces: the human renderer shows a rich Preview Trace Report (turn summary, complete parsed LLM response sequence, route path, state changes, key state, function activity, connected-agent invocations, action I/O appendix, aligned planner timeline, diagnostics, stats, and drill pointers), while `content[0].text` stays compact for LLM context efficiency. Ending a multi-turn Preview session renders a bounded Conversation Replay with every user/agent utterance, per-turn path, latency, and response-integrity proof. Response rows distinguish tool-only, intermediate candidate content, and final matching content; multiple non-empty completions are advisory and do not prove what TTS streamed. `RelatedAgentStep` counts as a connected-agent invocation, not a function call. Use `details.digest` for structured signals and `agentscript_preview trace` with the returned `plan_id` when the full raw trace is needed.

## Eval

Use `/sf-agentscript evals` for the local-first Agent Script Eval Studio. Opening it reads repository EvalSpec JSON and `.pi/state/sf-agentscript/runs` evidence only; Salesforce is contacted after an explicit Run Target or Release Contract action. Studio execution requires projectable Scenarios, while `agentscript_eval action="run"` and `/sf-agentscript eval <spec>` preserve permissive raw EvalSpec compatibility.

A Studio Run reviews the run-local org and exact version target before execution, then persists immutable source/executed snapshots. Suite and Scenario Runs are supported, but Scenario, Ad Hoc, Legacy, Incomplete, and Unverified Runs cannot satisfy release evidence. The Conversation tab shows response-integrity counts for each observed turn and expands the selected turn's complete parsed LLM response sequence; detailed legacy reads reconstruct sequence evidence from `raw.json` when it wasn't persisted in older transcripts. Closing the overlay does not cancel a Run; use the explicit cancellation action. `R` refreshes Suite files, and reopening shows current background progress.

New Suite, New Scenario, Edit, and Diagnose actions create a compact authoring brief in Pi's editor. They do not add a second source format or edit JSON inside the overlay. Reopen the Studio manually after the conversational edit completes.

Use `generate_spec` to bootstrap a starter regression spec from a `.agent` file. Use `run` with `agent_api_name` so the runner resolves/injects Active BotVersion ids safely by default.

Use EvalSpec `seed_profiles` when scenarios need org-specific IDs or state. Each profile runs one read-only SOQL query against the selected eval org, requires exactly one row, and maps scalar fields/constants into the existing `context_variables` shape. Scenarios reference one profile with `seed_profile`; reused profiles execute once per Run. Resolution is preflight-only and fails closed before Run creation/API POST for unsafe queries, missing/ambiguous rows, null fields, type mismatches, duplicate IDs, or unknown profiles. Do not select arbitrary customer data—query dedicated test fixtures through stable predicates.

A designated release Suite can provide `generated_baseline.default_seed_profile`, exact test-id `overrides`, and `skip_tests` when a generated one-turn probe is replaced by designated multi-turn coverage. `run_release` copies only referenced profile declarations into the regenerated baseline before pinning the exact pending BotVersion. Dynamic seed values appear only in restricted executed/raw artifacts and are masked on human-facing Studio/report surfaces.

For long or exploratory local runs, pass `batch_timeout_ms` to cap each Evaluation API batch POST. The default remains 300000ms, and client-side timeouts are not retried. Non-2xx batches produce Infrastructure Failed execution plus Incomplete evidence and persist full details in `batch-failures.json`; never accept a green run whose returned test count is lower than the executed spec. During a run, inspect `.pi/state/sf-agentscript/runs/<run_id>/status.json` for atomic phase and batch progress. `manifest.json` owns immutable start identity; `metadata.json` owns the terminal recorded verdict.

`generate_spec` uses an internal stateful scenario compiler. `include_multi_turn_tests` defaults to true and generates same-session turn sequences only when `after_response` updates and a matching source branch are statically provable. Exact state checkpoints use live-supported string or numeric evaluators; dynamic updates appear in `skipped_multi_turn` rather than being guessed. Generated specs also include connected-agent invocation probes, subagent routing, and targeted action probes.

Eval runs synthesize trace artifacts from inline Evaluation API data by default. Eval does not expose `RelatedAgentStep`; connected-agent call counts are therefore unavailable, not zero and not inferred from LLM events. Use `agentscript_preview` for authoritative connected-call telemetry, and use `agentscript_eval action="trace"` only when you explicitly need a live planner trace and have a known resident `session_id`/`plan_id`.

Each paired `send_message` and `get_state` turn persists a complete parsed `response_sequence` from `lastExecution.llmEvents` in transcript, failure, and synthesized-trace artifacts. It retains every raw response event and tool name without copying full prompt bodies. Strict router/system-safety telemetry aliases—identical raw prompt/response, same start time, and end time within 1 ms—are marked and counted once as a physical completion while raw and physical counts remain visible. Never deduplicate on response text alone; sequential repeats remain separate and fail strict integrity. Missing `get_state` evidence is `unavailable`, never a passing zero. `raw.json` remains the authoritative untouched API response.

Eval run output aggregates response integrity as a pass/warning/unavailable summary plus exact repeated-surface counts. Completed runs render a bounded Conversation Replay with the full user/agent exchange, per-turn agent path, latency, and integrity proof; expanded cards show all bounded turns. Failure cards show every parsed completion for each failed turn. Integrity is advisory unless the Suite declares `sf_pi.turn_response_integrity`. `severity: "warning"` preserves the server verdict; `severity: "error"` makes excess non-empty completions or exact surface repetition Failed and unavailable evidence Incomplete. Strict policy requires exactly one `agent.get_state` after each `agent.send_message` and fails preflight before org calls or Run creation when that proof is missing. Generated Voice suites declare strict one-response-per-turn integrity automatically; a Voice exact-version release refuses a designated Suite that omits the same strict policy. The source-only policy is preserved in Suite/Scenario snapshots, generated baselines, and release digests but is never sent as an Evaluation API step.

Use `$latest_*` placeholders or `version_resolution="latest"` only for the publish → eval → activate loop, and pass `acknowledge_inactive_version=true` when deliberately testing a non-Active version.

Use `get_failure` after large runs. If exactly one failed completed run exists on the current branch, `run_id` may be omitted; otherwise pass it explicitly.

## Lifecycle

Use `publish` to create an inactive agent/version. Native quality runs before org calls. New enabled High rule IDs or a quality-analysis failure pause publication and return evidence; retry with `acknowledge_quality_risk=true` only after user approval. Approval is session-scoped to the bundle and reviewed risk IDs. If High or Moderate recommendations remain after publication, the result advises resolving them before activation.

After publication, run `agentscript_eval action="run_release"` with the local `agent_file` and `agent_api_name`, or use the Studio Release Contract tab. It generates and runs the baseline against the exact latest inactive BotVersion, then runs `tests/agentforce/<AgentApiName>.eval.json` when present (or `release_spec_path`). `activate` proceeds only when current-schema Suite evidence is Passed and matches the target org, exact BotVersion, current baseline identity, and current designated-spec digest. Release lookup uses an exact-identity index, revalidates terminal status/snapshots/raw evidence, and rebuilds from Run manifests when needed; recent-index eviction cannot expire evidence. Emergency activation requires `acknowledge_untested_activation=true` and a distinct Guardrail approval.

Use `agent_user_status`, `diagnose_agent_user`, and `provision_agent_user` for Service Agent user wiring. Provision defaults to `dry_run=true`; pass `dry_run=false` only after reviewing the plan. Live provisioning deploys a synthesized Permission Set for Apex action access with bounded Metadata API start/poll timeouts so stalled deploys return diagnostics instead of waiting on SDR's long default poll window.

Do not infer activation/deactivation targets from branch state. Pass `agent_api_name` explicitly for `activate`, `deactivate`, and `list_versions`. If a connected helper cannot deactivate because it is in use, deactivate dependent parent agents first, confirm their versions are Inactive, then retry after status propagation.

## Focused references

Use [`docs/README.md`](./docs/README.md) to select the Service Agent user,
transition, or diagnostic-parity reference. Do not load all references for an
ordinary authoring turn.

## Production observability handoff

When the user asks why a production agent behaved incorrectly, start with `sf-data360` observability data, then reproduce locally with `agentscript_preview`, fix via `agentscript_authoring`, verify with `agentscript_eval`, and ship with `agentscript_lifecycle`.

## Related domain skills

Prefer the Agent Script family tools when they can do the action. If they cannot, read one of these Salesforce skills:
`agentforce-generate` · `agentforce-test` · `agentforce-observe` · `agentforce-architecture-analyze` · `agentforce-bot-upgrade`
