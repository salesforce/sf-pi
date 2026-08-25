# Agent Script authoring

Use `agentscript_authoring`. Return to [`../AGENT_GUIDE.md`](../AGENT_GUIDE.md) for the preferred loop.

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

## Compile

Use before inspecting deeply, mutating, previewing, or publishing.

```json
{ "verb": "compile", "mode": "check", "agent_file": "..." }
```

Use `fallback="server"` only when local severity-1 diagnostics look like dialect-version skew. It requires `target_org` and costs a network call.

Explicit compile/check composes both official upstream results: `compileSource` supplies compiler output, ranges, and the mutable document, while `processDocument` supplies dialect/LSP state, indexes, navigation, and code actions. Shared diagnostics are deduplicated by code, full range, and message; diagnostics unique to either result remain visible, and `clean=true` means no severity-1 diagnostic exists in the combined set. Detailed diagnostics remain position-first, the compact summary remains severity-first, and automatic compile-on-save feedback stays limited to errors and warnings.

`mode="format"` writes canonical SDK formatting and refuses parse errors.

## Inspect

Use `inspect/structure` instead of reading whole files. It returns stable workflow projections—not raw AST—including components, connected-agent targets, skills, runtime/file-upload settings, recommended prompts, line numbers, refs, stats, and parse-error flags.

Use `inspect/context_profile` before previewing or publishing voice, messaging, linked-variable, or stateful agents.

Use `inspect/find_references` before mutating a symbol. Use `inspect/definition` when you only need the declaration.

Use `inspect/check_targets` before publish when action or connected-agent targets must resolve in the org. Requires `target_org`; schemes without a proven resolver remain explicitly unverifiable. Actionable target rows always appear before resolved samples. Apex invocable input/output contracts come from Salesforce's registered Apex Action description so direct primitive and wrapper-based methods use the same runtime authority. Connected-agent existence and runtime readiness are separate: an existing target without an Active version warns and provides an activation hint without blocking parent publication. Local project sources are traversed cycle-safely to depth five; transitive gaps warn, while direct targets retain existing blocker semantics.

Use `inspect/quality` to run the global enabled 20-rule native quality catalog for one `.agent` file. It returns High/Moderate/Low/Info findings, rule coverage, suppressions, and report-only cyclomatic complexity. Variable descriptions over 255 characters are High publication risks; the official `instruction-template-syntax` compiler/LSP diagnostic is also projected as a Moderate quality recommendation without duplicating its evaluator. Collapsed cards show every finding header, while expansion adds details. Resolve High and Moderate findings before activation. Global per-rule toggles live under SF Pi Manager → SF Agent Script → Settings → Quality Rules. Disabled rules do not report, repair, compute metrics, or gate publication.

Use `inspect/review` before publish or after behavioral changes. It composes compile and quality with optional org checks and remains deterministic: no hidden model call, no numeric score. Readiness is `ready`, `ready_with_warnings`, `blocked`, or `partial`. Pass `target_org` to include read-only org checks: action-target resolution, Service Agent user readiness, and surface readiness probes such as Agentforce settings, phone number, voice/messaging channel, ServiceChannel, published voice planner, routing-flow, and fallback-queue checks for channel-linked agents. Locally valid `runtime`, `file_upload`, and beta `ask for` usage remain non-blocking org-compiler compatibility risks until live server compile succeeds. Legacy `collect` is a compile error on this package baseline. Pass `output_path` to write a Markdown report.

Use `inspect/runtime_smoke` only after a test call or message. It is read-only and diagnoses recent VoiceCall, AgentWork, and MessagingSession records; it does not place calls, send messages, or replace preview/eval.

## Mutate

Prefer `agentscript_authoring` mutate over generic file editing when the change matches a supported mode. It survives whitespace drift and returns post-mutation diagnostics.

Use `mode="apply_quick_fix"` from compile quick-fix `apply_via` hints. If line numbers may have shifted, compile/check again first.

`mode="set_field"` supports scalar values: string, number, boolean, null. It updates existing fields and may add known scalar fields such as `config.agent_type`; use generic editing for list/object/block construction.

`mode="rename"` is for reference-safe renames of declarable symbols (`@subagent.X`, `@topic.X`, `@actions.X`, `@variables.X`). It also accepts legacy component paths such as `subagent.billing`.

`mode="insert"` and `mode="delete"` intentionally guide you to the generic edit tool followed by compile/check; they are not broad structured source-construction engines.

Use `dry_run=true` for risky changes.

## Create

Use `verb="create"` for new bundles. It writes `.agent` plus `bundle-meta.xml`, validates locally before writing, and returns next steps using the family tools.
