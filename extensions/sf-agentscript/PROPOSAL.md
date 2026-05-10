# sf-agentscript — rewrite proposal

Status: **locked, ready to execute** · revised 2026-05-10

## Goal

Rewrite `extensions/sf-agentscript` as a small, TypeScript-native, **agent-first**
authoring layer that lets the LLM **inspect, create, correct, and self-recover**
when authoring `.agent` files — the four verbs the user pinned.

1. Uses one Salesforce npm dependency (`@salesforce/core`) for auth + HTTP. No
   subprocess shelling on the hot path.
2. Borrows ideas — not code — from `@salesforce/agents`. The eval workflow,
   normalizer, preview client, session store, and result formatter are all
   reimplemented in our shape.
3. Keeps the vendored `@agentscript/agentforce` SDK for local
   parse / compile / inspect / mutate / emit. (Not yet on npm.)
4. Exposes **six multi-action LLM tools** that close the self-recovery loop:
   `compile`, `inspect`, `create`, `mutate`, `preview {start|send|end|trace|cleanup}`,
   `eval {run|get_failure|trace|resolve_active}`.
5. Streams progress for long-running tools, returns programmatic recovery
   hints on errors, and uses discriminated-union schemas so the LLM gets
   per-action required-field validation.

## Principles

- **One dep, two layers of borrowed ideas, three layers of reuse.** Pure leverage
  (HTTP + auth) becomes a dep. Opinionated workflow stays in our hand. Language
  semantics come from the vendored SDK.
- **Local-first, server-fallback.** Compile, validate, lint, and AST mutate
  always run locally first via the vendored SDK. The server compile/preview
  endpoints are only reached when local can't answer (preview needs AgentJSON;
  local SDK rejects something the server accepts). See the
  **Local-first execution policy** section below.
- **Surgical changes only.** Keep the LLM-debug FailureRecord shape, the
  on-disk artifact layout, the 5xx-only retry policy, the SFAP host fallback,
  the `$active_*` resolver semantics, the mutable-seed workaround, the HTML
  decoder, the threshold/OR-group post-processing.
- **AST first, coordinate edits as fallback.** All structural mutations go
  through `Document.mutateComponent` + `emit`; coordinate `TextEdit`s remain as
  the long-tail safety net.
- **Self-contained.** Every file in `lib/` has one responsibility ≤ 200 lines.
  Every tool file ≤ 80 lines.

## Local-first execution policy

Every operation that can be answered offline is answered offline. Network is
a last resort. Local-first applies in three layers:

### 1. Compile: local first, server fallback

```
compile(.agent file)
  │
  ├── LOCAL  → vendored @agentscript/agentforce compileSource(source)
  │             • ~10 ms in-process
  │             • no auth, no network
  │             • returns: diagnostics + AgentJSON + dialect + quick fixes
  │             • default for: agentscript_compile, on-save hook,
  │                            agentscript_mutate post-edit re-check,
  │                            agentscript_create pre-write validation,
  │                            agentscript_inspect (parse only, no compile)
  │
  └── SERVER → POST /einstein/ai-agent/v1.1/authoring/scripts (endpoint #3)
              • ~500–2000 ms over network, requires Connection
              • only used when:
                  (a) preview action=start needs AgentJSON for the session
                  (b) opt-in fallback when local SDK rejects something the server accepts
                      (e.g. dialect feature the vendored bundle is behind on)
              • controlled by `agentscript_compile {fallback: "server"}`
                or auto-trigger when local diagnostic code is `unknown-dialect`
                or `invalid-version` and a Connection is available.
```

**`agentscript_compile` schema gains an optional `fallback` flag:**

```ts
input  = {
  path: string,
  fallback?: "none" | "server",   // default "none" — local only
  target_org?: string,            // required when fallback="server"
}
output = {
  ...,
  compiled_via: "local" | "server",
  fallback_reason?: string,       // present when compiled_via="server"
}
```

### 2. Test: local validation first, server preview/eval second

There is no local runtime for Agent Script — only Salesforce can execute. But
we can answer a lot before sending anything to the server:

```
test workflow                                              local? server?
─────────────────────────────────────────────────────────────────────────────────
.agent file syntactically valid?                          ✅ local      —
.agent file compiles cleanly (no severity-1 errors)?      ✅ local      —
Dialect + version known to vendored SDK?                  ✅ local      —
Referenced topic / subagent / variable / action exists?   ✅ local      —
Eval spec normalizes cleanly (6 passes)?                  ✅ local      —
Eval spec step IDs and shorthand refs resolvable?         ✅ local      —
Agent + Active BotVersion exist in target org?            —           ✅ server (1 SOQL)
Agent answers a single utterance the way we expect?       —           ✅ server (preview)
Full regression spec (multi-turn, evaluators) passes?     —           ✅ server (eval)
```

**Implication:** `agentscript_eval action=run` runs a synchronous local
pre-flight before the first network call:

1. Compile every `.agent` file referenced in the spec (local).
2. Normalize the spec (local, 6 passes).
3. Validate that all `{stepId.field}` shorthand refs resolve (local).
4. Validate that all `$active_*` placeholders have an `agent_api_name` (local).
5. Only after all four pass: call `resolveActiveIds` (server) and start the
   eval batches.

A local pre-flight failure short-circuits with a `ToolError` carrying
`recover_via` pointing at the relevant local fix tool (usually
`agentscript_compile` or `agentscript_mutate`). Saves a 30-second eval round
trip when a typo could have been caught in 10 ms.

Similarly, `agentscript_preview action=start` compiles the `.agent` locally
before hitting `/authoring/scripts` — if local rejects, we don't burn a
server call.

### 3. Mutate: AST primary, coordinate fallback

(Already in the proposal; reframed here for symmetry.)

```
mutate(op, path, ...)
  │
  ├── AST   → Document.mutateComponent(...) + emit()         (local, ~5 ms)
  │             • default for set_field / rename / insert / delete
  │             • always re-compiles locally after writing
  │
  └── COORD → buildQuickFixes() + applyTextEdits()           (local, ~2 ms)
              • fallback for op=apply_quick_fix when AST can't express
              • server is never reached for mutation
```

### Why local-first matters

- **Latency.** ~10 ms vs ~500–2000 ms per check. Compile-on-save stays free;
  the agent loop stays tight.
- **Auth-free.** The agent can validate edits without an org connection. New
  contributors can edit `.agent` files before they finish `sf org login`.
- **Offline-safe.** Editing on a plane works. Pre-flighting an eval before a
  big run works.
- **Deterministic.** Same vendored bundle gives the same diagnostics across
  every machine. The bundle SHA is checked by `/sf-agentscript doctor` and CI.
- **Server bandwidth respected.** Eval API and preview endpoints are not free;
  catching a typo locally is one fewer round-trip on shared infrastructure.

The one place we cannot stay local is when the SDK is unavailable (vendored
bundle corrupt or out of date). In that case `agentscript_compile` returns
`{ok: false, reason: "sdk_unavailable", recover_via: {tool: "sf-agentscript",
params: {action: "doctor"}}}` so the LLM can fix the SDK before retrying.

## Salesforce endpoints in scope

All endpoints below are reached via `@salesforce/core` `Connection.request`.
Four of seven live on **SFAP** and need the host fallback walk
(`api.salesforce.com → test.api.salesforce.com → dev.api.salesforce.com` on 404).

| #   | Endpoint                                                                               | Method | Purpose                                                                 | Used by                                                                   | Host fallback     |
| --- | -------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| 1   | `https://api.salesforce.com/einstein/evaluation/v1/tests`                              | POST   | Run eval batch (≤ 5 tests)                                              | `eval action=run`                                                         | yes               |
| 2   | `https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid}` | GET    | Fetch planner trace                                                     | `eval action=trace`, `preview action=send` (auto), `preview action=trace` | yes               |
| 3   | `https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts`                  | POST   | Server-side compile (`.agent` → AgentJSON)                              | `preview action=start`, optional fallback in `compile`                    | yes               |
| 4   | `https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions`                   | POST   | Start preview session                                                   | `preview action=start`                                                    | yes               |
| 5   | `https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions/{sid}/messages`    | POST   | Send message in preview                                                 | `preview action=send`                                                     | yes               |
| 6   | `https://<instanceUrl>/services/oauth2/userinfo`                                       | GET    | `org_id` + `user_id` for SFAP headers                                   | `connection.resolveOrgIdentity` (via `conn.identity()`)                   | no — instance URL |
| 7   | `/services/data/vXX.X/query` (SOQL via jsforce)                                        | GET    | `BotDefinition`, `BotVersion`, `GenAiPlannerDefinition`, `User` lookups | `eval action=resolve_active`, `preview action=start` (bypassUser check)   | no — instance URL |

API version `vXX.X` for endpoint 7 reads from `[Salesforce Environment]` at
run time — never hardcoded. We do **not** add new endpoints in this rewrite.

## Eval API — we reuse our existing TypeScript implementation

The TypeScript eval implementation already lives in `extensions/sf-agentscript/lib/eval/`.
The rewrite preserves the existing logic and only modernizes the transport.

| File                                 | Today                                                                                         | After rewrite                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `eval/decode.ts` (97 LOC)            | HTML entity decoder                                                                           | **verbatim**                                                                 |
| `eval/threshold.ts` (100 LOC)        | `_thrNN` / `__optN` post-processing                                                           | **verbatim**                                                                 |
| `eval/persist.ts` (136 LOC)          | Disk artifacts (`metadata.json`, `raw.json`, `transcript.jsonl`, `failures.jsonl`, `traces/`) | **verbatim**                                                                 |
| `eval/types.ts`                      | All eval shapes                                                                               | **verbatim**                                                                 |
| `eval/render.ts` (373 LOC)           | Mixed: failure-record + human report                                                          | **split** → `failure-record.ts` + tiny `format.ts`                           |
| `eval/orchestrator.ts` (486 LOC)     | 8 phases, uses subprocess `ExecFn`                                                            | **slimmed**, swap to `Connection`; active-ids resolver moved to its own file |
| `eval/normalize.ts` (56 LOC, 1 pass) | Field aliases                                                                                 | **expanded** to 6 passes (port the four ideas from `@salesforce/agents`)     |
| `eval/eval-client.ts` (73 LOC)       | POST batch via `httpCall`                                                                     | **reused**, transport swap to `sfapRequest`                                  |
| `eval/trace-client.ts` (146 LOC)     | Trace fan-out via `httpCall`                                                                  | **reused**, transport swap                                                   |
| `eval/http.ts` (181 LOC)             | subprocess SFAP client                                                                        | **replaced** by `eval/sfap.ts` (`Connection`-based, ~120 LOC)                |

**Net: ~80% of the eval module survives.** No reimplementation. The python
`scripts/eval-direct/run.py` referenced in the original brief lives
elsewhere; our existing TS is the canonical implementation and we keep it.

## Reference repos & what we take

| Repo                                             | Decision                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `salesforce/agentscript` (OSS)                   | **Vendor** the `@agentscript/agentforce` `browser.js` bundle. Not on npm. Keep `scripts/sync-agentforce-sdk.mjs` + CI drift check. Use `parse`, `compileSource`, `Document`, `parseComponent`, `mutateComponent`, `emitComponent`.                                                                                                                                     |
| `forcedotcom/agents` (npm: `@salesforce/agents`) | **Don't import.** Read the source for ideas: `evalNormalizer` aliases (MCP shorthand, autoCorrect, shorthand-refs, inject-defaults), `requestWithEndpointFallback` SFAP host walk, `agentEvalRunner.executeBatches` parallel-batch shape, `ScriptAgent` session layout. Reimplement each idea in our own files — tighter, with our retry policy and our session store. |
| Internal CLI                                     | Out of scope.                                                                                                                                                                                                                                                                                                                                                          |

## Final dependency footprint

