# sf-agentscript

Single plugin owning the entire `.agent` developer loop — **agent-first** authoring,
local-first compile, AST-safe edits, live-org preview, and multi-turn regression
testing against the Salesforce Evaluation API. One npm dep
(`@salesforce/core`); no subprocess shelling on the hot path.

## What It Does

Seven LLM-callable tools that close the **inspect → create → correct → self-recover** loop:

| Tool                  | What it does                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agentscript_compile` | Local-first compile via vendored `@agentscript/agentforce` SDK (~10 ms). Quick fixes carry `apply_via` pointing at `agentscript_mutate`.                                                                                                                                                         |
| `agentscript_create`  | Scaffold new `.agent` + `bundle-meta.xml`. Validates locally before writing. Returns `next_steps`.                                                                                                                                                                                               |
| `agentscript_inspect` | Walks the parsed AST and returns a navigable JSON graph (topics, subagents, variables, actions, linked variable sources, response formats, voice modalities, line numbers, `@`-references). LLM uses it instead of re-reading the file.                                                          |
| `agentscript_mutate`  | AST-safe edits via `Document.mutateComponent` + `emit`; coordinate fallback for `apply_quick_fix`. Always re-compiles after writing.                                                                                                                                                             |
| `agentscript_preview` | Live-org preview — `start` / `send` / `end` / `end_all` / `trace` / `cleanup`. Sessions land at `.sfdx/agents/<id>/sessions/<sid>/`. Streams progress on `send`. Start-time `context_variables` seed mutable/context/linked variables and patch linked bindings for CLI voice/messaging preview. |
| `agentscript_eval`    | Multi-turn regression — `run` / `get_failure` / `trace` / `resolve_active`. Streams progress mid-flight. Hybrid result (inline failures small / `run_id` pointer big).                                                                                                                           |

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
   │        │           │                      ├─ preview {start,send,end,end_all,trace,cleanup}
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
  `action-missing-input`, `linked-variable-missing-source`)

This is intentional: we surface every issue either pass detects so the
LLM (or human) sees the full picture even when the underlying compiler
is willing to tolerate some of them.

sf-pi also layers a small set of local hardening diagnostics on top of
the vendored SDK for Agentforce publish/runtime footguns that are
source-detectable but not always compiler errors: unused variables,
target-backed actions without `outputs:`, Employee Agent service-only
wiring, scoped `@inputs` / `@outputs` misuse, connection route shape,
prompt-template output flags, and literal-mode procedural text. Severity-1 hardening
diagnostics block `agentscript_preview start` and
`agentscript_lifecycle publish` before any org round trip.

The summary line emits a short sample of diagnostic codes and line
numbers —

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

| Trigger                                | Result                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_start` / `session_shutdown`   | Reset assist state, drop cached `Connection`s                                                                                                                                                                                                                                         |
| `tool_result` (write/edit on `.agent`) | Compile in-process, append `LSP feedback:` block                                                                                                                                                                                                                                      |
| `agentscript_compile`                  | Same pipeline as on-save; quick fixes carry `apply_via`                                                                                                                                                                                                                               |
| `agentscript_create`                   | Validate template locally before writing; refuse to overwrite without `overwrite: true`                                                                                                                                                                                               |
| `agentscript_inspect`                  | One AST walk, JSON projection, line numbers 1-based; includes linked variable sources, connection response formats, voice modality fields, and utility refs; `check_targets` verifies target readiness (active Autolaunched Flow, Active Prompt Template, invocable Apex + I/O names) |
| `agentscript_mutate`                   | AST primary (`set_field` / `rename` / `apply_quick_fix`); refuses to mutate files with severity-1 errors; auto-recompiles                                                                                                                                                             |
| `agentscript_preview start`            | Local-compile first; only hits `/authoring/scripts` on success. Optional `context_variables` are injected into state, registered on the compiled AgentJSON, and persisted for future sends.                                                                                           |
| `agentscript_preview send`             | POST message, fetch trace inline, merge any persisted start-time context variables with per-turn overrides, write to session store + `turn-index.json`                                                                                                                                |
| `agentscript_preview end_all`          | Dry-run by default; scans stored sessions, filters by agent/kind/org/age, remotely ends published-agent sessions, locally finalizes authoring-bundle sessions                                                                                                                         |
| `agentscript_eval run`                 | Resolve placeholders or inject missing create-session ids from `agent_api_name` (Active by default) → normalize → batch ≤ 5 tests → POST → fetch/synthesize traces → persist                                                                                                          |
| Any tool error                         | Returns `{ ok: false, error, suggestion?, recover_via? }` so the LLM can chain a follow-up tool call programmatically                                                                                                                                                                 |

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
      bundle-type.ts        ← implementation module
      index.ts              ← implementation module
      parse.ts              ← implementation module
      registry.ts           ← implementation module
      soql.ts               ← implementation module
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
    templates/
      agent-type.ts         ← implementation module
      agentforce-default.ts ← implementation module
      minimal.ts            ← implementation module
    agent-api-auth.ts       ← implementation module
    code-actions.ts         ← implementation module
    compile-tool.ts         ← implementation module
    create-tool.ts          ← implementation module
    create.ts               ← implementation module
    diagnostics.ts          ← implementation module
    doctor.ts               ← implementation module
    eval-tool.ts            ← implementation module
    feature-profile.ts      ← implementation module
    feedback.ts             ← implementation module
    file-classify.ts        ← implementation module
    inspect-tool.ts         ← implementation module
    inspect.ts              ← implementation module
    lifecycle-divergence.ts ← implementation module
    lifecycle-tool.ts       ← implementation module
    lifecycle.ts            ← implementation module
    local-lints.ts          ← implementation module
    mutate-tool.ts          ← implementation module
    mutate.ts               ← implementation module
    preflight.ts            ← implementation module
    preview-tool.ts         ← implementation module
    sdk.ts                  ← implementation module
    sfap-readiness.ts       ← implementation module
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
    code-actions.test.ts    ← unit / smoke test
    compile-summary.test.ts ← unit / smoke test
    create.test.ts          ← unit / smoke test
    custom-ps.test.ts       ← unit / smoke test
    diagnose-agent-user.test.ts← unit / smoke test
    diagnostics.test.ts     ← unit / smoke test
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
    inspect.test.ts         ← unit / smoke test
    lifecycle-divergence.test.ts← unit / smoke test
    lifecycle-sdr-layout.test.ts← unit / smoke test
    mutate-dry-run.test.ts  ← unit / smoke test
    mutate-emit-regression.test.ts← unit / smoke test
    mutate.test.ts          ← unit / smoke test
    path-containment.test.ts← unit / smoke test
    preflight.test.ts       ← unit / smoke test
    preview-agent-api.test.ts← unit / smoke test
    preview-agent-version-resolver.test.ts← unit / smoke test
    preview-api-name-preflight.test.ts← unit / smoke test
    preview-context-variables.test.ts← unit / smoke test
    preview-host-pinning.test.ts← unit / smoke test
    preview-session-store.test.ts← unit / smoke test
    provision-agent-user.test.ts← unit / smoke test
    publish-authoring-bundle.test.ts← unit / smoke test
    render-compile.test.ts  ← unit / smoke test
    render-eval.test.ts     ← unit / smoke test
    render-inspect.test.ts  ← unit / smoke test
    render-lifecycle.test.ts← unit / smoke test
    render-mutate.test.ts   ← unit / smoke test
    render-report-writer.test.ts← unit / smoke test
    render-timeline.test.ts ← unit / smoke test
    self-recovery.test.ts   ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    template-scaffold-vars.test.ts← unit / smoke test
    tool-schema-openai-strict.test.ts← unit / smoke test
    tool-types.test.ts      ← unit / smoke test
    trace-digest.test.ts    ← unit / smoke test
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

