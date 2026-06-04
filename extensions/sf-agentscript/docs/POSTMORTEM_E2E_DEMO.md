# Postmortem — first end-to-end demo against `AgentforceSTDM`

Trying to ship a "simple greeter" agent end-to-end (`create → compile → preview → publish → activate`) surfaced six distinct DX failures, only one of which was the org's fault. This doc enumerates each, points at the offending code, and proposes concrete, narrowly-scoped fixes.

The original session was a useful stress test: nothing was particularly exotic about the agent or the org, so anything that bit me here will bite a customer. The plumbing held up; the **defaults, error mapping, and silent-success paths** did not.

> Scope: each issue gets a confirmed root cause (with file/line references), a one-line fix idea, and a "regression test that would have caught this" line. Resist the urge to bolt on features — the goal is to make the existing tools behave the way the LLM (and any first-time human) already assumes they behave.

---

## TL;DR — what bit me, in order

| #   | Symptom                                                                                                                                                           | Real cause                                                                                                                                                             | Severity                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Activation: _"This Agent Type should have a user assigned"_                                                                                                       | Scaffold omits `agent_type` entirely → SDK lint can't fire → activation is the first place we learn about it                                                           | **High** — every default scaffold is un-activatable |
| 2   | Compile: `[E] missing-token @ L17` on `transition … when "…"`                                                                                                     | LSP message is correct but doesn't suggest the supported transition shapes                                                                                             | Medium — costs one round-trip per new author        |
| 3   | `agentscript_authoring mutate set_field` reported `🔧 set config.agent_type (ast) Δ -1 bytes ✓ clean` but **never added the field**                               | `applyAstSetField` writes a property onto the parsed block AST node; SDK `emit()` ignores fields that aren't in `__children`                                           | **Critical** — silent lie to the LLM                |
| 4   | Activation error pass-through: `❌ Activation request did not succeed: <msg>`                                                                                     | `lifecycle-tool.ts` `classifyLifecycleError` only matches `404` / `not found`; misses every business-validation error                                                  | High                                                |
| 5   | `agentscript_lifecycle publish` returned _"SFAP returned 404… use an Agentforce-enabled org"_ even though we'd just published v1 successfully in the same session | `isSfapRoutingFailure` over-classifies; same hard-coded message for two very different failure modes                                                                   | High                                                |
| 6   | After `sf project deploy start -m AiAuthoringBundle` the BotDefinition.AgentType still didn't update → activate kept failing                                      | The bundle-meta.xml had no `<target>` element, so MD API didn't link bundle ↔ BotVersion. `publishAgent` injects `<target>` for us; manual `sf project deploy` doesn't | Medium — undocumented gotcha                        |

The plus side: `agentscript_authoring compile/check`, `agentscript_authoring inspect`, `agentscript_preview`, the trace store, the planner-trace digest, and the SDR-friendly bundle layout all worked exactly as advertised.

---

## Issue 1 — scaffold defaults can't be activated

### Evidence

The scaffold produced by `agentscript_authoring create` (default template `agentforce-default`):

```yaml
config:
  agent_name: "Demo_Greeter"
  description: "..."
```

No `agent_type`, no `default_agent_user`. The official SDK package emits a `config-missing-default-agent-user` lint:

```js
const agentTypeNode = config2.agent_type;
if (!agentTypeNode || typeof agentTypeNode !== "object") return; // ← skips when agent_type omitted
```

i.e. **the SDK only fires the missing-user error when `agent_type` is set explicitly.** The scaffold's omission silently dodges the safety net. Server-side compile defaults the type to `AgentforceServiceAgent` (vendor `DEFAULT_AGENT_TYPE`), which then requires a user → activation refuses.

### Code

- `lib/templates/agentforce-default.ts` L21-27 — only emits `default_agent_user` if `jobSpec.agent_user` is set; never emits `agent_type`.
- `lib/create.ts` L29-31 — `AgentJobSpec.agent_user` is the only escape hatch.

### Fix

Two non-overlapping changes:

1. **Default `agent_type: "AgentforceEmployeeAgent"` in the scaffold.** Employee agents don't need a user, so `agentscript_authoring create → agentscript_lifecycle publish activate=true` works on a dev/sandbox org with zero extra config. Most demo paths want this.
2. **When `job_spec.agent_user` is provided, scaffold `agent_type: "AgentforceServiceAgent"` and `default_agent_user: <user>`.** That way the user signals "Service Agent" by passing a user; we don't ask them to know two fields.