| Package                                   | Status        | Rationale                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@salesforce/core` ^8.29.1 (BSD-3-Clause) | **Add**       | `Org` + `Connection` give us jsforce HTTP under the hood plus AuthInfo glue that reads sf CLI's auth files. Same auth as `sf` CLI, automatic token refresh, ~30× lower latency than subprocess shelling. One dep, pure leverage. |
| `@salesforce/agents`                      | Drop          | Higher-level orchestration with opinions we don't share (strips `context_variables`, blanket retries, writes to `.sfdx/agents/...`, no FailureRecord shape). Easier to write 300 lines than to fight the abstraction.            |
| `yaml`                                    | Drop          | We don't accept YAML eval specs. JSON only.                                                                                                                                                                                      |
| `jsforce` (direct)                        | Skip          | `@salesforce/core` already wraps it. Picking jsforce alone forces double-login and reinventing AuthInfo.                                                                                                                         |
| `@agentscript/agentforce`                 | Stay vendored | Not on npm. One-line swap to a real npm import the day Salesforce publishes it.                                                                                                                                                  |

`package.json` diff:

```diff
 "dependencies": {
+  "@salesforce/core": "^8.29.1",
   "node-emoji": "^2.2.0",
   "vscode-languageserver-protocol": "^3.17.5"
 }