`lib/eval/` is the eval runner (sfap transport + normalize + active-ids + orchestrator + render + persist). `lib/preview/` is the live-org preview client + session store. `lib/templates/` is the scaffold templates for `agentscript_create`. `lib/vendor/agentforce/` is the upstream SDK bundle, refreshed via `scripts/sync-agentforce-sdk.mjs`.

## Voice and linked-context preview

`agentscript_preview action='start'` accepts `context_variables` for local
`agent_file` sessions. sf-pi uses those values in three ways so voice,
messaging, and stateful agents can be exercised without a real channel record:

1. Sends the values in the preview session `variables[]` state seed.
2. Registers missing state slots in the compiled `agentVersion.stateVariables[]`.
3. Rewrites compiled linked bindings from `variables.<Name>` to `state.<Name>`
   for injected names.

Use `agentscript_inspect action='context_profile'` first to get a compact seed
template for linked and mutable variables plus publish-risk warnings. Voice
features are intentionally split by lifecycle stage: local compile + preview can
work with `@VoiceCall.*` and `modality voice`, but publish may still require
voice/channel entitlement in the target org. When publish returns a generic
SFAP `Internal Error` and voice/channel features are present, sf-pi maps it to a
feature-gated publish diagnostic instead of leaving the opaque 500 untouched.

Published-agent preview (`agent_api_name`) uses the production v1 session API.
That API returns a surface digest only and does not expose the full v1.1 planner
trace file. Use local `agent_file` preview when you need step-by-step LLM,
transition, variable-update, and tool-call traces.

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
- **Edited `.agent`, deployed via `sf project deploy`, activation still fails.** Plain Metadata-API deploy of an `AiAuthoringBundle` does NOT propagate `config.agent_type` / `default_agent_user` to the BotDefinition record. Always iterate with `agentscript_lifecycle action='publish'` (set `activate=true` to chain). Pass `agent_file=<path>` to `agentscript_lifecycle action='activate'` to get a divergence warning when the local source is newer than the BotVersion in the org. Full explanation: [skills/sf-agentscript/references/agent-user-setup.md](skills/sf-agentscript/references/agent-user-setup.md).
