# sf-agentscript

Agent Script lifecycle tooling for pi — **agent-first** authoring, local-first
compile, deterministic inspection/review, AST-safe edits, live-org preview,
multi-turn evals, and publish/activation workflows. Salesforce calls use
`@salesforce/core` / SDR / REST surfaces; no `sf` subprocess runs on the hot path.

## What It Does

`sf-agentscript` exposes four LLM-callable family tools:

| Tool                    | What it owns                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_authoring` | Local `.agent` authoring: create bundles, compile/check or format, inspect structure/references/targets/native quality, deterministic readiness review, and structural mutations. Uses `verb` + `mode`.                                                 |
| `agentscript_preview`   | Live-org preview: start/send/end sessions, fetch traces, bulk end sessions, and clean stale preview artifacts. Send renders a rich human Preview Trace Report while keeping the LLM payload compact through a structured digest and raw-trace pointers. |
| `agentscript_eval`      | Regression workflow: generate starter specs, run evals, drill into failures, synthesize trace artifacts, fetch explicit live traces, and resolve active/latest BotVersion ids.                                                                          |
| `agentscript_lifecycle` | Publish/activation workflow: publish versions, activate/deactivate, list versions, and diagnose/provision Service Agent users.                                                                                                                          |

## Authoring API

`agentscript_authoring` uses a family shape instead of many single-purpose tools:

```json
{ "verb": "compile", "mode": "check", "agent_file": "force-app/.../Billing_Bot.agent" }
```

Rules:

- `verb="create"` omits `mode` and requires `bundle_name`. Generated templates use subagents rather than deprecated topic blocks: `minimal` deterministically enters one primary subagent, while `agentforce-default` exposes one planner-selectable transition per requested responsibility. Both include required welcome/error system messages so create → review is ready by construction. Use `job_spec.subagents`; `job_spec.topics` remains a legacy alias and is ignored when `subagents` is supplied.
- `verb="compile"` defaults `mode` to `check`; `mode="format"` writes canonical SDK formatting.
- `verb="inspect"` defaults `mode` to `structure`; modes include `context_profile`, `find_references`, `definition`, `check_targets`, `quality`, and `review`.
- `verb="mutate"` requires `mode`; modes include `set_field`, `rename`, `insert`, `delete`, and `apply_quick_fix`.
  - `set_field` is a structured scalar field update/upsert for existing top-level Agentforce schema components. It supports first-level scalar fields on singular blocks (for example `config`, `access`, `system`, `model_config`, `knowledge`) and named entries (for example `start_agent.main`, `subagent.billing`, `connection.messaging`, `variables.customer_id`, `actions.lookup`). It does not create missing blocks or nested paths.
  - `rename` is reference-safe for declarable symbols (`@subagent.X`, `@topic.X`, `@actions.X`, `@variables.X`) and accepts legacy component paths.
  - `insert` / `delete` intentionally guide callers to generic file edits followed by compile/check for broader source construction.
- `agent_file` may be omitted only when exactly one current `.agent` file exists on the active Pi branch. Ambiguity is refused with structured candidates.
- Explicit compile/check composes the official `compileSource` and `processDocument` results for one source identity. Shared diagnostics are deduplicated by code, full range, and message; unique diagnostics from either result remain visible, and any severity-1 diagnostic blocks compile validity. Detailed diagnostics stay position-first while the compact summary remains severity-first. Automatic compile-on-save feedback is intentionally limited to errors and warnings.
- `inspect/structure` is a stable workflow projection, not raw compiler AST. It includes connected-agent topology, skills, runtime/file-upload settings, and recommended-prompt settings needed for planning, review, and preflight.
- `inspect/check_targets` reports target existence separately from connected-agent runtime readiness and always surfaces actionable target rows before resolved samples. Apex invocable contracts come from Salesforce's registered Apex Action description, which supports direct primitive and wrapper-based methods without parsing source. An existing connected agent without an Active version produces a non-blocking warning and activation hint rather than being mislabeled as missing. Local project sources are traversed cycle-safely to depth five for transitive readiness; remote-only descendants remain explicitly unverifiable.

## Branch-Durable Tool State

Successful tool results may include `details.sf_agentscript_branch_state`, an array of small pointer events. The extension reconstructs those events from the current Pi branch so follow-on calls can safely infer the current `.agent` file, active preview session, eval spec/run, or lifecycle version.

Branch state stores only lightweight pointers such as file paths, session ids, run ids, plan ids, and readiness summaries. Heavy evidence remains on disk:

- preview traces/transcripts and compact per-turn reports under `.sfdx/agents/**`
- eval Run manifests, source/executed snapshots, status, raw responses, failures, and synthesized traces under `.pi/state/sf-agentscript/**`
- optional review reports at the caller-provided `output_path`

Auto-resolution validates referenced disk artifacts before use and proceeds only when exactly one candidate exists.

## Native quality analysis

`agentscript_authoring { "verb": "inspect", "mode": "quality" }` runs the global enabled 20-rule quality catalog for one `.agent` file. It returns High/Moderate/Low/Info findings, exact rule coverage, suppression evidence, and report-only per-procedure cyclomatic complexity. The same result is composed into review and local-file publication preflight. Collapsed quality cards show every finding header by default; expansion adds messages, suggestions, and evidence.

Quality settings are global-only. **SF Pi Manager → SF Agent Script → Settings → Quality Rules** shows one On/Off row per rule. All v1 rules default On; future experimental rules default Off. Disabled rules do not execute, report findings, steer repair, compute metrics, or gate publication.

Human and LLM output use separate channels. Deferred results persist as theme-aware, expandable quality cards through `appendEntry`; those cards never enter LLM context. New High/Moderate signatures send a hidden `sf-agentscript-quality-repair` custom message containing compact JSON, while clean, Low, Info, and metric-only results remain human-only. Cards distinguish passed, issues, repairing, fixed, stopped, partial, failed, and publication-blocked states.

High findings pause publication without changing compile validity and render as a blocked quality card. After reviewing the evidence, the user can retry with `acknowledge_quality_risk=true`; the approval applies only to that bundle, current session, and reviewed High rule IDs. High and Moderate findings are explicitly recommended for resolution before activation; successful inactive publication retains a compact advisory when recommendations remain.

See [`QUALITY_RULES.md`](./QUALITY_RULES.md) for the stable catalog and lifecycle contract.

## Deterministic review

`agentscript_authoring { "verb": "inspect", "mode": "review" }` runs a deterministic v1 readiness review. It reports:

- compile blockers and warnings
- native quality findings and coverage
- structural/readiness findings that can be proven from the parsed file
- publish-risk signals from the feature profile, including non-blocking warnings when locally compile-valid `runtime`, `file_upload`, or experimental `collect` behavior may be ahead of the target org's server compiler
- read-only action-target checks when `target_org` is provided
- read-only surface readiness checks, such as Agentforce settings, phone number, voice/messaging channel, ServiceChannel, published voice planner, routing-flow, and fallback-queue probes for channel-linked agents when `target_org` is provided
- Service Agent user readiness checks for `access.default_agent_user` license/user/system permission-set wiring when `target_org` is provided

Readiness values are `ready`, `ready_with_warnings`, `blocked`, and `partial`. There is no numeric score and no hidden model call. Pass `output_path` to write a Markdown report.

Use `agentscript_authoring { "verb": "inspect", "mode": "runtime_smoke", "target_org": "..." }` after a test call or message to query recent VoiceCall, AgentWork, and MessagingSession records and get a read-only runtime diagnosis.

## Preview Trace Reports

`agentscript_preview action="send"` separates human readability from model context efficiency:

- The TUI/report surface renders a rich Preview Trace Report with turn summary, the complete parsed LLM response sequence, route path, state changes, key state snapshot, tool activity, connected-agent invocations, action I/O appendix, aligned planner timeline, diagnostics, stats, and drill pointers. Ending a multi-turn Preview session renders a bounded full-session Conversation Replay with every user/agent utterance, per-turn path, latency, and response-integrity proof.
- Response-sequence rows distinguish tool-only, empty, malformed, intermediate candidate content, and content matching the final planner response. Multiple non-empty completions are an explicit human advisory; preview does not claim that candidate text was definitely streamed by a voice surface.
- The LLM-facing text remains compact: a response, short summary, counts, and pointers. Structured details live in `details.digest`; raw prompts, full state, and full action payloads stay in persisted trace artifacts.
- Internal planner variable spam is hidden from the human timeline by default, while user-visible state changes show previous → new previews when available.
- Action input/output previews are screenshot-friendly and bounded/redacted; use `agentscript_preview trace` with the returned `plan_id` for the full raw trace.

## Agent Script Eval Studio

`/sf-agentscript evals` opens the local-first **Agent Script Eval Studio**. It inventories `tests/agentforce/<AgentApiName>.eval.json`, additional `<AgentApiName>.<suite-slug>.eval.json` Suites, generated baselines, and persisted Run evidence without contacting Salesforce. The responsive overlay drills through Agent → Suite → Scenario → Turn/Evaluator evidence, preserves source order, distinguishes execution state from evidence verdict, and keeps stale source as an independent fact.

Studio supports reviewed Suite and diagnostic Scenario Runs, exact historical reruns, explicit cancellation, Release Contract execution, Markdown reports, copy/open artifact actions, and compact conversational authoring handoffs. The Conversation view shows per-turn LLM call, non-empty candidate, and integrity counts; the selected turn expands every parsed completion. New runs read this from `transcript.jsonl`, while detailed legacy-run reads reconstruct it from `raw.json` when possible. The Run Target always reviews the run-local org, Agent API name, exact version policy/result, trace mode, concurrency, and optional Scenario seed overrides. Closing the overlay does not cancel a Run; one Studio-owned Run may execute per project while direct `agentscript_eval run` and `/sf-agentscript eval <spec>` remain independent power-user paths.

EvalSpec JSON remains the only source-controlled format. Source is read-only in the Studio; New/Edit/Diagnose actions close the overlay and prefill Pi's editor with an authoring brief. General file watching, direct JSON editing, inferred Agent coverage, automated Preview replay, Run deletion, and retention management are not part of the MVP.

### Dynamic org seed profiles

A Suite can resolve scenario context from the eval target org at run preflight without hardcoding Salesforce record IDs. Define a read-only `seed_profiles` entry, reference it from a Scenario with `seed_profile`, and map the profile's single SOQL row into ordinary `context_variables`:

```json
{
  "seed_profiles": {
    "open_case": {
      "soql": "SELECT Id, AccountId FROM Case WHERE Status = 'New' ORDER BY CreatedDate DESC LIMIT 1",
      "context_variables": [
        { "name": "case_id", "type": "Text", "field": "Id" },
        { "name": "account_id", "type": "Text", "field": "AccountId" },
        { "name": "verified", "type": "Boolean", "value": true }
      ]
    }
  },
  "tests": [
    {
      "id": "case_help",
      "seed_profile": "open_case",
      "steps": [
        { "type": "agent.create_session", "id": "session" },
        { "type": "agent.send_message", "id": "turn1", "utterance": "Help with my case" }
      ]
    }
  ]
}
```

Seed v1 permits one bounded REST SOQL query and one scalar result row per profile. The resolver rejects unsafe query features, zero or ambiguous rows, null/missing fields, type mismatches, duplicate IDs, and unknown profiles before creating a Run or calling the Evaluation API. Reused profiles query once per Run. Explicit one-run Studio overrides win over profile values.

For release baselines, the designated Suite can provide `generated_baseline.default_seed_profile`, exact test-id `overrides`, and `skip_tests` for generated one-turn probes replaced by designated multi-turn coverage. `run_release` copies only the referenced profiles and assignments into the regenerated baseline and still pins both baseline and designated runs to the same exact BotVersion.

Org-derived values are masked on Studio/source-preview surfaces. Exact resolved values remain confined to the restricted executed/raw Run artifacts and the Evaluation API request.

## Eval Run Hardening

After local normalization/projectability (Studio only), target resolution, and org identity preflight succeed, `agentscript_eval action="run"` creates an immutable `manifest.json`, `spec.source.snapshot.json`, `spec.executed.snapshot.json`, and lightweight atomic `status.json` before the first Evaluation API batch. Failed preflight creates no historical Run. Terminal persistence adds `evidence.json`, metadata, raw response, transcript/failure artifacts, and only then marks status Completed. Status records pointer-sized lifecycle/progress facts and never contains raw eval responses, prompts, traces, transcripts, or failure payloads.

Eval batches keep the compatibility default timeout of 300 seconds, but callers can pass `batch_timeout_ms` for shorter local runs. Client-side request timeouts are terminal for a batch instead of being retried three times. Non-2xx batch responses are persisted in `batch-failures.json`, make the run fail, and can never produce a green zero-result run.

Generated specs compile an internal stateful scenario model into the existing Evaluation API step graph. `include_multi_turn_tests` defaults to true. Multi-turn scenarios are generated only from statically provable `after_response` state updates and simple source branches; unsupported dynamic behavior is reported in `skipped_multi_turn` instead of guessed. This uses a real shared Evaluation API session rather than synthetic conversation-history injection. Salesforce documents conversation history as contextual input for Testing API test cases, but that is a different proof boundary: [Build Tests in Metadata API](https://developer.salesforce.com/docs/ai/agentforce/guide/testing-api-build-tests.html).

Eval-created sessions usually disappear before the live planner trace endpoint can read them, so eval runs synthesize trace artifacts from inline Evaluation API data by default; use `agentscript_eval action="trace"` for explicit live trace drill-down when the session is known to be resident. The Evaluation API does not expose `RelatedAgentStep`, so eval digests report connected-agent call evidence as unavailable rather than zero or inferred; preview remains authoritative for direct invocation counts.

For each paired `agent.send_message` and `agent.get_state`, `transcript.jsonl`, failure records, and synthesized traces retain a parsed `response_sequence` built from every `lastExecution.llmEvents` entry. The sequence stores response content, tool names, ordering, timing, and final-response matching without duplicating full prompt bodies. A turn without `get_state` evidence is recorded as `unavailable`, never as a passing zero-event turn. `raw.json` remains the authoritative unmodified API payload.

Eval run results aggregate this evidence as a human-facing LLM Response Integrity summary, including pass, warning, unavailable, and exact repeated-surface turn counts. Eval run completion renders a Conversation Replay: every bounded user/agent utterance, per-turn agent path, latency, and response-integrity proof; collapsed cards summarize scenarios and expansion shows the complete replay. Failure cards still render the full response sequence for each failed turn. Without a suite policy integrity remains advisory.

Suites can opt into a deterministic release gate:

```json
{
  "sf_pi": {
    "turn_response_integrity": {
      "max_nonempty_llm_contents": 1,
      "severity": "error"
    }
  }
}
```

`warning` records advisory evidence without changing the run verdict. `error` makes excess non-empty completions or exact repeated surface sentences fail evidence and missing response-sequence evidence incomplete. Strict policy requires exactly one `agent.get_state` after every `agent.send_message`; invalid suites fail local preflight before org calls or Run creation. Generated Voice suites now include this strict policy automatically, and exact-version Voice release contracts refuse a designated Suite that omits it. The policy remains source-only, is preserved in snapshots and release digests, and is never sent as an Evaluation API step. See [ADR 0099](../../docs/adr/0099-agentscript-turn-response-integrity-policy.md).

## Eval-Gated Release Sequence

`agentscript_lifecycle action="publish"` always creates an inactive BotVersion. `agentscript_eval action="run_release"` generates the current baseline from `agent_file`, runs it against the exact latest inactive version, and then runs `tests/agentforce/<AgentApiName>.eval.json` when present or an explicit `release_spec_path`. Complete passing metadata records the org id, BotVersion id, baseline identity, and spec digest.

`agentscript_lifecycle action="activate"` resolves the exact target version and checks persisted release-contract evidence. Missing, incomplete, failed, wrong-org, wrong-version, stale-baseline, or stale-designated-suite evidence blocks activation with a recoverable `run_release` call. `acknowledge_untested_activation=true` requests an emergency path but is only an intent flag; SF Guardrail uses a distinct Safety Envelope and human approval before execution.

Release evidence has no arbitrary time expiry. It remains valid while the exact org, BotVersion, baseline identity, and designated-suite digest remain unchanged. Activation uses an atomic exact-identity release-evidence index and validates terminal status, immutable snapshots, raw evidence, and both recorded/current strict verdicts before accepting an entry. A complete current-schema manifest scan rebuilds the release index when needed; the rolling recent-Run index is display convenience, never release authority.

## Runtime Flow

```text
create/compile/inspect/mutate → preview → publish inactive → run_release → activate
        ▲                         │             │             │
        └──────── branch-state + persisted exact-version evidence ────────┘
```

## Behavior Matrix

| Trigger                                 | Result                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `session_start`                         | Reset assist state and shared Salesforce connections once per session. |
| `session_shutdown`                      | Stop runs and clear Agent Script-specific caches/state.                |
| `tool_result` after `.agent` write/edit | Run compile-on-save diagnostics and enabled edit-time High hardening.  |
| `agent_settled`                         | Run enabled global quality rules for changed `.agent` files.           |
| `agentscript_authoring`                 | Create, compile, inspect quality/review, and mutate local source.      |
| `agentscript_preview`                   | Start/send/end preview sessions and persist traces/transcripts.        |
| `agentscript_eval`                      | Generate/run regression specs and exact-version release contracts.     |
| `agentscript_lifecycle`                 | Publish inactive, gate activation, list versions, and manage users.    |

## Settings

SF Agent Script has a Manager Settings page for low-risk tool defaults stored under `sfPi.agentScript`:

- **Preview mock mode** (`previewMockMode`) — default for `agentscript_preview` `start` when `mock_mode` is omitted: `Mock` or `Live Test`.
- **Eval trace mode** (`evalTracesMode`) — default for `agentscript_eval` `run` when `traces_mode` is omitted: `failed`, `all`, or `off`.
- **Eval concurrency** (`evalConcurrency`) — default concurrency for `agentscript_eval` `run` when omitted: `4`, `8`, or `16`.
- **Quality auto-run** (`quality.autoRun`) — global toggle for the deferred post-agent quality pass.
- **Quality rules** (`quality.rules.<rule-id>`) — sparse global per-rule overrides. All 20 stable v1 rules default On.

Quality controls are global-only; project settings cannot weaken or strengthen them. Changes are read dynamically and require no reload. Explicit tool parameters still win for a single call.

## Slash commands

```text
/sf-agentscript                   Open SF Agent Script in the SF Pi Manager
/sf-agentscript doctor            SDK + @salesforce/core + .sfdx/agents writability
/sf-agentscript check <file>      Manually compile a `.agent` file
/sf-agentscript evals             Open the local-first Agent Script Eval Studio
/sf-agentscript eval <spec.json>  Run a multi-turn regression suite directly
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
      actions/
        evidence.ts         ← implementation module
        generation.ts       ← implementation module
        run.ts              ← implementation module
      active-ids.ts         ← implementation module
      conversation-summary.ts← implementation module
      decode.ts             ← implementation module
      eval-client.ts        ← implementation module
      evaluator-catalog.ts  ← implementation module
      normalize.ts          ← implementation module
      orchestrator.ts       ← implementation module
      persist.ts            ← implementation module
      render.ts             ← implementation module
      response-integrity.ts ← implementation module
      safety-probes.ts      ← implementation module
      scenario.ts           ← implementation module
      seeds.ts              ← implementation module
      sfap.ts               ← implementation module
      spec-generator.ts     ← implementation module
      synthesize-trace.ts   ← implementation module
      threshold.ts          ← implementation module
      trace-client.ts       ← implementation module
      types.ts              ← implementation module
      verdict.ts            ← implementation module
    eval-studio/
      actions.ts            ← implementation module
      artifact-reader.ts    ← implementation module
      component.ts          ← implementation module
      discovery.ts          ← implementation module
      handoff.ts            ← implementation module
      layout.ts             ← implementation module
      open.ts               ← implementation module
      projectability.ts     ← implementation module
      redaction.ts          ← implementation module
      run-coordinator.ts    ← implementation module
      run-lease.ts          ← implementation module
      run-target.ts         ← implementation module
      types.ts              ← implementation module
    lifecycle/
      actions/
        agent-user.ts       ← implementation module
        release.ts          ← implementation module
      error-classification.ts← implementation module
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
      connected-graph.ts    ← implementation module
      index.ts              ← implementation module
      parse.ts              ← implementation module
      registry.ts           ← implementation module
      runtime-smoke.ts      ← implementation module
      soql.ts               ← implementation module
      surface-readiness.ts  ← implementation module
      types.ts              ← implementation module
    preview/
      actions/
        maintenance.ts      ← implementation module
        session.ts          ← implementation module
        trace.ts            ← implementation module
      client.ts             ← implementation module
      context-vars.ts       ← implementation module
      resolve-agent-version.ts← implementation module
      session-store.ts      ← implementation module
      trace-digest.ts       ← implementation module
    quality/
      auto-scan.ts          ← implementation module
      catalog.ts            ← implementation module
      engine.ts             ← implementation module
      facts.ts              ← implementation module
      presentation.ts       ← implementation module
      publication-gate.ts   ← implementation module
      rules.ts              ← implementation module
      settings.ts           ← implementation module
      transcript.ts         ← implementation module
      types.ts              ← implementation module
    render/
      compile.ts            ← implementation module
      conversation.ts       ← implementation module
      eval.ts               ← implementation module
      inspect.ts            ← implementation module
      lifecycle.ts          ← implementation module
      mutate.ts             ← implementation module
      report-writer.ts      ← implementation module
      response-sequence.ts  ← implementation module
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
    agentforce-navigation.ts← implementation module
    analysis-snapshot.ts    ← implementation module
    ast-hardening.ts        ← implementation module
    authoring-tool.ts       ← implementation module
    bounded-salesforce-transport.ts← implementation module
    branch-state.ts         ← implementation module
    code-actions.ts         ← implementation module
    config-panel.ts         ← implementation module
    create.ts               ← implementation module
    diagnostics.ts          ← implementation module
    doctor.ts               ← implementation module
    eval-tool.ts            ← implementation module
    feature-profile.ts      ← implementation module
    feedback.ts             ← implementation module
    file-classify.ts        ← implementation module
    inspect-eval-projection.ts← implementation module
    inspect-structure.ts    ← implementation module
    inspect.ts              ← implementation module
    lifecycle-divergence.ts ← implementation module
    lifecycle-tool.ts       ← implementation module
    lifecycle.ts            ← implementation module
    llm-response-sequence.ts← implementation module
    manager-action-panels.ts← implementation module
    mutate.ts               ← implementation module
    mutation-policy.ts      ← implementation module
    package-catalog.ts      ← implementation module
    preview-tool.ts         ← implementation module
    release-contract.ts     ← implementation module
    sdk.ts                  ← implementation module
    settings.ts             ← implementation module
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
    agent-config.test.ts    ← unit / smoke test
    agent-user-status.test.ts← unit / smoke test
    agentfabric-graph-parity.test.ts← unit / smoke test
    analysis-pipeline-characterization.test.ts← unit / smoke test
    analysis-snapshot.test.ts← unit / smoke test
    authoring-quality.test.ts← unit / smoke test
    authoring-rename.test.ts← unit / smoke test
    authoring-review.test.ts← unit / smoke test
    authoring-tool.test.ts  ← unit / smoke test
    bounded-salesforce-transport.test.ts← unit / smoke test
    bounded-shared-connection.test.ts← unit / smoke test
    catalog-event-attestation.test.ts← unit / smoke test
    code-actions.test.ts    ← unit / smoke test
    compile-summary.test.ts ← unit / smoke test
    connected-readiness-graph.test.ts← unit / smoke test
    create.test.ts          ← unit / smoke test
    custom-ps.test.ts       ← unit / smoke test
    deploy-permission-set.test.ts← unit / smoke test
    diagnose-agent-user.test.ts← unit / smoke test
    diagnostic-parity.test.ts← unit / smoke test
    diagnostics.test.ts     ← unit / smoke test
    doctor.test.ts          ← unit / smoke test
    eval-active-ids.test.ts ← unit / smoke test
    eval-agent-id-injection.test.ts← unit / smoke test
    eval-batch-failure.test.ts← unit / smoke test
    eval-conversation-summary.test.ts← unit / smoke test
    eval-normalize.test.ts  ← unit / smoke test
    eval-persist-status.test.ts← unit / smoke test
    eval-plan-id-path.test.ts← unit / smoke test
    eval-response-integrity.test.ts← unit / smoke test
    eval-run-boundary.test.ts← unit / smoke test
    eval-run-failure-boundary.test.ts← unit / smoke test
    eval-scenario.test.ts   ← unit / smoke test
    eval-seed-failure-redaction.test.ts← unit / smoke test
    eval-seed-run.test.ts   ← unit / smoke test
    eval-seeds.test.ts      ← unit / smoke test
    eval-sfap.test.ts       ← unit / smoke test
    eval-spec-generator.test.ts← unit / smoke test
    eval-state-pairing.test.ts← unit / smoke test
    eval-studio-artifact-reader.test.ts← unit / smoke test
    eval-studio-authoring.test.ts← unit / smoke test
    eval-studio-component.test.ts← unit / smoke test
    eval-studio-discovery.test.ts← unit / smoke test
    eval-studio-open.test.ts← unit / smoke test
    eval-studio-projectability.test.ts← unit / smoke test
    eval-studio-redaction.test.ts← unit / smoke test
    eval-studio-run-coordinator.test.ts← unit / smoke test
    eval-synthesize-trace.test.ts← unit / smoke test
    eval-terminal-persistence.test.ts← unit / smoke test
    eval-tool-run.test.ts   ← unit / smoke test
    eval-utterance-index.test.ts← unit / smoke test
    eval-verdict.test.ts    ← unit / smoke test
    family-tool-action-dispatch.test.ts← unit / smoke test
    feedback.test.ts        ← unit / smoke test
    file-classify.test.ts   ← unit / smoke test
    inspect-actions.test.ts ← unit / smoke test
    inspect-cycle-safety.test.ts← unit / smoke test
    inspect-inline-actions.test.ts← unit / smoke test
    inspect-structure.test.ts← unit / smoke test
    inspect.test.ts         ← unit / smoke test
    lifecycle-activation.test.ts← unit / smoke test
    lifecycle-divergence.test.ts← unit / smoke test
    lifecycle-error-classification.test.ts← unit / smoke test
    lifecycle-list-versions.test.ts← unit / smoke test
    lifecycle-quality-gate.test.ts← unit / smoke test
    lifecycle-sdr-layout.test.ts← unit / smoke test
    llm-response-sequence.test.ts← unit / smoke test
    mutate-dry-run.test.ts  ← unit / smoke test
    mutate-emit-regression.test.ts← unit / smoke test
    mutate.test.ts          ← unit / smoke test
    package-coherence.test.ts← unit / smoke test
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
    quality-auto-scan.test.ts← unit / smoke test
    quality-catalog.test.ts ← unit / smoke test
    quality-config-panel.test.ts← unit / smoke test
    quality-edit-time.test.ts← unit / smoke test
    quality-engine.test.ts  ← unit / smoke test
    quality-lifecycle-card.test.ts← unit / smoke test
    quality-presentation.test.ts← unit / smoke test
    quality-publication-gate.test.ts← unit / smoke test
    quality-settings.test.ts← unit / smoke test
    quality-transcript.test.ts← unit / smoke test
    quality-upstream-parity.test.ts← unit / smoke test
    queue-readiness.test.ts ← unit / smoke test
    release-contract.test.ts← unit / smoke test
    release-sequence-contract.test.ts← unit / smoke test
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
    settings.test.ts        ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    surface-readiness.test.ts← unit / smoke test
    template-scaffold-vars.test.ts← unit / smoke test
    timings.test.ts         ← unit / smoke test
    tool-schema-openai-strict.test.ts← unit / smoke test
    tool-types.test.ts      ← unit / smoke test
    trace-digest.test.ts    ← unit / smoke test
    upstream-capabilities.test.ts← unit / smoke test
  AGENT_GUIDE.md            ← supporting file
  AGENTS.md                 ← extension-specific agent editing rules
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## AgentScript Package Updates

Check current, resolved, and npm-latest official AgentScript package versions, plus missing or duplicate foundational versions, with:

```bash
npm run agentscript:versions
```

Refresh direct AgentScript dependencies intentionally with `npm install --save-exact`; `@sf-agentscript/compiler` remains transitive through `@sf-agentscript/agentforce` unless SF Pi imports it directly.

The former npm override canary is retired because the pinned official packages now converge naturally. The version command verifies one effective compiler, dialect, parser, language, LSP, and types graph. See [`ADR 0053`](../../docs/adr/0053-agentscript-language-override-canary.md).

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

Ordinary target-org identity, authentication, latest/configured-fallback API selection, REST, and SOQL come from the shared Salesforce Connection Module using the same auth files the Salesforce CLI writes. Timeout-sensitive Agent Script calls use the Module's bounded transport when a shared session exists. Product-specific SFAP, Evaluation, and Agent API adapters remain local; the Agent API bootstrap creates an isolated named-user JWT connection, copies the shared session's selected API version, and never mutates the normal org token. Tokens stay in process and are never logged or persisted.

## Troubleshooting

- **Agent Script SDK unavailable:** run `/sf-agentscript doctor` to inspect the official SDK package resolution.
- **Preview server compile rejects locally valid syntax:** the installed local compiler can recognize newer Agent Script features before the target org's server compiler rollout accepts them. Run `inspect/structure` to review source-based compatibility risks; currently `config.runtime`, `config.file_upload`, and experimental `collect` require live target-org validation.
- **Preview session not found:** confirm `target_org` matches the org used at preview start, or start a fresh preview session.
- **Eval run appears stuck:** inspect `.pi/state/sf-agentscript/runs/<run_id>/status.json` for the current phase. Pass `batch_timeout_ms` for shorter local probes.
- **Eval trace fetch returns null:** eval-created sessions may be closed by the service before live trace fetch succeeds; synthesized traces and failure records remain in the run directory.
- **Service Agent publish/activation fails:** run `agentscript_lifecycle action="diagnose_agent_user"`, then `provision_agent_user` in dry-run mode before executing changes.
- **Deactivation says the agent is in use by other agents:** deactivate dependent parent agents first, confirm their versions are Inactive, then retry after activation status propagation completes.
- **Service Agent provisioning appears stuck:** the live provisioner deploys a synthesized Permission Set through Metadata API. That deploy is bounded by sf-pi timeouts and should return a timeout diagnostic instead of inheriting SDR's 60-minute default poll window.