```

## Why `@salesforce/core` over the alternatives

|                    | `sf api request rest` (today)   | `jsforce` alone | **`@salesforce/core`**                |
| ------------------ | ------------------------------- | --------------- | ------------------------------------- |
| HTTP transport     | subprocess → node → CLI → fetch | direct fetch    | direct fetch (jsforce under the hood) |
| Per-call overhead  | ~80–200 ms                      | ~5 ms           | ~5 ms                                 |
| Auth source        | sf CLI auth files               | invent your own | sf CLI auth files                     |
| Auth refresh       | handled by sf CLI               | manual          | automatic                             |
| User login UX      | none — uses `sf` already        | second login    | none — uses `sf` already              |
| Maintainer cadence | sf CLI release pin              | community       | pinned to every CLI release           |

Today, an eval run with `concurrency=8` does ~30 subprocess calls × ~150 ms of
fork/JSON tax = ~4.5 s pure overhead. With `Connection.request` it's ~0.

## Agent-optimization passes (1–10)

The rewrite applies these ten optimizations on top of the original five-tool
shape, locked from the agent-first review pass:

| #   | Optimization                                                                                                                                                                                                        | Where it lands                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | **Add `agentscript_create`** — scaffolds a new `.agent` + `bundle-meta.xml` from a job spec. Closes the "create" verb.                                                                                              | `lib/create.ts` + `tools/create.ts`                     |
| 2   | **Stream progress** via pi's `onUpdate(message)` on long-running tools.                                                                                                                                             | `eval action=run`, `preview action=send`                |
| 3   | **Discriminated-union schemas** — typebox `Type.Union(Type.Object({op: Type.Literal("x"), …}))` so per-action required fields are statically validated.                                                             | All multi-action tools (`mutate`, `preview`, `eval`)    |
| 4   | **Programmatic error recovery** — every tool error returns `{ok:false, error, suggestion, recover_via?: {tool, params}}` so the LLM can chain a follow-up tool call directly.                                       | `lib/types.ts` `ToolError`; every tool                  |
| 5   | **Compile output nudges to `mutate`** — each `quick_fix` carries `apply_via: {tool: "agentscript_mutate", params: {…}}`.                                                                                            | `lib/compile.ts`, `lib/code-actions.ts`                 |
| 6   | **Trace shape hint** in failure records — `trace_hint: "Each file is a PlannerResponse with UserInputStep, UpdateTopicStep, LLMExecutionStep (prompt+response+latency), FunctionCallStep. Read via the read tool."` | `lib/eval/failure-record.ts`                            |
| 7   | **Doctor expanded** — checks `@salesforce/core` resolves, target-org resolves, `.sfdx/agents/` writable, vendored bundle SHA matches `UPSTREAM.md`.                                                                 | `lib/doctor.ts`                                         |
| 8   | **Session GC** — `preview action=cleanup older_than_days?: number` removes expired sessions. Default TTL: never (explicit only).                                                                                    | `lib/preview/session-store.ts`, `lib/preview/client.ts` |
| 9   | **Token-economy pass** on tool descriptions — each multi-action tool's `description` and `promptGuidelines` enumerate actions in one tight line; per-action behavior referenced via the schema, not the prose.      | All `tools/*.ts`                                        |
| 10  | **End-to-end self-recovery test** — fixture: broken `.agent` → compile → inspect → mutate → compile clean → eval green. Locks the loop.                                                                             | `tests/self-recovery.test.ts`                           |

## The six tools

```
edit/write a .agent file ──▶ on-save hook ──▶ agentscript_compile (auto)

agent loop (the four verbs the user pinned):
  CREATE → INSPECT → CORRECT (mutate) → SELF-RECOVER
   │        │           │                      │
   │        │           │                      ├─ preview {start,send,end,trace}
   │        │           │                      └─ eval {run,get_failure,trace,resolve_active}
   │        │           └─ on-save compile re-runs after every mutate
   │        └─ returns navigable graph: topics, subagents, variables, actions
   └─ scaffolds .agent + bundle-meta.xml from a job spec
```

Every tool returns the same envelope (recommendation #4 / `lib/types.ts`):

```ts
interface ToolResult<T> {
  content: Array<{ type: "text"; text: string }>; // LLM-readable JSON
  details: T | ToolError; // structured
}
interface ToolError {
  ok: false;
  error: string;
  suggestion?: string;
  recover_via?: { tool: string; params: Record<string, unknown> };
}
```

### 1. `agentscript_compile`

Single-purpose. Identical to today's contract, plus per-fix `apply_via`
(recommendation #5).

```ts
input  = { path: string }
output = {
  ok: boolean,
  clean: boolean,
  diagnostic_count: number,
  quick_fix_count: number,
  dialect: { name, version?, unknown?, availableNames? } | null,
  diagnostics: AgentScriptDiagnostic[],
  quick_fixes: Array<{
    title: string,
    preferred: boolean,
    diagnostic_line: number,
    diagnostic_code?: string,
    edits: Array<{ range, newText }>,                  // coordinate fallback
    apply_via: {                                       // <─ NEW
      tool: "agentscript_mutate",
      params: { op: "apply_quick_fix", path, diagnostic_code, line, fix_index }
    },
  }>,
}
```

Powered by vendored `@agentscript/agentforce` `compileSource(source)`. Filters
to severity 1 errors + the actionable severity-2 allowlist. The LLM's
preferred path: invoke the `apply_via` tool call (AST-safe + auto-recompile);
the `edits` array stays as a long-tail fallback for the generic `edit` tool.

### 2. `agentscript_inspect` (NEW)

Single-purpose. Returns a navigable summary so the LLM can locate the right
component without re-reading the file.

```ts
input  = { path: string }
output = {
  ok: boolean,
  dialect: { name, version? },
  components: {
    config?: Record<string, unknown>,
    system?: { instructions: string, ... },           // truncated to 600 chars
    topics: Array<{ name, line, description?, actions: string[],
                    subagent_refs: string[], variables_referenced: string[] }>,
    subagents: Array<{ name, line, ... }>,
    variables: Array<{ name, type, mutable, line, default?: unknown }>,
    actions: Array<{ name, line }>,
  },
  stats: { topics, subagents, variables, actions },
}
```

Implementation: `parseComponent(source)` per kind, walk the AST once, project
the fields. ~120 lines.

### 3. `agentscript_create` (NEW — recommendation #1)

Single-purpose. Scaffolds a new `.agent` file plus its `bundle-meta.xml` from
an optional job spec. Closes the **create** verb. Idea borrowed from
`@salesforce/agents` `ScriptAgent.createAuthoringBundle`; we reimplement.

```ts
input = {
  bundle_name: string,                              // e.g. "Billing_Bot"
  output_dir?: string,                              // default: <pkgDir>/main/default/aiAuthoringBundles/
  template?: "minimal" | "agentforce-default",      // default "agentforce-default"
  job_spec?: {                                      // optional seed
    description?: string,
    agent_user?: string,
    topics?: Array<{ name: string, description?: string }>,
    variables?: Array<{ name: string, type: "string"|"boolean"|"number", mutable?: boolean, default?: unknown }>,
  },
  overwrite?: boolean,                              // default false — refuse if files exist
}

output = {
  ok: true,
  bundle_dir: string,
  agent_path: string,
  meta_path: string,
  diagnostics: AgentScriptDiagnostic[],             // empty when template is clean
  next_steps: Array<{ tool, params }>,              // e.g. [{tool:"agentscript_inspect", params:{path:"..."}}]
}
```

**Implementation (`lib/create.ts`, ~120 lines):**

```ts
export async function createBundle(opts: CreateBundleOptions): Promise<CreateBundleResult> {
  const targetDir =
    opts.output_dir ??
    path.join(
      detectDefaultPackageDir(opts.cwd),
      "main",
      "default",
      "aiAuthoringBundles",
      opts.bundle_name,
    );

  if (!opts.overwrite && existsSync(targetDir)) {
    return toolError(
      `Bundle '${opts.bundle_name}' already exists at ${targetDir}.`,
      "Pass overwrite: true to replace, or pick a different bundle_name.",
    );
  }

  await mkdir(targetDir, { recursive: true });
  const agentPath = path.join(targetDir, `${opts.bundle_name}.agent`);
  const metaPath = path.join(targetDir, `${opts.bundle_name}.bundle-meta.xml`);

  // 1. Generate .agent source from template + optional job_spec
  const source = generateAgentTemplate(
    opts.bundle_name,
    opts.template ?? "agentforce-default",
    opts.job_spec,
  );

  // 2. Validate before writing — don't ship a broken scaffold
  const sdk = loadAgentforceSDK();
  if (sdk) {
    const compile = sdk.compileSource(source);
    if (compile.diagnostics.some((d) => d.severity === 1)) {
      return toolError(
        "Generated bundle failed compile.",
        "This is a template bug. Run /sf-agentscript doctor and report.",
      );
    }
  }

  // 3. Write both files
  await writeFile(agentPath, source, "utf8");
  await writeFile(metaPath, BUNDLE_META_XML_BODY, "utf8");

  // 4. Return next_steps so the LLM has a programmatic continuation
  return {
    ok: true,
    bundle_dir: targetDir,
    agent_path: agentPath,
    meta_path: metaPath,
    diagnostics: [],
    next_steps: [
      { tool: "agentscript_inspect", params: { path: agentPath } },
      {
        tool: "agentscript_preview",
        params: { action: "start", agent_file: agentPath, mock_mode: "Mock" },
      },
    ],
  };
}
```

The `agentforce-default` template ships in `lib/templates/agentforce-default.ts`
as a typed function (not a YAML file) so it stays under our type checker.

### 4. `agentscript_mutate` (NEW)

Multi-action via discriminated union (recommendation #3). AST-safe edits with
coordinate fallback.

```ts
// Discriminated-union schema — typebox enforces per-op required fields.
import { Type } from "typebox";

const MutateParams = Type.Union([
  Type.Object({
    op:        Type.Literal("set_field"),
    path:      Type.String(),
    component: Type.String(),                       // "topic.billing", "variables.is_verified"
    field:     Type.String(),
    value:     Type.Any(),
  }),
  Type.Object({
    op:   Type.Literal("rename"),
    path: Type.String(),
    from: Type.String(),                            // "topic.billing"
    to:   Type.String(),                            // "subagent.billing"
  }),
  Type.Object({
    op:     Type.Literal("insert"),
    path:   Type.String(),
    parent: Type.String(),                          // "topic.billing.before_reasoning"
    child:  Type.Any(),
  }),
  Type.Object({
    op:     Type.Literal("delete"),
    path:   Type.String(),
    target: Type.String(),                          // "topic.billing.before_reasoning"
  }),
  Type.Object({
    op:              Type.Literal("apply_quick_fix"),
    path:            Type.String(),
    diagnostic_code: Type.String(),
    line:            Type.Number(),
    fix_index:       Type.Optional(Type.Number()),  // default 0
  }),
]);

output = {
  ok: boolean,
  applied_via: "ast" | "coord_fallback",
  diff_summary: string,
  bytes_changed: number,
  diagnostics_after: AgentScriptDiagnostic[],
}
```

Implementation: try `Document.mutateComponent(...)` + `emit()` first; on
unsupported shape, fall back to applying the matching coordinate `TextEdit`
from `code-actions.ts`. Always re-compiles after writing so the LLM sees the
post-mutation diagnostics in the same turn.

### 5. `agentscript_preview` (NEW)

Multi-action via discriminated union. Wraps our own minimal preview client
that talks to SFAP endpoints 3, 4, 5, 2 via `@salesforce/core` `Connection`.
Streams progress via `onUpdate` (recommendation #2). Adds `cleanup` action
(recommendation #8).

```ts
const PreviewParams = Type.Union([
  Type.Object({
    action:     Type.Literal("start"),
    target_org: Type.Optional(Type.String()),
    agent_file: Type.Optional(Type.String()),       // path to .agent file
    agent_api_name: Type.Optional(Type.String()),   // OR: existing org agent
    mock_mode:  Type.Optional(Type.Union([Type.Literal("Mock"), Type.Literal("Live Test")])),
  }),
  Type.Object({
    action:     Type.Literal("send"),
    target_org: Type.Optional(Type.String()),
    session_id: Type.String(),
    message:    Type.String(),
  }),
  Type.Object({
    action:     Type.Literal("end"),
    target_org: Type.Optional(Type.String()),
    session_id: Type.String(),
  }),
  Type.Object({
    action:     Type.Literal("trace"),
    target_org: Type.Optional(Type.String()),
    session_id: Type.String(),
    plan_id:    Type.String(),
  }),
  Type.Object({                                     // recommendation #8
    action:           Type.Literal("cleanup"),
    older_than_days:  Type.Optional(Type.Number()), // default: 30
    dry_run:          Type.Optional(Type.Boolean()),// default: false
  }),
]);

returns (per action):
  start   → { session_id, agent_response, started_at, session_dir }
  send    → { agent_response, topic?, invoked_actions?, latency_ms, plan_id, trace_file }
  end     → { ended_at, summary: { turns, plans } }
  trace   → { trace: PlannerResponse, file: string, trace_hint: string }   // see #6
  cleanup → { removed: Array<{agent, session_id, age_days}>, kept_count: number }
```

During `action=send`, progress is streamed via `onUpdate`:
`"Sending message…"` → `"Trace pending…"` → `"Trace captured"`.

Sessions live under the **Salesforce-standard** location
`<cwd>/.sfdx/agents/<aabName>/sessions/<session_id>/` — same layout `@salesforce/agents`
`ScriptAgent` writes, so any sf CLI tooling that reads it (e.g. `sf agent preview`)
stays interoperable.

```
<session_id>/
├── metadata.json        # start, end, agent, mockMode, planIds
├── transcript.jsonl     # one line per turn (user|agent)
└── traces/<plan_id>.json
```

This path lives under `.sfdx/**`, which sf-guardrail blocks by default.
See the **sf-guardrail carve-out** section below — we add a one-line
`allowedPatterns` entry to the `sf-cli-state` rule so writes to
`.sfdx/agents/**` are permitted, while the rest of `.sfdx/**` stays locked
down.

### 6. `agentscript_eval` (multi-action — replaces today's 4 eval tools)

```ts
action: "run" | "get_failure" | "trace" | "resolve_active"

# action=run
spec_path? | spec?: object            // JSON only (no YAML)
target_org?: string
agent_api_name?: string               // required when spec uses $active_*
traces_mode?: "failed" | "all" | "off"
concurrency?: number                  // default 8
prompt_chars?: number                 // default 600
inline_threshold?: number             // default 5

# action=get_failure
run_id: string
test_id?: string                      // omit → return all failures

# action=trace
session_id: string
plan_id: string
target_org?: string

# action=resolve_active
agent_api_name: string
target_org?: string
```

Returns the same hybrid LLM-shape today's `agentscript_eval_run` returns
(inline failures for small runs, summary + run_id for big runs).

**Streaming progress** (recommendation #2). During `action=run` the tool
calls `onUpdate(...)` so the LLM and UI both see progress without polling:

```
"Resolving $active_* placeholders…"
"Running 12 tests across 3 batch(es) (concurrency=8)…"
"  batch 1/3: 5 tests complete"
"  batch 2/3: 5 tests complete"
"  batch 3/3: 2 tests complete"
"Fetching 4 planner trace(s)…"
"Artifacts: <cwd>/.pi/state/sf-agentscript/runs/20260510-XXXXXX-yyyyyy/"
```

**Trace shape hint** (recommendation #6). Every failure record's
`trace_files` includes a sibling `trace_hint` describing the JSON structure:

```json
{
  "trace_hint": "Each file is a PlannerResponse: {steps:[{type:'UserInputStep'|'UpdateTopicStep'|'LLMExecutionStep'|'FunctionCallStep', ...}]}. LLMExecutionStep carries promptContent, promptResponse, executionLatency. Read with the read tool.",
  "trace_files": [ "<run_dir>/traces/<plan_id>.json", ... ]
}
```

## sf-guardrail carve-out

The default sf-guardrail policy blocks all writes under `.sfdx/**`. The new
preview tooling needs to write session artifacts to `.sfdx/agents/<id>/sessions/<sid>/`
(the Salesforce-standard location). Surgical fix: add `allowedPatterns` to
the existing `sf-cli-state` rule — keep the broad `.sfdx/**` block, just carve
out the agents sub-tree.

Diff against `extensions/sf-guardrail/SF_GUARDRAIL_DEFAULTS.json`:

```diff
 {
   "id": "sf-cli-state",
   "description": "SF CLI / sfdx state directories — never edit by hand",
   "patterns": [{ "pattern": ".sf/**" }, { "pattern": ".sfdx/**" }],
+  "allowedPatterns": [
+    { "pattern": ".sfdx/agents/**" }
+  ],
   "protection": "noAccess",
   "blockMessage": "{file} is internal sf CLI state. sf-guardrail blocks direct access; use sf commands instead.",
   "enabled": true,
   "onlyIfExists": false
 }
```

`policies.ts` already short-circuits the rule when any `allowedPatterns` entry
matches first — no code change needed in sf-guardrail itself, just config.

What stays blocked: `.sf/**`, every other `.sfdx/**` path including `.sfdx/tools/**`,
`.sfdx/typings/**`, `.sfdx/orgs/**`, `.sfdx/sfdx-config.json`, etc.

What opens up: `.sfdx/agents/**` only — the upstream Salesforce convention
for agent session artifacts.

Update `extensions/sf-guardrail/SF_GUARDRAIL_PROMPT.md` and `README.md` to
mention the carve-out so users see it in `/sf-guardrail` status.

## File layout (final — includes recommendations)

```
extensions/sf-agentscript/
├── manifest.json                                # tools array reduced to 5 names
├── README.md                                    # rewritten, ≤ 1 screen
├── AGENTS.md                                    # NEW — file map + invariants
├── PROPOSAL.md                                  # this file
├── CREDITS.md
├── index.ts                                     # ~80 lines: register tools + on-save hook + slash command
├── lib/
│   ├── sdk.ts                                   # load vendored @agentscript/agentforce browser.js
│   ├── connection.ts                            # NEW — orgFromAlias() cache, ~30 lines
│   ├── compile.ts                               # checkFile() — kept, ~150 lines
│   ├── inspect.ts                               # NEW — summarize() ~120 lines
│   ├── create.ts                                # NEW — createBundle() ~120 lines (recommendation #1)
│   ├── mutate.ts                                # NEW — applyMutation() ~150 lines
│   ├── templates/
│   │   ├── agentforce-default.ts                # NEW — typed scaffold function
│   │   └── minimal.ts                           # NEW — minimal scaffold
│   ├── feedback.ts                              # tool_result hook, kept ~280 lines
│   ├── code-actions.ts                          # coord-edit fallback only, ~80 lines (was 320)
│   ├── file-classify.ts                         # kept ~35 lines
│   ├── doctor.ts                                # kept, lighter
│   ├── types.ts                                 # kept
│   ├── eval/
│   │   ├── sfap.ts                              # NEW — request(conn,req,policy) with host fallback ~120 lines
│   │   ├── eval-client.ts                       # POST /einstein/evaluation/v1/tests via sfap, ~70 lines
│   │   ├── trace-client.ts                      # GET planner trace via sfap, ~120 lines
│   │   ├── normalize.ts                         # absorbed @salesforce/agents ideas, ~180 lines
│   │   ├── decode.ts                            # kept verbatim
│   │   ├── threshold.ts                         # kept verbatim
│   │   ├── active-ids.ts                        # NEW location — uses conn.query()
│   │   ├── failure-record.ts                    # NEW — split out of render.ts, ~140 lines
│   │   ├── orchestrator.ts                      # tighter, ~250 lines
│   │   ├── persist.ts                           # kept ~140 lines
│   │   └── types.ts                             # kept
│   ├── preview/
│   │   ├── client.ts                            # NEW — start/send/end/trace, ~180 lines
│   │   └── session-store.ts                     # NEW — transcript.jsonl + traces, ~100 lines
│   └── tools/
│       ├── compile.ts                           # ~50 lines
│       ├── inspect.ts                           # ~50 lines
│       ├── create.ts                            # NEW — ~50 lines
│       ├── mutate.ts                            # ~60 lines (discriminated-union schema)
│       ├── preview.ts                           # ~90 lines (incl. cleanup, onUpdate streaming)
│       └── eval.ts                              # ~160 lines (incl. onUpdate streaming)
├── skills/sf-agentscript/SKILL.md               # updated for self-recovery loop + 5-tool surface
├── tests/
│   ├── compile.test.ts                          # kept (was diagnostics.test.ts)
│   ├── feedback.test.ts                         # kept
│   ├── code-actions.test.ts                     # trimmed
│   ├── file-classify.test.ts                    # kept
│   ├── smoke.test.ts                            # kept
│   ├── inspect.test.ts                          # NEW
│   ├── mutate.test.ts                           # NEW
│   ├── eval-normalize.test.ts                   # NEW
│   ├── eval-decode.test.ts                      # NEW
│   ├── eval-threshold.test.ts                   # NEW
│   ├── eval-active-ids.test.ts                  # NEW
│   ├── eval-failure-record.test.ts              # NEW
│   ├── eval-orchestrator.test.ts                # NEW (mocked Connection)
│   ├── preview-client.test.ts                   # NEW (mocked Connection)
│   ├── preview-session-store.test.ts            # NEW
│   ├── create.test.ts                           # NEW (recommendation #1)
│   ├── tool-error-contract.test.ts              # NEW (recommendation #4)
│   └── self-recovery.test.ts                    # NEW (recommendation #10)
└── lib/vendor/agentforce/
    ├── browser.js                               # vendored bundle
    └── UPSTREAM.md                              # pin metadata
```

Total: 16 files in `lib/` + 6 tool files + 18 test files. Targeting **≤ 3 600 LOC**
across the extension (down from ~14 200). The +400 LOC over the previous
target covers `create`, the discriminated-union schemas, the streaming wiring,
and the new tests.

## Implementation by lib

### `lib/types.ts` — shared tool contracts (recommendation #4)

```ts
export interface ToolEnvelope<T> {
  content: Array<{ type: "text"; text: string }>;
  details: T | ToolError;
}

export interface ToolError {
  ok: false;
  error: string;
  suggestion?: string;
  recover_via?: { tool: string; params: Record<string, unknown> };
}

export function toolError(
  error: string,
  suggestion?: string,
  recoverVia?: { tool: string; params: Record<string, unknown> },
): ToolEnvelope<ToolError>;

export function toolOk<T>(details: T, summaryText?: string): ToolEnvelope<T>;
```

Every tool result goes through `toolOk` / `toolError`. The `recover_via` field
is what makes errors actionable: when `agentscript_eval action=run` fails
because the agent isn't found, it returns:

```json
{
  "ok": false,
  "error": "Agent 'Billing_Bot' not found in target org Vivint-DevInt.",
  "suggestion": "Verify the DeveloperName or the active version.",
  "recover_via": {
    "tool": "agentscript_eval",
    "params": { "action": "resolve_active", "agent_api_name": "Billing_Bot" }
  }
}
```

The LLM picks the recovery tool call directly without parsing prose.

Tests: `tool-error-contract.test.ts` asserts every tool's error path produces
a `ToolError` with at least `error` + `suggestion`, and that `recover_via`
points at a registered tool name.

---

## Implementation by lib (continued)

Every file ships with a header docblock describing its single responsibility.
Line targets in parentheses. Public exports are listed with full TypeScript
signatures so review can lock in the contract before code lands.

### `lib/connection.ts` (~50 lines)

Lazy-cached `Org` per alias. Cache invalidates on session lifecycle.

```ts
import { Org, type Connection } from "@salesforce/core";

const orgCache = new Map<string, Promise<Org>>();

/** Resolve a target-org alias (or default) to a cached Org. */
export async function orgFromAlias(targetOrg?: string): Promise<Org>;