`agentscript_authoring create`'s `next_steps` should also include a one-liner reminder when the scaffold is a Service Agent without `agent_user`:

> "Service Agent scaffolds need a `default_agent_user` before activation; pass `job_spec.agent_user` to scaffold one in."

### Regression test

Add to `tests/template-scaffold-vars.test.ts`:

- given no job spec, generated source contains `agent_type: "AgentforceEmployeeAgent"`
- given `job_spec.agent_user`, generated source contains both `agent_type: "AgentforceServiceAgent"` and `default_agent_user`
- generated source compiles clean (no `config-missing-default-agent-user`) under `loadAgentforceSDK().compileSource(source)`

---

## Issue 2 — `transition … when "…"` reads natural but compiles to `missing-token`

### Evidence

I wrote:

```
    transition to @topic.faq when "the user asks a question about Agentforce…"
```

…because guarded transitions are a thing in most FSM DSLs. Compile said `[E] missing-token @ L17`. Correct — Agent Script doesn't have `when`-guarded transitions; the supported shapes are:

| Form                            | Where it goes          | Behavior                                      |
| ------------------------------- | ---------------------- | --------------------------------------------- |
| `transition to @topic.X`        | a node body            | deterministic — fires when the node completes |
| `@utils.transition to @topic.X` | inside `instructions:` | LLM-discretionary — model decides             |

### Code

- `lib/diagnostics.ts` (and `lib/feedback.ts`) — render the SDK's diagnostic verbatim. No code-side suggestion is added for `missing-token` near a `transition` keyword.

### Fix

In `lib/code-actions.ts` (the existing quick-fix builder): when the SDK reports `missing-token` and the offending line text starts with `transition to @<ns>.<x>` and contains a `when ` token, emit a no-edit "info" code action describing the two supported shapes plus a quick-fix that strips the `when "…"` clause. Keep it cheap — pattern-match the line, don't try to parse.

Document the same on a single page: `references/transitions.md` in the skill, two examples. Currently this is buried in `patterns-quick-ref.md` L204.

### Regression test

`tests/code-actions.test.ts` — given a source with `transition to @topic.X when "…"` and a `missing-token` diag at that line, the returned code action's `title` matches `/transitions don't support 'when'/i` and applying it removes the `when "…"` segment.

---

## Issue 3 — **CRITICAL** `set_field` silently no-ops when the field is new

### Evidence

Reproduced cleanly with `agentscript_authoring mutate set_field component=config field=agent_type value=AgentforceEmployeeAgent dry_run=true` against a probe file with no pre-existing `agent_type`:

```
🔍 Dry-run: set config.agent_type (ast)
/tmp/agentscript-mutate-repro.agent  Δ -1 bytes (NOT written)
@@ -12,3 +12,2 @@
     description: "Entry."
     transition to @topic.main
