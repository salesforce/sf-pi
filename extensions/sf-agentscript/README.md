# sf-agentscript

Agent Script lifecycle tooling for pi — **agent-first** authoring, local-first
compile, deterministic inspection/review, AST-safe edits, live-org preview,
multi-turn evals, and publish/activation workflows. Salesforce calls use
`@salesforce/core` / SDR / REST surfaces; no `sf` subprocess runs on the hot path.

## What It Does

`sf-agentscript` exposes four LLM-callable family tools:

| Tool                    | What it owns                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_authoring` | Local `.agent` authoring: create bundles, compile/check or format, inspect structure/references/targets, deterministic readiness review, and structural mutations. Uses `verb` + `mode`.                                                                |
| `agentscript_preview`   | Live-org preview: start/send/end sessions, fetch traces, bulk end sessions, and clean stale preview artifacts. Send renders a rich human Preview Trace Report while keeping the LLM payload compact through a structured digest and raw-trace pointers. |
| `agentscript_eval`      | Regression workflow: generate starter specs, run evals, drill into failures, fetch traces, and resolve active/latest BotVersion ids.                                                                                                                    |
| `agentscript_lifecycle` | Publish/activation workflow: publish versions, activate/deactivate, list versions, and diagnose/provision Service Agent users.                                                                                                                          |

## Authoring API

`agentscript_authoring` uses a family shape instead of many single-purpose tools:

```json
{ "verb": "compile", "mode": "check", "agent_file": "force-app/.../Billing_Bot.agent" }
```

Rules:

- `verb="create"` omits `mode` and requires `bundle_name`.
- `verb="compile"` defaults `mode` to `check`; `mode="format"` writes canonical SDK formatting.
- `verb="inspect"` defaults `mode` to `structure`; modes include `context_profile`, `find_references`, `definition`, `check_targets`, and `review`.
- `verb="mutate"` requires `mode`; modes include `set_field`, `rename`, `insert`, `delete`, and `apply_quick_fix`.
  - `set_field` is a structured scalar field update/upsert for targeted component fields.
  - `rename` is reference-safe for declarable symbols (`@subagent.X`, `@topic.X`, `@actions.X`, `@variables.X`) and accepts legacy component paths.
  - `insert` / `delete` intentionally guide callers to generic file edits followed by compile/check for broader source construction.
- `agent_file` may be omitted only when exactly one current `.agent` file exists on the active Pi branch. Ambiguity is refused with structured candidates.

## Branch-Durable Tool State

Successful tool results may include `details.sf_agentscript_branch_state`, an array of small pointer events. The extension reconstructs those events from the current Pi branch so follow-on calls can safely infer the current `.agent` file, active preview session, eval spec/run, or lifecycle version.

Branch state stores only lightweight pointers such as file paths, session ids, run ids, plan ids, and readiness summaries. Heavy evidence remains on disk:

- preview traces/transcripts and compact per-turn reports under `.sfdx/agents/**`
- eval runs, raw responses, failures, and traces under `.pi/state/sf-agentscript/**`
- optional review reports at the caller-provided `output_path`

Auto-resolution validates referenced disk artifacts before use and proceeds only when exactly one candidate exists.

## Deterministic review

`agentscript_authoring { "verb": "inspect", "mode": "review" }` runs a deterministic v1 readiness review. It reports:

- compile blockers and warnings
- structural/readiness findings that can be proven from the parsed file
- publish-risk signals from the feature profile
- read-only action-target checks when `target_org` is provided
- read-only surface readiness checks, such as Agentforce settings, phone number, voice/messaging channel, ServiceChannel, published voice planner, routing-flow, and fallback-queue probes for channel-linked agents when `target_org` is provided
- Service Agent user readiness checks for `default_agent_user` license/user/system permission-set wiring when `target_org` is provided

Readiness values are `ready`, `ready_with_warnings`, `blocked`, and `partial`. There is no numeric score and no hidden model call. Pass `output_path` to write a Markdown report.

Use `agentscript_authoring { "verb": "inspect", "mode": "runtime_smoke", "target_org": "..." }` after a test call or message to query recent VoiceCall, AgentWork, and MessagingSession records and get a read-only runtime diagnosis.

## Preview Trace Reports

`agentscript_preview action="send"` separates human readability from model context efficiency:

- The TUI/report surface renders a rich Preview Trace Report with turn summary, route path, state changes, key state snapshot, tool activity, action I/O appendix, aligned planner timeline, diagnostics, stats, and drill pointers.
- The LLM-facing text remains compact: a response, short summary, counts, and pointers. Structured details live in `details.digest`; raw prompts, full state, and full action payloads stay in persisted trace artifacts.
- Internal planner variable spam is hidden from the human timeline by default, while user-visible state changes show previous → new previews when available.
- Action input/output previews are screenshot-friendly and bounded/redacted; use `agentscript_preview trace` with the returned `plan_id` for the full raw trace.

## Runtime Flow

```text
create/compile/inspect/mutate  ──▶  preview  ──▶  eval  ──▶  lifecycle
        ▲                            │            │           │
        └──── branch-state pointers ─┴────────────┴───────────┘
```

## Behavior Matrix

| Trigger                                 | Result                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `session_start` / `session_shutdown`    | Reset assist state and cached Salesforce connections.                   |
| `tool_result` after `.agent` write/edit | Run compile-on-save diagnostics and append compact feedback.            |
| `agentscript_authoring`                 | Create, compile, inspect, review, and mutate local Agent Script source. |
| `agentscript_preview`                   | Start/send/end preview sessions and persist traces/transcripts.         |
| `agentscript_eval`                      | Generate/run regression specs and persist failure/trace artifacts.      |
| `agentscript_lifecycle`                 | Publish, activate, list versions, and manage Service Agent users.       |

## Slash commands

```text
/sf-agentscript                   Open status & controls panel
/sf-agentscript doctor            SDK + @salesforce/core + .sfdx/agents writability
/sf-agentscript check <file>      Manually compile a `.agent` file
/sf-agentscript eval <spec.json>  Run a multi-turn regression suite
/sf-agentscript help              Show command usage
```

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-agentscript/
  lib/
    agent-user/
      agent-config.ts       ← implementation module
      custom-ps.ts          ← implementation module
      deploy.ts             ← implementation module
      diagnose.ts           ← implementation module
      index.ts              ← implementation module
      license.ts            ← implementation module
      permset.ts            ← implementation module
      provision.ts          ← implementation module
      status.ts             ← implementation module
      users.ts              ← implementation module
    authoring/
      actions/
        compile.ts          ← implementation module
        create.ts           ← implementation module
        inspect.ts          ← implementation module
        mutate.ts           ← implementation module
      params.ts             ← implementation module
    command/
      eval-action.ts        ← implementation module
      report-action.ts      ← implementation module
    errors/
      agent-api-error-map.ts← implementation module
      sfap-404.ts           ← implementation module
    eval/
      active-ids.ts         ← implementation module
      decode.ts             ← implementation module
      eval-client.ts        ← implementation module
      normalize.ts          ← implementation module
      orchestrator.ts       ← implementation module
      persist.ts            ← implementation module
      render.ts             ← implementation module
      safety-probes.ts      ← implementation module
      sfap.ts               ← implementation module
      spec-generator.ts     ← implementation module
      synthesize-trace.ts   ← implementation module
      threshold.ts          ← implementation module
      trace-client.ts       ← implementation module
      types.ts              ← implementation module
    preflight/
      resolvers/
        agentforce.ts       ← implementation module
        always-available.ts ← implementation module
        apex.ts             ← implementation module
        external-service.ts ← implementation module
        flow.ts             ← implementation module
        placeholder.ts      ← implementation module
        prompt-template.ts  ← implementation module
        quick-action.ts     ← implementation module
        standard-invocable.ts← implementation module
      surface/
        common.ts           ← implementation module
        phone.ts            ← implementation module
        planner.ts          ← implementation module
        queue.ts            ← implementation module
        routing-flow.ts     ← implementation module
        settings.ts         ← implementation module
        types.ts            ← implementation module
      bundle-type.ts        ← implementation module
      index.ts              ← implementation module
      parse.ts              ← implementation module
      registry.ts           ← implementation module
      runtime-smoke.ts      ← implementation module
      soql.ts               ← implementation module
      surface-readiness.ts  ← implementation module
      types.ts              ← implementation module
    preview/
      client.ts             ← implementation module
      context-vars.ts       ← implementation module
      error-map.ts          ← implementation module
      resolve-agent-version.ts← implementation module
      session-store.ts      ← implementation module
      trace-digest.ts       ← implementation module
    render/
      compile.ts            ← implementation module
      eval.ts               ← implementation module
      inspect.ts            ← implementation module
      lifecycle.ts          ← implementation module
      mutate.ts             ← implementation module
      report-writer.ts      ← implementation module
      shared.ts             ← implementation module
      timeline.ts           ← implementation module
    review/
      org-checks.ts         ← implementation module
      types.ts              ← implementation module
    templates/
      agent-type.ts         ← implementation module
      agentforce-default.ts ← implementation module
      minimal.ts            ← implementation module
    agent-api-auth.ts       ← implementation module
    agentforce-document.ts  ← implementation module
    authoring-tool.ts       ← implementation module
    branch-state.ts         ← implementation module
    code-actions.ts         ← implementation module
    create.ts               ← implementation module
    diagnostics.ts          ← implementation module
    doctor.ts               ← implementation module
    eval-tool.ts            ← implementation module
    feature-profile.ts      ← implementation module
    feedback.ts             ← implementation module
    file-classify.ts        ← implementation module
    inspect-structure.ts    ← implementation module
    inspect.ts              ← implementation module
    lifecycle-divergence.ts ← implementation module
    lifecycle-tool.ts       ← implementation module
    lifecycle.ts            ← implementation module
    local-lints.ts          ← implementation module
    mutate.ts               ← implementation module
    preflight.ts            ← implementation module
    preview-tool.ts         ← implementation module
    sdk.ts                  ← implementation module
    sfap-readiness.ts       ← implementation module
    timings.ts              ← implementation module
    tool-types.ts           ← implementation module
    types.ts                ← implementation module
  tests/
    preflight/
      dispatch.test.ts      ← unit / smoke test
      registry.test.ts      ← unit / smoke test
      resolvers.test.ts     ← unit / smoke test
    agent-api-auth.test.ts  ← unit / smoke test
    agent-api-error-map.test.ts← unit / smoke test
    agent-user-status.test.ts← unit / smoke test
    authoring-review.test.ts← unit / smoke test
    authoring-tool.test.ts  ← unit / smoke test
    code-actions.test.ts    ← unit / smoke test
    compile-summary.test.ts ← unit / smoke test
    create.test.ts          ← unit / smoke test
    custom-ps.test.ts       ← unit / smoke test
    diagnose-agent-user.test.ts← unit / smoke test
    diagnostics.test.ts     ← unit / smoke test
    doctor.test.ts          ← unit / smoke test
    eval-active-ids.test.ts ← unit / smoke test
    eval-agent-id-injection.test.ts← unit / smoke test
    eval-normalize.test.ts  ← unit / smoke test
    eval-plan-id-path.test.ts← unit / smoke test
    eval-sfap.test.ts       ← unit / smoke test
    eval-spec-generator.test.ts← unit / smoke test
    eval-state-pairing.test.ts← unit / smoke test
    eval-synthesize-trace.test.ts← unit / smoke test
    eval-utterance-index.test.ts← unit / smoke test
    feedback.test.ts        ← unit / smoke test
    file-classify.test.ts   ← unit / smoke test
    inspect-actions.test.ts ← unit / smoke test
    inspect-cycle-safety.test.ts← unit / smoke test
    inspect-inline-actions.test.ts← unit / smoke test
    inspect-structure.test.ts← unit / smoke test
    inspect.test.ts         ← unit / smoke test
    lifecycle-divergence.test.ts← unit / smoke test
    lifecycle-error-classification.test.ts← unit / smoke test
    lifecycle-sdr-layout.test.ts← unit / smoke test
    mutate-dry-run.test.ts  ← unit / smoke test
    mutate-emit-regression.test.ts← unit / smoke test
    mutate.test.ts          ← unit / smoke test
    path-containment.test.ts← unit / smoke test
    phone-settings-readiness.test.ts← unit / smoke test
    planner-readiness.test.ts← unit / smoke test
    preflight.test.ts       ← unit / smoke test
    preview-agent-api.test.ts← unit / smoke test
    preview-agent-version-resolver.test.ts← unit / smoke test
    preview-api-name-preflight.test.ts← unit / smoke test
    preview-context-variables.test.ts← unit / smoke test
    preview-host-pinning.test.ts← unit / smoke test
    preview-session-store.test.ts← unit / smoke test
    provision-agent-user.test.ts← unit / smoke test
    publish-authoring-bundle.test.ts← unit / smoke test
    queue-readiness.test.ts ← unit / smoke test
    render-compile.test.ts  ← unit / smoke test
    render-eval.test.ts     ← unit / smoke test
    render-inspect.test.ts  ← unit / smoke test
    render-lifecycle.test.ts← unit / smoke test
    render-mutate.test.ts   ← unit / smoke test
    render-report-writer.test.ts← unit / smoke test
    render-timeline.test.ts ← unit / smoke test
    routing-flow-readiness.test.ts← unit / smoke test
    runtime-smoke.test.ts   ← unit / smoke test
    self-recovery.test.ts   ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    surface-readiness.test.ts← unit / smoke test
    template-scaffold-vars.test.ts← unit / smoke test
    timings.test.ts         ← unit / smoke test
    tool-schema-openai-strict.test.ts← unit / smoke test
    tool-types.test.ts      ← unit / smoke test
    trace-digest.test.ts    ← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## AgentScript Package Updates

Check current, resolved, and npm-latest official AgentScript package versions with:

```bash
npm run agentscript:versions
```

Refresh direct AgentScript dependencies intentionally with `npm install --save-exact`; `@sf-agentscript/compiler` remains transitive through `@sf-agentscript/agentforce` unless SF Pi imports it directly.

## Testing Strategy

Targeted extension suite:

```bash
npm test -- extensions/sf-agentscript/tests
```

Full repo validation:

```bash
npm run validate
```

## Authentication

All Salesforce API calls use `@salesforce/core` `Connection` with the same auth files the Salesforce CLI writes. The Agent API bootstrap creates an isolated named-user JWT connection for `/einstein/ai-agent/*` calls so normal org REST/SOQL usage remains on the regular org token.

## Troubleshooting

- **Agent Script SDK unavailable:** run `/sf-agentscript doctor` to inspect the official SDK package resolution.
- **Preview session not found:** confirm `target_org` matches the org used at preview start, or start a fresh preview session.
- **Eval trace fetch returns null:** eval-created sessions may be closed by the service before live trace fetch succeeds; synthesized traces and failure records remain in the run directory.
- **Service Agent publish/activation fails:** run `agentscript_lifecycle action="diagnose_agent_user"`, then `provision_agent_user` in dry-run mode before executing changes.