/** Convenience: orgFromAlias().getConnection(). */
export async function connFromAlias(targetOrg?: string): Promise<Connection>;

/** Drop all cached orgs. Call on session_start / session_shutdown. */
export function clearConnectionCache(): void;

/** Resolve org metadata (org_id, instance_url, user_id) once per run. */
export async function resolveOrgIdentity(
  conn: Connection,
): Promise<{ org_id: string; instance_url: string; user_id: string }>;
```

**Skeleton:**

```ts
export async function orgFromAlias(targetOrg?: string): Promise<Org> {
  const key = targetOrg ?? "<default>";
  let pending = orgCache.get(key);
  if (!pending) {
    pending = Org.create({ aliasOrUsername: targetOrg }).catch((err) => {
      orgCache.delete(key);
      throw err;
    });
    orgCache.set(key, pending);
  }
  return pending;
}

export async function resolveOrgIdentity(conn: Connection) {
  const userInfo = await conn.identity(); // { user_id, organization_id, ... }
  return {
    org_id: userInfo.organization_id,
    instance_url: conn.instanceUrl,
    user_id: userInfo.user_id,
  };
}
```

**Tests:** `connection.test.ts` — verify cache hit on second call (same
promise reference); verify `clearConnectionCache()` drops; mock `Org.create`
to throw and confirm cache is **not** poisoned.

---

### `lib/sdk.ts` (~40 lines)

Static ESM import of vendored `@agentscript/agentforce`. No more lazy loader.

```ts
import * as Agentforce from "./vendor/agentforce/browser.js";
import type { AgentforceSDK } from "./vendor/agentforce/types.d.ts";

let cached: AgentforceSDK | null = null;
let loadError: string | null = null;

export function loadAgentforceSDK(): AgentforceSDK | null;
export function getSdkLoadError(): string | undefined;

/** Path used in /sf-agentscript doctor output. */
export const VENDORED_SDK_PATH: string;
```

**Skeleton:**

```ts
export function loadAgentforceSDK(): AgentforceSDK | null {
  if (cached) return cached;
  if (loadError) return null;
  const required = [
    "parse",
    "compileSource",
    "parseComponent",
    "mutateComponent",
    "emitComponent",
    "resolveDialect",
  ];
  for (const fn of required) {
    if (typeof (Agentforce as any)[fn] !== "function") {
      loadError = `Vendored SDK missing ${fn}()`;
      return null;
    }
  }
  cached = Agentforce as unknown as AgentforceSDK;
  return cached;
}
```

**Tests:** unit-test the load check; the import path itself is exercised by
every downstream test.

---

### `lib/eval/sfap.ts` (~120 lines)

SFAP host-fallback transport on top of `Connection.request`. Replaces
`lib/eval/http.ts` in full.

```ts
import type { Connection } from "@salesforce/core";

export type HttpMethod = "GET" | "POST";

export interface SfapRequest {
  url: string; // https://api.salesforce.com/...
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number; // default 300_000 POST, 60_000 GET
  maxRetries?: number; // default 2 — 5xx + connection errors only
  fallback?: boolean; // default true — walk api → test.api → dev.api on 404
}

export interface SfapResponse<T = unknown> {
  status: number;
  body: T;
  endpoint: "" | "test." | "dev.";
}

/** Single SFAP call with host fallback + 5xx retry. Never throws on HTTP errors. */
export async function sfapRequest<T>(conn: Connection, req: SfapRequest): Promise<SfapResponse<T>>;
```

**Skeleton:**

```ts
const PREFIXES = ["", "test.", "dev."] as const;
const HOST_RE = /https:\/\/(?:test\.|dev\.)?api\.salesforce\.com/;

function swap(url: string, prefix: string): string {
  return url.replace(HOST_RE, `https://${prefix}api.salesforce.com`);
}

function backoffMs(attempt: number): number {
  return 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
}

async function callOnce<T>(
  conn: Connection,
  url: string,
  req: SfapRequest,
): Promise<{ status: number; body: T }> {
  try {
    const body = await conn.request<T>({
      method: req.method,
      url,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      headers: req.headers,
    });
    return { status: 200, body };
  } catch (err) {
    // jsforce throws { errorCode, message, name } with status info embedded.
    const status = (err as any)?.statusCode ?? inferStatusFromError(err);
    return { status, body: errorAsBody(err) as T };
  }
}

export async function sfapRequest<T>(conn: Connection, req: SfapRequest) {
  const endpoints = req.fallback === false ? [""] : (PREFIXES as readonly string[]);
  const maxRetries = req.maxRetries ?? 2;

  for (let i = 0; i < endpoints.length; i++) {
    const prefix = endpoints[i];
    const isLast = i === endpoints.length - 1;
    const url = swap(req.url, prefix);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const r = await callOnce<T>(conn, url, req);

      if (r.status >= 200 && r.status < 300) {
        return { status: r.status, body: r.body, endpoint: prefix as any };
      }
      if (r.status === 404 && !isLast) break; // walk
      if (r.status >= 500 && r.status < 600 && attempt < maxRetries) {
        await sleep(backoffMs(attempt)); // retry
        continue;
      }
      if (r.status >= 400 && r.status < 500) {
        return { status: r.status, body: r.body, endpoint: prefix as any };
      }
      if (attempt === maxRetries) {
        return { status: r.status, body: r.body, endpoint: prefix as any };
      }
    }
  }
  return { status: 404, body: {} as T, endpoint: "dev." };
}
```

**Invariants:**

- Never throws on HTTP errors — caller decides what to do with non-200.
- 4xx terminal except 404 with more endpoints to try.
- 5xx + connection errors retry on the **same** endpoint.
- Auth refresh is `Connection`'s job; we don't catch 401 specially.

**Tests:** `sfap.test.ts` — mock `Connection.request` to return 200/404/500/503
in different sequences; verify host walk, retry count, and backoff is awaited
(use vitest fake timers).

---

### `lib/eval/normalize.ts` (~180 lines)

Six passes, each independently exported and tested. Ideas absorbed from
`@salesforce/agents/src/evalNormalizer.ts`; we own the implementation.

```ts
export function normalizeSpec(spec: EvalSpec): EvalSpec; // composition

export function normalizeMcpShorthand(steps: EvalStep[]): EvalStep[];
export function autoCorrectFields(steps: EvalStep[]): EvalStep[];
export function normalizeCamelCase(steps: EvalStep[]): EvalStep[];
export function normalizeEvaluatorFields(steps: EvalStep[]): EvalStep[];
export function convertShorthandRefs(steps: EvalStep[]): EvalStep[];
export function injectDefaults(steps: EvalStep[]): EvalStep[];
```

**Composition:**

```ts
export function normalizeSpec(spec: EvalSpec): EvalSpec {
  return {
    ...spec,
    tests: (spec.tests ?? []).map((t) => ({
      ...t,
      steps: pipe(
        t.steps ?? [],
        normalizeMcpShorthand,
        autoCorrectFields,
        normalizeCamelCase,
        normalizeEvaluatorFields,
        convertShorthandRefs,
        injectDefaults,
        // Note: we deliberately DO NOT call stripUnrecognizedFields —
        // preserves `context_variables` on agent.send_message (mutable-seed workaround).
      ),
    })),
  };
}
```

**Per-pass detail:**

- `normalizeMcpShorthand` — `{type:"evaluator", evaluator_type:"x"}` →
  `{type:"evaluator.x"}`. Maps `field:"sm.planner_state.topic"` →
  `actual:"{sm.response.planner_response.lastExecution.topic}"` via the
  same MCP_FIELD_MAP shape upstream uses. Auto-injects `id:"eval_N"`.
- `autoCorrectFields` — for `agent.*`: `agentId→agent_id`, `agentVersionId→agent_version_id`,
  `sessionId→session_id`, `text|message|input|prompt|user_message|userMessage→utterance`.
  For `evaluator.*`: `subject→actual`, `expectedValue→expected`, `assertionType|comparator→operator`.
- `normalizeCamelCase` — only touches `agent.create_session`:
  `useAgentApi→use_agent_api`, `plannerId|plannerDefinitionId|planner_definition_id|plannerVersionId|planner_version_id→planner_id`.
- `normalizeEvaluatorFields` — splits scoring vs assertion:
  scoring (`text_alignment`, `hallucination_detection`, `citation_recall`, `answer_faithfulness`)
  uses `generated_output|reference_answer`; assertion (`string_assertion`, `json_assertion`)
  uses `actual|expected`. Auto-lowercase `operator`. Auto-inject `metric_name`
  with the per-evaluator default (e.g. `text_alignment` → `base.cosine_similarity`).
- `convertShorthandRefs` — `{stepId.field}` → `$.outputs[N].field` using a
  step-id → output-index map built from non-evaluator steps. Already correct
  in today's code; port verbatim.
- `injectDefaults` — `agent.create_session` gets `use_agent_api: true` if
  neither it nor `planner_id` is set.

**Tests:** `eval-normalize.test.ts` — one test per pass with a fixture step
showing the expected before/after. Plus a composition test using a real spec
from `tests/fixtures/specs/`.

---

### `lib/eval/active-ids.ts` (~80 lines)

Replaces today's `sf data query` shelling with `conn.query()`.

```ts
import type { Connection } from "@salesforce/core";

export interface ResolvedAgentIds {
  bot_id: string;
  bot_version_id: string;
  planner_id: string | null;
  version_number: number;
}

export async function resolveActiveIds(
  conn: Connection,
  agentApiName: string,
): Promise<ResolvedAgentIds>;

/** Substitute `$active_*` placeholders in any JSON-shaped value. */
export function substitutePlaceholders<T>(value: T, ids: ResolvedAgentIds): T;

/** Cheap textual scan to skip resolveActiveIds() when no placeholder is used. */
export function specHasActivePlaceholders(spec: unknown): boolean;
```

**Skeleton:**

```ts
function soqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

