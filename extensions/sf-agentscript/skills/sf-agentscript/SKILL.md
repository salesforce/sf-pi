---
name: sf-agentscript
description: Agent Script lifecycle — author, preview, evaluate, and publish `.agent` files through four family tools: authoring, preview, eval, and lifecycle.
---

# SF Agent Script

Use this skill whenever the user is editing `.agent` files, debugging an Agentforce agent, generating/running regression specs, previewing a local or published agent, or publishing/activating an agent.

## Tools

| Tool                    | Use it for                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_authoring` | Create bundles, compile/check or format `.agent` files, inspect structure/references/targets, run deterministic review, and mutate source. Uses `verb` + `mode`.                             |
| `agentscript_preview`   | Start/send/end live preview sessions, fetch planner traces, bulk-end sessions, clean stale preview artifacts, render rich human Preview Trace Reports, and return compact LLM trace digests. |
| `agentscript_eval`      | Generate starter eval specs, run regression suites, drill into failures, fetch traces, and resolve active/latest version ids.                                                                |
| `agentscript_lifecycle` | Publish, activate/deactivate, list versions, and diagnose/provision Service Agent users.                                                                                                     |

## Authoring contract

`agentscript_authoring` shape:

```json
{ "verb": "compile", "mode": "check", "agent_file": "force-app/.../Billing_Bot.agent" }
```

Rules:

- `verb="create"` omits `mode` and requires `bundle_name`.
- `verb="compile"` defaults `mode` to `check`; `mode="format"` writes canonical SDK formatting.
- `verb="inspect"` defaults `mode` to `structure`; modes: `structure`, `context_profile`, `find_references`, `definition`, `check_targets`, `review`.
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
8. agentscript_eval      { action:"run", spec_path:"...", agent_api_name:"..." }
9. agentscript_lifecycle { action:"publish", agent_file, activate:true }
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
- eval runs/failures/traces under `.pi/state/sf-agentscript/**`
- optional review reports at `output_path`

## Authoring modes

### Compile

Use before inspecting deeply, mutating, previewing, or publishing.

```json
{ "verb": "compile", "mode": "check", "agent_file": "..." }
```

Use `fallback="server"` only when local severity-1 diagnostics look like dialect-version skew. It requires `target_org` and costs a network call.

`mode="format"` writes canonical SDK formatting and refuses parse errors.

### Inspect

Use `inspect/structure` instead of reading whole files. It returns components, line numbers, refs, stats, and parse-error flags.

Use `inspect/context_profile` before previewing or publishing voice, messaging, linked-variable, or stateful agents.

Use `inspect/find_references` before mutating a symbol. Use `inspect/definition` when you only need the declaration.

Use `inspect/check_targets` before publish when action targets must resolve in the org. Requires `target_org`.

Use `inspect/review` before publish or after behavioral changes. It is deterministic: no hidden model call, no numeric score. Readiness is `ready`, `ready_with_warnings`, `blocked`, or `partial`. Pass `target_org` to include read-only org checks: action-target resolution plus surface readiness probes such as voice channel and VoiceCall ServiceChannel checks for voice-linked agents. Pass `output_path` to write a Markdown report.

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

Preview send output uses two surfaces: the human renderer shows a rich Preview Trace Report (turn summary, route path, state changes, key state, tool activity, action I/O appendix, aligned planner timeline, diagnostics, stats, and drill pointers), while `content[0].text` stays compact for LLM context efficiency. Use `details.digest` for structured signals and `agentscript_preview trace` with the returned `plan_id` when the full raw trace is needed.

## Eval

Use `generate_spec` to bootstrap a starter regression spec from a `.agent` file. Use `run` with `agent_api_name` so the runner resolves/injects Active BotVersion ids safely by default.

Use `$latest_*` placeholders or `version_resolution="latest"` only for the publish → eval → activate loop, and pass `acknowledge_inactive_version=true` when deliberately testing a non-Active version.

Use `get_failure` after large runs. If exactly one failed run exists on the current branch, `run_id` may be omitted; otherwise pass it explicitly.

## Lifecycle

Use `publish` to ship a new agent/version. Set `activate=true` only when you intend to immediately serve the new version.

Use `agent_user_status`, `diagnose_agent_user`, and `provision_agent_user` for Service Agent user wiring. Provision defaults to `dry_run=true`; pass `dry_run=false` only after reviewing the plan.

Do not infer activation/deactivation targets from branch state. Pass `agent_api_name` explicitly for `activate`, `deactivate`, and `list_versions`.

## Production observability handoff

When the user asks why a production agent behaved incorrectly, start with `sf-data360` observability data, then reproduce locally with `agentscript_preview`, fix via `agentscript_authoring`, verify with `agentscript_eval`, and ship with `agentscript_lifecycle`.