-                                  ← only change is a stripped trailing newline
```

The tool reports success. The diff is **a stripped trailing newline**. The new field is not in the output.

### Root cause

`lib/mutate.ts` `applyAstSetField` for `head === "config"`:

```ts
doc.mutate((ast) => {
  const block = ast[head] as Record<string, unknown> | undefined;
  if (block) (block as Record<string, unknown>)[op.field] = valueNode;
});
```

This writes a JS property onto the parsed block AST node. The SDK's `emit()` walks the block's CST `__children` array, not arbitrary properties — so the new field is skipped during serialization. `doc.isDirty` flips because property assignment counts as mutation, and the noop-detector (`if (after === sourceBefore) return noop`) loses to a benign whitespace round-trip in the emitter, so we land in `commitOrPreview` with a "successful" state.

### Fix

The mutation adapter now uses the official SDK package's structured mutation/emission helpers for targeted scalar field updates, then keeps the post-emit verification guard. `set_field` may upsert a known scalar field such as `config.agent_type`; broader list/object/block construction still routes to the generic edit tool plus `agentscript_authoring compile/check`.

### Regression test

`tests/mutate.test.ts` verifies that:

- `set_field` for a non-existent scalar field on `config` returns `ok: true` and the file contains the new field.
- `set_field` with `dry_run: true` for a scalar upsert returns a truthful diff/preview source.
- non-scalar or non-allowlisted field construction returns `invalid_field` / `unsupported_value_type` guidance instead of reporting a misleading success.

---

## Issue 4 — opaque activation errors

### Evidence

`agentscript_lifecycle activate` produced `❌ Activation request did not succeed: This Agent Type should have a user assigned.` four times in a row. No diagnosis, no recover_via, no link to docs.

### Code

`lib/lifecycle-tool.ts` `classifyLifecycleError` only matches:

- `/ERROR_HTTP_404|HTTP 404|URL No Longer Exists/i` → "not Agentforce-enabled"
- `/not found/i` → "list_versions"

`/Activation request did not succeed/i` is not matched → message passes through verbatim.

Meanwhile, `lib/preview/error-map.ts` already has a perfect mapping for `Invalid user ID provided on start session` (case `invalid-user-id`, L91-96). Same root cause, two surfaces, one map.

### Fix

1. Promote `lib/preview/error-map.ts` to `lib/errors/agent-api-error-map.ts` and reuse it from both `preview-tool.ts` and `lifecycle-tool.ts`.
2. Add three more cases that fired this session:
   - `/should have a user assigned/i` → "Add `agent_type: AgentforceServiceAgent` + `default_agent_user: <user>` to your `.agent` config and republish (lifecycle.publish, not `sf project deploy`)."
   - `/Agent Type should have/i + agent metadata says Service Agent` → identical message but with `recover_via: agentscript_lifecycle action='publish' agent_file=<bundle>.agent`.
   - `/Activation request did not succeed/i` (catch-all) → keep the original message but append `"Run agentscript_authoring inspect to confirm config.agent_type and config.default_agent_user are set."`

### Regression test

- `tests/preview-error-map.test.ts` — already exists; add cases for the three new patterns.
- New `tests/lifecycle-error-map.test.ts` — verify `classifyLifecycleError` routes the same SFAP-style activation rejection to the rewritten message + recover_via.

---

## Issue 5 — `Publish is unavailable in this org` lies about org config

### Evidence

Mid-session, after a successful first publish, the same `agentscript_lifecycle publish` returned:

```
❌ Publish is unavailable in this org — the SFAP authoring endpoint returned 404
   across api / test.api / dev.api hosts. Use an Agentforce-enabled org.