export async function resolveActiveIds(conn: Connection, agentApiName: string) {
  const esc = soqlEscape(agentApiName);

  const bots = await conn.query<{ Id: string }>(
    `SELECT Id FROM BotDefinition WHERE DeveloperName='${esc}'`,
  );
  if (bots.records.length === 0) {
    throw new Error(
      `Agent '${agentApiName}' not found in target org. ` +
        `Suggested fix: verify the DeveloperName via ` +
        `\`sf data query -q "SELECT Id, DeveloperName FROM BotDefinition"\`.`,
    );
  }
  const bot_id = bots.records[0].Id;

  const versions = await conn.query<{ Id: string; VersionNumber: number }>(
    `SELECT Id, VersionNumber FROM BotVersion ` +
      `WHERE BotDefinitionId='${bot_id}' AND Status='Active' ` +
      `ORDER BY VersionNumber DESC LIMIT 1`,
  );
  if (versions.records.length === 0) {
    throw new Error(`No Active BotVersion for '${agentApiName}'.`);
  }
  const { Id: bot_version_id, VersionNumber: version_number } = versions.records[0];

  const planners = await conn.query<{ Id: string }>(
    `SELECT Id FROM GenAiPlannerDefinition ` +
      `WHERE DeveloperName='${esc}_v${version_number}' LIMIT 1`,
  );

  return { bot_id, bot_version_id, planner_id: planners.records[0]?.Id ?? null, version_number };
}
```

**Invariants:** Active version ≠ latest version. We resolve **Active**
deliberately. Today's behavior is preserved.

**Tests:** `eval-active-ids.test.ts` — mock `conn.query` with each of the three
SOQL shapes; verify error messages on each missing-row case.

---

### `lib/eval/eval-client.ts` (~70 lines)

Thin wrapper around `sfapRequest` for the eval endpoint.

```ts
import type { Connection } from "@salesforce/core";
import { sfapRequest } from "./sfap.ts";
import type { EvalApiResponse, EvalTest } from "./types.ts";

export const EVAL_URL = "https://api.salesforce.com/einstein/evaluation/v1/tests";
export const EVAL_BATCH_SIZE = 5;

export interface EvalApiHeaders {
  orgId: string;
  userId: string;
  instanceUrl: string;
}

export function buildEvalHeaders(h: EvalApiHeaders): Record<string, string>;
export async function callEval(
  conn: Connection,
  tests: EvalTest[],
  headers: EvalApiHeaders,
): Promise<{ status: number; body: EvalApiResponse }>;
export function splitIntoBatches(tests: EvalTest[]): EvalTest[][];
```

Headers verbatim from today: `x-sfdc-core-tenant-id: core/prod/<orgId>`,
`x-org-id`, `x-sfdc-core-instance-url`, `x-sfdc-user-id`,
`x-client-feature-id: AIPlatformEvaluation`, `x-sfdc-app-context: EinsteinGPT`.

---

### `lib/eval/trace-client.ts` (~120 lines)

Planner-trace fan-out via `sfapRequest`. Same dedup/concurrency model as today.

```ts
export interface PlanKey {
  testId: string;
  sessionId: string;
  planId: string;
}

export async function fetchTrace(
  conn: Connection,
  sessionId: string,
  planId: string,
): Promise<unknown | null>;

export async function fetchTracesConcurrent(
  conn: Connection,
  keys: PlanKey[],
  opts?: { concurrency?: number; log?: (msg: string) => void },
): Promise<Map<string, unknown | null>>;

export function collectPlanKeys(
  merged: EvalApiResponse,
  opts?: { onlyFailed?: boolean },
): PlanKey[];
```

---

### `lib/eval/decode.ts` & `lib/eval/threshold.ts`

**Kept verbatim.** Already correct. No public API change.

---

### `lib/eval/failure-record.ts` (~140 lines)

Split out of today's `render.ts`. Builds the LLM-debug `FailureRecord`. Pure
functions only — no I/O.

```ts
export interface BuildOptions {
  promptChars?: number; // default 600
  interestingStateKeys?: readonly string[]; // default DEFAULT_INTERESTING_STATE_KEYS
  tracesDir?: string;
}

export const DEFAULT_INTERESTING_STATE_KEYS: readonly string[];

export function buildTurnSummary(
  turnId: string,
  sendOut: EvalOutput,
  stateOut: EvalOutput | undefined,
  opts?: BuildOptions,
): TurnSummary;

export function buildFailureRecord(
  test: TestResult,
  groupedEvals: EvalResult[],
  opts?: BuildOptions,
): FailureRecord;

export function summarize(
  merged: EvalApiResponse,
  opts?: BuildOptions,
): { totals: RunTotals; failures: FailureRecord[]; groupedByTest: Map<string, EvalResult[]> };

export function latencySummary(latencies: number[]): LatencySummary;
```

The `TurnSummary` and `FailureRecord` shapes are pinned to today's contract by
snapshot tests (this is what `failures.jsonl` lines look like to the LLM).

---

### `lib/eval/orchestrator.ts` (~250 lines)

The high-level pipeline. Same 8 phases as today, swapped to `Connection`.

```ts
import type { Connection } from "@salesforce/core";

export interface RunEvalOptions {
  spec: EvalSpec;
  conn: Connection; // already resolved by caller
  targetOrgAlias: string; // recorded in metadata only
  agentApiName?: string;
  tracesMode?: TracesMode; // default "failed"
  concurrency?: number; // default 8
  promptChars?: number; // default 600
  cwd: string;
  specPath?: string;
  noPersist?: boolean;
  runBase?: string;
  log?: (msg: string) => void;
  interestingStateKeys?: readonly string[];
}

export interface RunEvalResult {
  /* unchanged from today */
}

export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult>;
export async function readFailures(
  cwd: string,
  runId: string,
  runBase?: string,
): Promise<FailureRecord[]>;
export async function readMetadata(
  cwd: string,
  runId: string,
  runBase?: string,
): Promise<RunMetadata | null>;
export async function recordRunInIndex(cwd: string, runId: string, runBase?: string): Promise<void>;
```

**Pipeline:**

```ts
export async function runEval(opts: RunEvalOptions): Promise<RunEvalResult> {
  const { conn, log = () => {} } = opts;
  const startedAt = new Date();
  const tracesMode = opts.tracesMode ?? "failed";
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const runId = newRunId(startedAt);

  // 1. $active_* resolution (skipped if spec has no placeholders)
  let spec = opts.spec;
  let resolvedIds: ResolvedAgentIds | null = null;
  if (specHasActivePlaceholders(spec)) {
    if (!opts.agentApiName) throw new Error("agentApiName required for $active_* placeholders");
    resolvedIds = await resolveActiveIds(conn, opts.agentApiName);
    spec = substitutePlaceholders(spec, resolvedIds);
  }

  // 2. Normalize
  spec = normalizeSpec(spec);

  // 3. Org identity for SFAP headers
  const ident = await resolveOrgIdentity(conn);
  const headers: EvalApiHeaders = {
    orgId: ident.org_id, userId: ident.user_id, instanceUrl: ident.instance_url,
  };

  // 4. Batch + fan out
  const tests = spec.tests ?? [];
  if (tests.length === 0) throw new Error("Spec contains no tests; nothing to do.");
  const batches = splitIntoBatches(tests);
  const sema = makeSemaphore(concurrency);
  const results: EvalApiResponse["results"][] = new Array(batches.length).fill(null);
  let failedBatches = 0;

  await Promise.all(
    batches.map((b, idx) =>
      sema(async () => {
        const r = await callEval(conn, b, headers);
        if (r.status >= 200 && r.status < 300) {
          results[idx] = r.body.results ?? [];
        } else {
          failedBatches++;
          log(`  batch ${idx + 1}/${batches.length}: HTTP ${r.status}`);
          results[idx] = [];
        }
      }),
    ),
  );

  // 5. Merge + HTML decode
  const merged = deepDecode<EvalApiResponse>({ results: results.flatMap((r) => r ?? []) });

  // 6. Trace fan-out
  let traces = new Map<string, unknown | null>();
  if (tracesMode !== "off") {
    const planKeys = collectPlanKeys(merged, { onlyFailed: tracesMode === "failed" });
    if (planKeys.length > 0) {
      traces = await fetchTracesConcurrent(conn, planKeys, { concurrency, log });
    }
  }

  // 7. Build summary + failure records
  const buildOpts: BuildOptions = {
    promptChars: opts.promptChars,
    interestingStateKeys: opts.interestingStateKeys,
    tracesDir: !opts.noPersist && traces.size > 0
      ? path.join(resolveRunDir(opts.cwd, runId, opts.runBase), "traces")
      : undefined,
  };
  const { totals, failures } = summarize(merged, buildOpts);
  const lat = latencySummary(totals.latencies);

  // 8. Persist
  const metadata: RunMetadata = buildMetadata({...});
  let runDir: string | undefined;
  if (!opts.noPersist) {
    runDir = resolveRunDir(opts.cwd, runId, opts.runBase);
    await writeRun({ runDir, merged, traces, metadata, failures });
  }

  return { run_id: runId, run_dir: runDir, totals, latency: lat,
           failures, merged, metadata, failed_batches: failedBatches };
}
```

**Tests:** `eval-orchestrator.test.ts` — mock `Connection.request` and
`Connection.query` to play canned responses; verify the run produces a
fixture-equivalent `failures.jsonl` and `metadata.json`.

---

### `lib/eval/persist.ts` (~140 lines)

**Kept.** Same on-disk layout. Only change: anchor for the run base directory
remains `<cwd>/.pi/state/sf-agentscript/runs/` (eval runs are sf-pi
artifacts, not Salesforce CLI state — stays under `.pi/`).

---

### `lib/inspect.ts` (~120 lines)

NEW. Walks the `Document` AST once, projects a navigable summary.

```ts
export interface InspectResult {
  ok: boolean;
  reason?: "sdk_unavailable" | "read_failed" | "parse_failed";
  dialect?: { name: string; version?: string };
  components?: {
    config?: Record<string, unknown>;
    system?: { instructions: string; agent_type?: string };
    topics: TopicSummary[];
    subagents: SubagentSummary[];
    variables: VariableSummary[];
    actions: ActionSummary[];
  };
  stats?: { topics: number; subagents: number; variables: number; actions: number };
}

export async function inspectFile(filePath: string): Promise<InspectResult>;
```

**Skeleton:**

```ts
export async function inspectFile(filePath: string): Promise<InspectResult> {
  const sdk = loadAgentforceSDK();
  if (!sdk) return { ok: false, reason: "sdk_unavailable" };

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  let doc: ReturnType<typeof sdk.parse>;
  try {
    doc = sdk.parse(source);
  } catch {
    return { ok: false, reason: "parse_failed" };
  }

  const ast = doc.ast as ParsedAgentforce;

  return {
    ok: true,
    dialect: extractDialect(doc, sdk),
    components: {
      config: ast.config?.toJSON ? ast.config.toJSON() : ast.config,
      system: extractSystem(ast),
      topics: walkTopics(ast), // collects @actions.* and @subagent.* refs per topic
      subagents: walkSubagents(ast),
      variables: walkVariables(ast),
      actions: walkActions(ast),
    },
    stats: {
      topics: ast.topic?.size ?? 0,
      subagents: ast.subagent?.size ?? 0,
      variables: ast.variables?.size ?? 0,
      actions: ast.actions?.size ?? 0,
    },
  };
}
```

Reference walking uses `walkAstExpressions` from the SDK (already exposed).

**Tests:** `inspect.test.ts` — golden file: feed a representative `.agent`
fixture, snapshot the result.

---

### `lib/mutate.ts` (~150 lines)

NEW. Five ops, AST primary, coordinate fallback for `apply_quick_fix`.

```ts
export type MutateOp =
  | { op: "set_field"; path: string; component: string; field: string; value: unknown }
  | { op: "rename"; path: string; from: string; to: string }
  | { op: "insert"; path: string; parent: string; child: unknown }
  | { op: "delete"; path: string; target: string }
  | {
      op: "apply_quick_fix";
      path: string;
      diagnostic_code: string;
      line: number;
      fix_index?: number;
    };

export interface MutateResult {
  ok: boolean;
  reason?: string;
  applied_via?: "ast" | "coord_fallback";
  diff_summary?: string;
  bytes_changed?: number;
  diagnostics_after?: AgentScriptDiagnostic[];
}

export async function applyMutation(op: MutateOp): Promise<MutateResult>;
```

**Skeleton:**

```ts
export async function applyMutation(op: MutateOp): Promise<MutateResult> {
  const sdk = loadAgentforceSDK();
  if (!sdk) return { ok: false, reason: "sdk_unavailable" };

  const sourceBefore = await fs.readFile(op.path, "utf8");
  const doc = sdk.parse(sourceBefore);
  if (doc.hasErrors) return { ok: false, reason: "parse_errors_present" };

  // 1. AST path
  const ast = await tryAstMutation(doc, op);
  if (ast.ok) {
    const after = doc.emit();
    await fs.writeFile(op.path, after, "utf8");
    const recompile = await checkAgentScriptFile(op.path);
    return {
      ok: true,
      applied_via: "ast",
      diff_summary: ast.diffSummary,
      bytes_changed: after.length - sourceBefore.length,
      diagnostics_after: recompile.diagnostics,
    };
  }

  // 2. Coordinate fallback (apply_quick_fix only)
  if (op.op === "apply_quick_fix") {
    const synthDiag = synthesizeDiagnostic(op);
    const fixes = buildQuickFixes(sourceBefore, [synthDiag]);
    const fix = fixes[op.fix_index ?? 0];
    if (!fix) return { ok: false, reason: "no_fix_available" };
    const after = applyTextEdits(sourceBefore, fix.edits);
    await fs.writeFile(op.path, after, "utf8");
    const recompile = await checkAgentScriptFile(op.path);
    return {
      ok: true,
      applied_via: "coord_fallback",
      diff_summary: fix.title,
      bytes_changed: after.length - sourceBefore.length,
      diagnostics_after: recompile.diagnostics,
    };
  }

  return { ok: false, reason: ast.reason ?? "ast_unsupported" };
}

async function tryAstMutation(doc: Document, op: MutateOp) {
  switch (op.op) {
    case "set_field":
      return astSetField(doc, op);
    case "rename":
      return astRename(doc, op);
    case "insert":
      return astInsert(doc, op);
    case "delete":
      return astDelete(doc, op);
    case "apply_quick_fix":
      return astApplyQuickFix(doc, op); // unsupported = falls through
  }
}
```

`astSetField` → `doc.mutateComponent({ kind: "topic" | "subagent" | "variables" | ..., name, set: { [field]: value } })`.
`astRename` → for `topic.X → subagent.X`, the SDK supports renaming the keyword;
we also rewrite `@topic.X` references using `walkAstExpressions` (same pattern
as the upstream `code-actions.ts` `buildTopicToSubagentEdits`).

**Invariants:**

- Never write the file if mutation didn't change `emit()` output (skip noop writes).
- Always re-compile after writing so the LLM sees fresh diagnostics in the same turn.
- Refuse to mutate if the source already has parse errors (would emit a corrupt file).

**Tests:** `mutate.test.ts` — one round-trip per op; assert structure changed
as expected and `diagnostics_after` is empty.

---

### `lib/preview/session-store.ts` (~100 lines)

NEW. Salesforce-standard session layout under `.sfdx/agents/<aabName>/sessions/<sessionId>/`.
Backs the `agentscript_preview` tool.

```ts
export interface PreviewMetadata {
  sessionId: string;
  agentName: string;
  startTime: string;
  endTime?: string;
  mockMode: "Mock" | "Live Test";
  planIds: string[];
}

export interface TranscriptEntry {
  timestamp: string;
  agentName: string;
  sessionId: string;
  role: "user" | "agent";
  text?: string;
  raw?: unknown;
  reason?: string; // present on end entry
}

export function getSessionDir(cwd: string, agentName: string, sessionId: string): string;

export async function initSession(
  cwd: string,
  meta: Omit<PreviewMetadata, "endTime" | "planIds">,
): Promise<string>; // returns the session dir

export async function logTurn(sessionDir: string, entry: TranscriptEntry): Promise<void>;

export async function logTrace(sessionDir: string, planId: string, trace: unknown): Promise<void>;

export async function endSession(sessionDir: string, endTime: string): Promise<PreviewMetadata>;

export async function loadSession(
  cwd: string,
  agentName: string,
  sessionId: string,
): Promise<{ metadata: PreviewMetadata; transcript: TranscriptEntry[] }>;
```

**On-disk layout:**

```
<cwd>/.sfdx/agents/<agentName>/sessions/<sessionId>/
├── metadata.json        { sessionId, agentName, startTime, endTime?, mockMode, planIds[] }
├── transcript.jsonl     append-only; one TranscriptEntry per line
└── traces/
    └── <planId>.json    full PlannerResponse from /sessions/{sid}/plans/{pid}
```

**Tests:** `preview-session-store.test.ts` — round-trip a session: `initSession`
→ 2× `logTurn` → 2× `logTrace` → `endSession` → `loadSession`; assert `planIds`
were accumulated and `transcript.jsonl` has the right line count.

---

### `lib/preview/client.ts` (~180 lines)

NEW. Minimal `ScriptAgent`-equivalent. No `@salesforce/agents` import. Talks
to SFAP via `sfapRequest` + the org's `Connection`.

```ts
export interface PreviewStartOptions {
  conn: Connection;
  cwd: string;
  agentName: string; // AAB name OR a stable id
  agentSource: string; // .agent file content (compiled server-side)
  mockMode: "Mock" | "Live Test";
  defaultAgentUserName?: string; // resolved from compile result if omitted
}

export interface PreviewStartResult {
  sessionId: string;
  agentResponse: string;
  startedAt: string;
  sessionDir: string;
}

export async function startPreview(opts: PreviewStartOptions): Promise<PreviewStartResult>;

export interface PreviewSendOptions {
  conn: Connection;
  cwd: string;
  agentName: string;
  sessionId: string;
  message: string;
}

export interface PreviewSendResult {
  agentResponse: string;
  topic?: string;
  invokedActions?: string[];
  latencyMs?: number;
  planId: string;
  traceFile: string; // where we wrote the trace to disk
}