```

The org IS Agentforce-enabled (we'd just published successfully). The 404 was either transient SFAP behavior or a back-end rejection of the new agent_type/user combo, not an org-wide "not Agentforce-enabled" condition. The message:

- pretends to be authoritative ("use an Agentforce-enabled org")
- gives the LLM no way to retry intelligently
- doesn't mention that _the previous publish in this session worked_

The same misleading hint appears in `lib/lifecycle.ts` L233-236 (`serverCompile`) and L256-259 (`publishAgent`), and verbatim in `classifyLifecycleError` (`lib/lifecycle-tool.ts` L300-303).

### Fix

Three small changes:

1. **Stop conflating 404 with "org not Agentforce-enabled."** Keep the literal message ("SFAP host fallback exhausted, last response 404 from <host>") and offer:
   > "If a previous publish in this session succeeded, this is likely a transient back-end issue — retry in 30s. If every publish fails, run `/sf-agentscript doctor` to confirm Agentforce permissions."
2. **Provide a `recover_via`** pointing at `agentscript_lifecycle action='list_versions'` so the LLM can confirm the previous version landed before retrying.
3. **Track session-local successes.** When `publishAgent` runs successfully, write a tiny breadcrumb (already easy via `pi.appendEntry` per repo convention); use it to switch the 404 message between "first call ever" vs "we know this org works, this is transient."

### Regression test

- Unit-test `isSfapRoutingFailure` so it returns `true` only on the documented host-fallback exhaustion, not on "first try got a single 404."
- `tests/publish-authoring-bundle.test.ts` — given a server that returns 404 once then success, the second publish call doesn't carry the misleading "use an Agentforce-enabled org" wording.

---

## Issue 6 — `sf project deploy` of `AiAuthoringBundle` doesn't update `BotDefinition.AgentType`

### Evidence

After a plain `sf project deploy start -m AiAuthoringBundle:Demo_Greeter`, the bundle source on disk had `agent_type: AgentforceServiceAgent` + `default_agent_user: stdm-agent-user@…`, but `agentscript_lifecycle activate v2` still failed with the same "user not assigned" error. Retrieve confirmed the deployed `.agent` source matched what I'd intended.

### Root cause

`publishAgent` does extra work that a plain MD API deploy can't:

- it server-compiles to get `agentDefinition` JSON
- it injects `<target>{agentApiName}.{versionDeveloperName}</target>` into the `.bundle-meta.xml` (`injectBundleTarget`, L185-208)
- it deploys via SDR with `<target>` present, which links the bundle to a specific BotVersion and propagates `agent_type` / `default_agent_user` into the BotDefinition record

A plain `sf project deploy` only ships the `.agent` source + `.bundle-meta.xml` as-is. With no `<target>`, the bundle is stored as a draft authoring source — no link to a BotVersion, no propagation of agent metadata.

This is a real footgun: every time a user iterates with `sf project deploy` after their first `lifecycle.publish`, the BotDefinition diverges from the on-disk source.

### Fix

1. **Document the gotcha** in `extensions/sf-agentscript/README.md` and `references/activation-checklist.md`: "After publishing, edit-then-deploy via `sf project deploy` will not propagate config changes to the BotDefinition. Always use `agentscript_lifecycle publish` for iteration."
2. **Detect the divergence** in `agentscript_authoring inspect action='check_targets'`: include `config.agent_type` / `default_agent_user` from the .agent file alongside the org's `BotDefinition.AgentType` (Tooling API), and diff them.
3. **Emit a soft warning** in `agentscript_lifecycle activate` when the source on disk is newer than the most recent BotVersion's CreatedDate, suggesting `lifecycle.publish` instead.

### Regression test

- Unit-test the divergence detector with a fixture where `.agent` says `Service`+user but the org BotDefinition says `Service`+empty.

---

## Cross-cutting suggestion — `agentscript_doctor` becomes the third-call default

The session above went `create → compile → preview → publish → activate`, hit a wall, and never had a "what's the org's view of this agent?" verb to call. We have `lib/doctor.ts` already. Two upgrades:

1. **Add `action='diagnose'`** that takes `agent_api_name` + `agent_file` and returns a per-field diff: `.agent` says X, BotDefinition says Y, last successful publish was Z minutes ago.
2. **Promote it in `next_steps`** of every lifecycle error path. Right now `recover_via` always points back at the same tool (`list_versions`); a diagnostic snapshot is more useful when the error is "your local source no longer matches the org."

---

## Concrete implementation sequence

If we ship in priority order:

1. **Hotfix (shipped):** Issue 3 (silent `set_field` lie). Use official structured mutation/emission helpers for scalar upserts, keep post-emit verification, and cover truthful dry-run/output behavior with regression tests.
2. **High-value DX (2 days):** Issues 1 + 4. Promote `agent_type: AgentforceEmployeeAgent` in the default scaffold; promote `error-map.ts` to a shared module and add the activation cases. Both changes touch <100 LoC.
3. **Documentation + small lint (1 day):** Issues 2, 5, 6. The `transition … when` quick-fix, the 404 message rewrite, and the docs entry on `sf project deploy` divergence.
4. **Cross-cutting (separate roadmap item):** doctor.diagnose, breadcrumb-aware 404 messaging.

Each item maps to a single PR, ships independently, and removes one of the failure modes from this session.

---

## What worked, for posterity

- `agentscript_authoring compile/check` returned a sharp `[E] missing-token @ L17`. The line number was right; the only gap was a suggestion (Issue 2).
- `agentscript_authoring inspect` summary was accurate. No surprises.
- `agentscript_preview` start/send/end performed end-to-end against `AgentforceSTDM` mock mode, captured trace JSON + Markdown report under `.sfdx/agents/<bundle>/sessions/<sid>/`, and the per-turn digest was exactly the right shape for follow-up debugging.
- `agentscript_lifecycle publish` worked on the first call (created `Demo_Greeter` v1).
- `lifecycle.publishAgent`'s SDR-friendly bundle layout + `<target>` injection worked silently. The only reason I noticed it existed was the comparison with my failed manual `sf project deploy`.
- `agentscript_lifecycle list_versions` returned the right rows in <500ms.

The first three of those would have been impossible without the fast local-first compile/inspect path. Keep that posture; just plug the holes that let bad state escape the boundary.