export async function sendMessage(opts: PreviewSendOptions): Promise<PreviewSendResult>;
export async function endSession(opts: {
  conn: Connection;
  cwd: string;
  agentName: string;
  sessionId: string;
}): Promise<PreviewMetadata>;
export async function getTrace(opts: {
  conn: Connection;
  sessionId: string;
  planId: string;
}): Promise<unknown>;
```

**Endpoints (port verbatim from upstream `ScriptAgent`):**

```
POST  /einstein/ai-agent/v1.1/authoring/scripts          — server-side compile
POST  /einstein/ai-agent/v1.1/preview/sessions           — start session
POST  /einstein/ai-agent/v1.1/preview/sessions/{sid}/messages   — send message
GET   /einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid} — fetch trace
```

**`startPreview` skeleton:**

```ts
export async function startPreview(opts: PreviewStartOptions): Promise<PreviewStartResult> {
  // 1. Server-side compile to get agentJson
  const compileResp = await sfapRequest<CompileResponse>(opts.conn, {
    url: "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts",
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: {
      assets: [{ type: "AFScript", name: "AFScript", content: opts.agentSource }],
      afScriptVersion: "2.0.0",
    },
  });
  if (compileResp.status !== 200 || compileResp.body.status !== "success") {
    throw new Error(`Compile failed: ${JSON.stringify(compileResp.body).slice(0, 600)}`);
  }
  const agentJson = compileResp.body.compiledArtifact;

  // 2. bypassUser rule (verbatim from upstream)
  let bypassUser = false;
  if (opts.defaultAgentUserName) {
    const r = await opts.conn.query<{ Id: string }>(
      `SELECT Id FROM User WHERE Username='${soqlEscape(opts.defaultAgentUserName)}'`,
    );
    bypassUser = r.totalSize === 1;
  }
  if (bypassUser && agentJson.globalConfiguration.agentType === "AgentforceEmployeeAgent") {
    bypassUser = false;
  }

  // 3. Start session
  const sessionResp = await sfapRequest<SessionStartResponse>(opts.conn, {
    url: "https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions",
    method: "POST",
    headers: {
      "x-attributed-client": "no-builder",
      "x-client-name": "sf-pi",
      "content-type": "application/json",
    },
    body: {
      agentDefinition: agentJson,
      enableSimulationMode: opts.mockMode === "Mock",
      externalSessionKey: randomUUID(),
      instanceConfig: { endpoint: opts.conn.instanceUrl },
      variables: [],
      parameters: {},
      streamingCapabilities: { chunkTypes: ["Text", "LightningChunk"] },
      richContentCapabilities: {},
      bypassUser,
      executionHistory: [],
      conversationContext: [],
    },
  });
  if (sessionResp.status !== 200) {
    throw new Error(`Session start failed: HTTP ${sessionResp.status}`);
  }

  // 4. Init session store + write first turn
  const startTime = new Date().toISOString();
  const sessionId = sessionResp.body.sessionId;
  const sessionDir = await initSession(opts.cwd, {
    sessionId,
    agentName: opts.agentName,
    startTime,
    mockMode: opts.mockMode,
  });
  const initialMsg = sessionResp.body.messages.map((m) => m.message).join("\n");
  await logTurn(sessionDir, {
    timestamp: startTime,
    agentName: opts.agentName,
    sessionId,
    role: "agent",
    text: initialMsg,
    raw: sessionResp.body.messages,
  });

  return { sessionId, agentResponse: initialMsg, startedAt: startTime, sessionDir };
}
```

**`sendMessage`** does: log user turn → POST messages → log agent turn →
fetch trace → write trace to `traces/<planId>.json`. Same pattern as upstream
`ScriptAgent.sendMessage`.

**Tests:** `preview-client.test.ts` — mock `Connection.request` + `Connection.query`
to return canned compile / session / messages / trace responses; assert
`session-store` files were written correctly.

---

### `lib/compile.ts` (~150 lines)

Kept; trimmed. The vendored SDK now imports statically (no async load)
and the function is purely `(filePath) → AgentScriptCheckResult`.

```ts
export async function checkAgentScriptFile(filePath: string): Promise<AgentScriptCheckResult>;
```

Behavior identical to today: severity 1 always; severity 2 for actionable
codes only (`deprecated-field`, `unused-variable`, `invalid-version`,
`unknown-dialect`, `invalid-modifier`, `unknown-type`); 3+ dropped.

**Tests:** `compile.test.ts` — port today's `diagnostics.test.ts` verbatim.

---

### `lib/feedback.ts` (~280 lines)

Kept verbatim. The on-save hook contract — "LSP feedback:" / "LSP now clean:"
/ "LSP setup note:" — stays byte-equivalent. Wired the same way:
`pi.on("tool_result", handleToolResult)`.

---

### `lib/code-actions.ts` (~80 lines)

Shrunk. Today's 320 lines covered five fix builders + Levenshtein closest-match.
The AST mutation lives in `mutate.ts` now; `code-actions.ts` keeps only:

- `buildQuickFixes(source, diagnostics)` — returns the same coordinate `TextEdit`s today's compile-on-save renders to the LLM.
- The five per-code builders (`buildSuggestionFix`, `buildUnknownDialectFixes`, `buildDeprecatedFieldFix`, `buildUnusedVariableFix`, `buildInvalidVersionFixes`).
- `editDistance` + `bestSuggestion` (small typo finder).

Used by:

1. `compile.ts` to surface fixes in compile-on-save feedback (today's behavior).
2. `mutate.ts` as the coordinate fallback for `apply_quick_fix`.

---

### `lib/tools/*.ts` (5 files, ~50–150 lines each)

Each tool file is the same shape: `register<Name>Tool(pi)`, define typebox
schema, dispatch to the corresponding `lib/` function. Examples:

- `tools/compile.ts` — calls `checkAgentScriptFile` (today's contract).
- `tools/inspect.ts` — calls `inspectFile`, returns the JSON shape verbatim.
- `tools/mutate.ts` — typebox `op` enum dispatched to `applyMutation`.
- `tools/preview.ts` — `action` enum dispatched to `startPreview` / `sendMessage` / `endSession` / `getTrace`.
- `tools/eval.ts` — `action` enum dispatched to `runEval` / `readFailures` / `fetchTrace` / `resolveActiveIds`.

Every tool must:

1. Resolve `target_org` (or use sf-pi default).
2. Get a cached `Connection` via `connFromAlias(targetOrg)`.
3. Surface errors as `{ok:false, error: "<message>. Suggested fix: <hint>."}`.
4. Return both `content[0].text` (LLM-readable JSON) and `details` (structured object for sf-pi UI).

---

### `lib/create.ts` (~120 lines, recommendation #1)

Scaffold a new `.agent` + `bundle-meta.xml`. Idea borrowed from
`@salesforce/agents` `ScriptAgent.createAuthoringBundle`; we own the
implementation.

```ts
export interface CreateBundleOptions {
  cwd: string;
  bundle_name: string;
  output_dir?: string;
  template?: "minimal" | "agentforce-default";
  job_spec?: AgentJobSpec; // optional seed
  overwrite?: boolean;
}

export interface AgentJobSpec {
  description?: string;
  agent_user?: string;
  topics?: Array<{ name: string; description?: string }>;
  variables?: Array<{
    name: string;
    type: "string" | "boolean" | "number";
    mutable?: boolean;
    default?: unknown;
  }>;
}

export interface CreateBundleResult {
  bundle_dir: string;
  agent_path: string;
  meta_path: string;
  diagnostics: AgentScriptDiagnostic[];
  next_steps: Array<{ tool: string; params: Record<string, unknown> }>;
}

export async function createBundle(opts: CreateBundleOptions): Promise<CreateBundleResult>;
```

Key rules:

- **Validate before writing.** Compile the generated source; refuse to write
  if severity-1 errors are present (template bug — surface in doctor).
- **Refuse to overwrite by default.** Returning `{ok:false, recover_via:{...overwrite:true}}`
  lets the LLM re-attempt explicitly.
- **Default location matches Salesforce convention.**
  `<defaultPackageDir>/main/default/aiAuthoringBundles/<bundle_name>/`.

**Tests:** `create.test.ts` — fresh bundle, conflict refusal, overwrite path,
job_spec with topics + variables, generated bundle compiles clean.

---

### `lib/templates/agentforce-default.ts` (~80 lines)

A typed function (not a YAML or string template) that emits a syntactically
valid `agentforce` dialect `.agent` source. Centralizes our notion of "a
reasonable starting point" so we can update it once.

```ts
export function generateAgentforceDefault(bundleName: string, jobSpec?: AgentJobSpec): string;
```

Returns something like:

```
config:
    agent_name: "Billing_Bot"
    default_locale: "en_US"

system:
    instructions: |
        You are a helpful agent.

variables:
    is_verified: mutable boolean = False
        description: "Whether the user has been identity-verified"

topic billing:
    description: "Handle billing inquiries"
    actions:
        - lookup_case
```

Topics and variables seeded from `jobSpec` are appended idempotently.

---

## Today's implementation vs proposed — module-by-module

### `lib/connection.ts` — cached Org/Connection

```ts
import { Org, type Connection } from "@salesforce/core";

const cache = new Map<string, Promise<Org>>();

export async function orgFromAlias(targetOrg?: string): Promise<Org> {
  const key = targetOrg ?? "<default>";
  let p = cache.get(key);
  if (!p) {
    p = Org.create({ aliasOrUsername: targetOrg }).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, p);
  }
  return p;
}

export async function connFromAlias(targetOrg?: string): Promise<Connection> {
  return (await orgFromAlias(targetOrg)).getConnection();
}

export function clearConnectionCache(): void {
  cache.clear();
}
```

Cache invalidates on `session_start` / `session_shutdown`. One `Org.create()` per
alias per session. `Connection.request()` handles auto-refresh internally.

### `lib/eval/sfap.ts` — SFAP host fallback + 5xx retry

```ts
export interface SfapRequest {
  url: string; // https://api.salesforce.com/...
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number; // default 300_000 for POST, 60_000 for GET
  maxRetries?: number; // default 2 — 5xx + connection errors only
  fallback?: boolean; // default true — walk api → test.api → dev.api on 404
}

export interface SfapResponse<T> {
  status: number;
  body: T;
  endpoint: "" | "test." | "dev.";
}

const PREFIXES = ["", "test.", "dev."] as const;
const HOST_RE = /https:\/\/(?:test\.|dev\.)?api\.salesforce\.com/;

export async function sfapRequest<T>(conn: Connection, req: SfapRequest): Promise<SfapResponse<T>> {
  // For each prefix, try up to maxRetries on 5xx with jittered backoff.
  // 4xx → terminal (return as-is). 404 → walk to next prefix.
  // Use conn.request<T>({url, method, headers, body}, {timeout:..., httpAgent}).
}
```

Replaces today's `lib/eval/http.ts`. Same retry policy (5xx-only, jittered
1s/2s/4s + 500ms jitter), same fallback walk. Half the lines: no subprocess,
no stdout parsing, no `inferStatus` regex hacks — `Connection.request()` returns
typed errors.

### `lib/eval/normalize.ts` — ideas absorbed from `@salesforce/agents`

Six passes, in this order. Each is a top-level export so tests can call them
individually:

1. `normalizeMcpShorthand(steps)` — `type:"evaluator"` + `evaluator_type:"x"` →
   `type:"evaluator.x"`; `field:"sm.planner_state.topic"` → `actual:"{sm.response.planner_response.lastExecution.topic}"`; auto `id:"eval_N"`.
2. `autoCorrectFields(steps)` — agent step typos: `agentId→agent_id`, `text→utterance`, `assertionType→operator`, etc.
3. `normalizeCamelCase(steps)` — `useAgentApi→use_agent_api`, planner aliases.
4. `normalizeEvaluatorFields(steps)` — scoring aliases (`actual→generated_output`), assertion aliases (`actual_value→actual`), auto-lowercase `operator`, auto-inject `metric_name`.
5. `convertShorthandRefs(steps)` — `{stepId.field}` → `$.outputs[N].field` using a step-id → output-index map. (Already in our normalize today; keep verbatim.)
6. `injectDefaults(steps)` — `use_agent_api: true` on `agent.create_session` if neither it nor `planner_id` is set.

**Skip `stripUnrecognizedFields`.** The Vivint regression suite needs
`context_variables` on `agent.send_message`; the upstream whitelist would strip
it. Permissive normalization preserves the workaround. (Same call we make today.)

### `lib/eval/active-ids.ts` — `$active_*` resolver

```ts
export interface ResolvedAgentIds {
  bot_id: string;
  bot_version_id: string;
  planner_id: string | null;
  version_number: number;
}

export async function resolveActiveIds(
  conn: Connection,
  agentApiName: string,
): Promise<ResolvedAgentIds> {
  // 1. SOQL: SELECT Id FROM BotDefinition WHERE DeveloperName = :name
  // 2. SOQL: SELECT Id, VersionNumber FROM BotVersion
  //          WHERE BotDefinitionId = :id AND Status = 'Active'
  //          ORDER BY VersionNumber DESC LIMIT 1
  // 3. SOQL: SELECT Id FROM GenAiPlannerDefinition
  //          WHERE DeveloperName = :name + '_v' + version_number LIMIT 1
}
```

Three SOQL hops. Today's code shells `sf data query`; the new version uses
`conn.query<T>()`. Same 1.5–2× faster per call, no subprocess.

### `lib/eval/orchestrator.ts` — lean run pipeline

Same 8 phases as today, but with a `Connection` instead of an `ExecFn`:

1. Resolve `$active_*` placeholders if present (`resolveActiveIds`).
2. `normalizeSpec(spec)` (the six passes above).
3. Get org metadata via `conn.identity()` (replaces today's `oauth2/userinfo` hop).
4. Split tests into ≤ 5-test batches; fan out via bounded semaphore.
5. POST each batch via `sfapRequest(conn, ...)`.
6. `deepDecode(merged)` (HTML entities).
7. Optionally fan out trace fetches (`failed` by default).
8. `summarize` → `failures.jsonl`; `persist.writeRun(...)`.

Total ~250 lines. Today's is 486 — most of the saved lines come from deleting
the bespoke `httpCall` and `sf data query` parsers.

### `lib/inspect.ts` — structural summary

```ts
import { parseComponent } from "../vendor/agentforce/browser.js"; // typed via lib/vendor/agentforce/types.d.ts

export async function summarizeFile(filePath: string): Promise<InspectResult> {
  const source = await fs.readFile(filePath, "utf8");
  const sdk = await loadAgentforceSDK();
  if (!sdk) return { ok: false, reason: "sdk_unavailable" };

  // Walk components once: config, system, topics, subagents, variables, actions.
  // For each topic, scan its before_reasoning / reasoning / after_reasoning blocks
  // for @actions.* and @subagent.* references.
  // Return a flat, JSON-serializable shape.
}
```

References are extracted by walking AST expressions for `MemberExpression(AtIdentifier)`
nodes, the same pattern the upstream `code-actions.ts` uses for `topic→subagent`
rename.

### `lib/mutate.ts` — AST primary, coord fallback

```ts
export type MutateOp =
  | { op: "set_field"; path: string; component: string; field: string; value: unknown }
  | { op: "rename"; path: string; from: string; to: string }
  | { op: "insert"; path: string; parent: string; child: unknown }
  | { op: "delete"; path: string; target: string }
  | {
      op: "apply_quick_fix";
      path: string;
      diagnostic_code: string;
      line: number;
      fix_index?: number;
    };

export async function applyMutation(op: MutateOp): Promise<MutateResult> {
  const source = await fs.readFile(op.path, "utf8");
  const doc = parse(source);

  // 1. Try the AST path: doc.mutateComponent({ kind, name, ...patch })
  //    → on success, emit + write file.
  const ast = await tryAstMutation(doc, op);
  if (ast.ok) {
    await fs.writeFile(op.path, doc.emit(), "utf8");
    return { ok: true, applied_via: "ast", ...recompile(op.path) };
  }

  // 2. Fallback: build coord TextEdits from buildQuickFixes() and apply manually.
  //    (Only for op=apply_quick_fix; other ops are AST-only.)
  if (op.op === "apply_quick_fix") {
    const edits = buildQuickFixes(source, [synthesizeDiagnostic(op)]);
    return await applyCoordEdits(op.path, edits, op.fix_index ?? 0);
  }

  return { ok: false, reason: ast.reason };
}
```

Always re-compiles after writing. Returns `diagnostics_after` so the LLM
self-loops.

### `lib/preview/client.ts` — minimal ScriptAgent

We **don't** import `@salesforce/agents`'s `ScriptAgent`. We write a thin client
that hits the same SFAP endpoints with our `Connection` and our session store.

```ts
// Endpoints (keep version pinned to org API version from sf-pi env)
const COMPILE = "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts";
const SESSION = "https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions";
const MESSAGES = (sid: string) =>
  `https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions/${sid}/messages`;
const TRACE = (sid: string, pid: string) =>
  `https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions/${sid}/plans/${pid}`;

export async function startPreview(opts: {
  conn: Connection;
  agentSource: string; // .agent file content
  agentName: string;
  mockMode: "Mock" | "Live Test";
  cwd: string;
}): Promise<{ session_id; agent_response; history_dir }> {
  // 1. POST compile (server-side compile to get agentJson) — needed for preview
  // 2. POST sessions with agentDefinition + simulationMode + bypassUser detection
  // 3. Initialize session-store.ts: write metadata.json + first transcript line
  // 4. Return session_id + initial agent message
}

export async function sendMessage(opts: {
  conn: Connection;
  sessionId: string;
  message: string;
  cwd: string;
}): Promise<{ agent_response; topic; invoked_actions; latency_ms; plan_id }> {
  // 1. POST messages with sequenceId + Text + variables[]
  // 2. Append turn to transcript.jsonl
  // 3. Fetch trace immediately (cheap: same flight pattern as today's eval trace)
  // 4. Write trace to session-store traces/<plan_id>.json
}
```

~180 lines. The trickiest bit is the `bypassUser` decision the upstream
`ScriptAgent` makes — we port the rule verbatim:

```
bypassUser = (
  conn.query("SELECT Id FROM User WHERE Username = :defaultAgentUser").totalSize === 1
)
if (bypassUser && agentJson.globalConfiguration.agentType === "AgentforceEmployeeAgent") {
  bypassUser = false
}
```

### `lib/preview/session-store.ts`

Mirror of the upstream layout, anchored at our state dir (not `.sfdx/`):

```
<cwd>/.pi/state/sf-agentscript/sessions/<agentName>/<sessionId>/
├── metadata.json            { sessionId, agentName, startTime, endTime?, mockMode, planIds[] }
├── transcript.jsonl         {timestamp, role:"user"|"agent", text, raw?, planId?}
└── traces/<planId>.json
```

`logTurn(...)` and `logTrace(...)` are atomic appends; `flush()` rewrites
metadata.json. ~100 lines.

### `lib/sdk.ts` — vendored loader (simplified)

```ts
import * as Agentforce from "./vendor/agentforce/browser.js";
import type { AgentforceSDK } from "../vendor/agentforce/types.d.ts"; // ~80-line ambient

let cached: AgentforceSDK | null = null;

export async function loadAgentforceSDK(): Promise<AgentforceSDK | null> {
  if (cached) return cached;
  if (
    typeof Agentforce.parse !== "function" ||
    typeof Agentforce.compileSource !== "function" ||
    typeof Agentforce.parseComponent !== "function" ||
    typeof Agentforce.mutateComponent !== "function"
  ) {
    return null;
  }
  cached = Agentforce as AgentforceSDK;
  return cached;
}
```

Today's `sdk.ts` does a runtime `await import(file://...)` for lazy load; the
new version is a static ESM import with a tiny synchronous load check.
Eliminates ~50 lines of error-path bookkeeping.

| Module                | Today                                                          | Proposed                                                           | Net                             |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| Auth                  | `sf api request rest` subprocess (lib/eval/http.ts ~180 lines) | `Connection` from `@salesforce/core` (lib/connection.ts ~50 lines) | −130 lines, ~30× faster         |
| SFAP transport        | inferStatus regex + stdout parsing                             | typed `Connection.request` errors                                  | −80 lines                       |
| Eval normalize        | 56 lines, 1 pass                                               | 180 lines, 6 passes                                                | +120 lines, smarter             |
| Eval render           | 373 lines (mixed concerns)                                     | 140 (failure-record) + 60 (format.ts)                              | −170 lines                      |
| Inspect               | —                                                              | 120 lines                                                          | NEW                             |
| Mutate                | — (coord-only via code-actions.ts)                             | 150 lines AST + 80 lines coord                                     | NEW capability                  |
| Preview client        | —                                                              | 180 lines                                                          | NEW capability                  |
| Session store         | —                                                              | 100 lines, Salesforce-standard layout                              | NEW capability                  |
| Vendored .d.ts        | 8964 lines                                                     | ~80 lines (only what we use)                                       | −8884 lines                     |
| LSP placeholder dir   | exists                                                         | dropped                                                            | —                               |
| Tools (top-level)     | 5 single                                                       | 6 (4 single + 2 multi-action)                                      | +1 (`create`), +3 new behaviors |
| Tool error contract   | prose only                                                     | typed `{error, suggestion, recover_via}`                           | recommendation #4               |
| Long-running progress | none                                                           | streamed via `onUpdate`                                            | recommendation #2               |
| Schemas               | flat enum + optional fields                                    | typebox discriminated unions                                       | recommendation #3               |
| Quick-fix path        | LLM applies coords                                             | quick_fix carries `apply_via: agentscript_mutate`                  | recommendation #5               |
| Trace shape hint      | implicit                                                       | string field on every failure                                      | recommendation #6               |
| Doctor                | bundle path only                                               | bundle SHA + core resolves + org resolves + .sfdx/agents writable  | recommendation #7               |
| Session GC            | none                                                           | `preview action=cleanup older_than_days`                           | recommendation #8               |
| Tool descriptions     | per single-purpose                                             | tight per multi-action, actions in one line                        | recommendation #9               |
| Self-recovery test    | none                                                           | `tests/self-recovery.test.ts` end-to-end                           | recommendation #10              |

## Migration plan

Single PR on `main` per the repo's "push straight to main" workflow. Phased
internally so each commit is reviewable in isolation.

| Phase | What lands                                                                                                                                                            | Reverts cleanly?                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| P0    | Add `@salesforce/core` to `package.json`. Add `lib/connection.ts`, `lib/eval/sfap.ts`. Wire both behind a feature flag.                                               | Yes — both are unused until P3.         |
| P1    | Rewrite `lib/eval/normalize.ts` with the 6 passes. Add tests. No behavior change at the orchestrator yet.                                                             | Yes — old normalize stays the live one. |
| P2    | Add `lib/inspect.ts` + `lib/mutate.ts` + their tests. Register `agentscript_inspect` + `agentscript_mutate` tools. Old eval surface untouched.                        | Yes — pure additions.                   |
| P3    | Switch `lib/eval/orchestrator.ts` to use `Connection` via `sfap.ts`. Delete `lib/eval/http.ts`. Migrate active-ids to `conn.query()`. Delete `lib/exec.ts`.           | Yes via `git revert`.                   |
| P4    | Collapse 4 eval tools into 1 multi-action `agentscript_eval` tool. Update manifest + skill. Run `npm run generate-catalog`.                                           | Yes — keep old files until P6.          |
| P5    | Add `lib/preview/{client,session-store}.ts` + tests. Register `agentscript_preview`.                                                                                  | Yes — pure addition.                    |
| P6    | Delete obsolete files (`http.ts`, old eval tool files, the giant `index.d.ts`, `lib/lsp/`). Trim `code-actions.ts` to coord-fallback only. Update README + AGENTS.md. | Manual revert if needed.                |
| P7    | Run `npm run validate` + manual smoke against the Vivint sandbox. Tag release.                                                                                        | —                                       |

## Testing

- **Vitest** for everything. `Connection` is mocked via a small fixture (`tests/fixtures/mock-connection.ts`) that records `request()` / `query()` calls and replays canned responses.
- **No subprocess in tests.** Everything runs in-process.
- **Snapshot tests** for `failures.jsonl` shape (LLM-debug contract) using a recorded `merged` response — anchors the contract so accidental shape drift is caught.
- **Golden file** for `inspect` output on a representative `.agent` fixture.
- **Round-trip test** for `mutate` — apply each `op` against a fixture, re-parse, assert structure changed as expected and the source still compiles.

## What we keep, verbatim

- `decode.ts` — HTML entity decoder (eval API HTML-encodes responses).
- `threshold.ts` — `_thrNN` / `__optN` post-processing.
- `failure-record.ts` shape — `{test_id, failed_evaluators, step_errors, turns[], trace_files}`. The LLM-debug contract.
- `persist.ts` disk layout — `metadata.json` / `raw.json` / `transcript.jsonl` / `failures.jsonl` / `traces/<planId>.json`.
- 5xx-only retry policy with jittered backoff.
- SFAP `api → test.api → dev.api` host fallback.
- `$active_bot_id` / `$active_bot_version_id` / `$active_planner_id` placeholder semantics (Active version, not latest).
- Mutable-seed workaround (no `stripUnrecognizedFields`).
- Compile-on-save filter rules (severity 1 + actionable severity 2 allowlist).

## What we delete

- `lib/eval/http.ts` (~180 lines) — replaced by `sfap.ts` over `Connection`.
- `lib/eval/render.ts` (~373 lines) — split: failure-record extraction → `failure-record.ts`, human report → tiny `format.ts` only used by the slash command.
- `lib/exec.ts` indirection (today's `buildExecFn`) — no more subprocess.
- `lib/sdk.ts` lazy-loader — replaced by static ESM import + small load check.
- `lib/code-actions.ts` shrunk from 320 → ~80 lines (coord fallback only; AST mutation lives in `mutate.ts`).
- `lib/file-classify.ts` resolveToolPath — inlined where used (4 lines × 3 callers).
- `lib/vendor/agentforce/index.d.ts` (8964 lines) — replaced by ambient `lib/vendor/agentforce/types.d.ts` (~80 lines) typing only what we use.
- `extensions/sf-agentscript/lib/lsp/` — placeholder directory (drop entirely).
- 4 of 5 today's eval tool files (collapsed into one multi-action `eval.ts`).

## Risks & mitigations

| Risk                                                                            | Mitigation                                                                                                                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@salesforce/core` brings transitive deps that conflict with sf-pi              | Already a transitive dep of every `sf` plugin the user has installed. Lock in one major version (`^8`).                                               |
| `Connection.request` doesn't expose the same retry hooks as our subprocess path | We control retry in `sfap.ts` — `Connection.request` is the transport, not the policy.                                                                |
| Org alias resolution breaks when user has no default org                        | `orgFromAlias(undefined)` falls back to `Org.create()` which uses the project + global default chain. Same behavior as `sf api request rest`.         |
| Vendored `@agentscript/agentforce` API drifts                                   | Same `sync-agentforce-sdk.mjs` script + CI drift check. Already battle-tested.                                                                        |
| AST mutation can't express some op the LLM tries                                | Coordinate fallback path for `apply_quick_fix`. Other ops return `{ok:false, reason}` and the LLM falls back to `edit` tool with the diagnostic data. |
| Preview endpoint shape changes                                                  | Pin endpoint URLs in one constant block; surface 404 to LLM via `agentscript_preview`'s error path with a clear message.                              |
| Eval API auth changes                                                           | `@salesforce/core` `Connection` handles refresh. If refresh fails, surface the message and instruct `sf org login web -a <alias>`.                    |

## Done criteria

- [ ] `package.json` has exactly **one** new dep: `@salesforce/core`.
- [ ] `lib/eval/http.ts` is gone. No more `sf api request rest` shelling on the hot path.
- [ ] Six tools registered: `agentscript_compile`, `agentscript_inspect`, `agentscript_create`, `agentscript_mutate`, `agentscript_preview`, `agentscript_eval`.
- [ ] All multi-action tools use typebox discriminated-union schemas.
- [ ] Every tool error path returns `ToolError` with `error` + `suggestion` (and `recover_via` where applicable).
- [ ] `agentscript_compile` quick fixes include `apply_via: {tool: "agentscript_mutate", ...}`.
- [ ] `agentscript_eval action=run` and `agentscript_preview action=send` stream progress via `onUpdate`.
- [ ] Failure records include `trace_hint` describing the trace JSON structure.
- [ ] `/sf-agentscript doctor` checks: bundle SHA, `@salesforce/core` resolves, target-org resolves, `.sfdx/agents/` writable.
- [ ] `agentscript_preview action=cleanup` removes sessions older than `older_than_days` (default 30 when invoked).
- [ ] sf-guardrail config carves out `.sfdx/agents/**` while keeping the rest of `.sfdx/**` blocked.
- [ ] On-save compile-feedback contract is byte-equivalent to today's.
- [ ] Local-first policy enforced: `agentscript_compile` defaults to local; `agentscript_eval action=run` does a local pre-flight (compile + normalize + ref resolution) before any network call; `agentscript_preview action=start` compiles locally before hitting `/authoring/scripts`.
- [ ] `agentscript_compile {fallback: "server"}` round-trips the server compile endpoint and returns `compiled_via: "server"`.
- [ ] When local SDK is unavailable, every tool returns a `ToolError` with `recover_via: {tool: "sf-agentscript", params: {action: "doctor"}}`.
- [ ] An eval run against the Vivint sandbox completes in < (today's time) − 3s for a 30-call run.
- [ ] `tests/self-recovery.test.ts` exercises the full loop: broken `.agent` → compile → inspect → mutate → compile clean → eval green.
- [ ] All vitest tests pass; `npm run validate` is green.
- [ ] LOC ≤ 3 600; no `lib/*` file > 250 lines; no `tools/*` file > 100 lines.
- [ ] README + AGENTS.md updated; SKILL.md describes the self-recovery loop and the `recover_via` chaining pattern.
