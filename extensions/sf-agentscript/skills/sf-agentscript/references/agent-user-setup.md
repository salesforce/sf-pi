# Agent user setup with sf-agentscript

Service Agents (`agent_type: "AgentforceServiceAgent"`) need an Einstein
Agent User assigned and permissioned **before** they can publish or
activate. This page is the operating manual for the three
`agentscript_lifecycle` verbs that own that flow.

Employee Agents (`agent_type: "AgentforceEmployeeAgent"`) run as the
logged-in user — none of this applies. Every verb returns
`status: "n/a"` for them.

## When to use which verb

```
agent_user_status         (cheap)    "is this ready right now?"
       ↓ not_ready
diagnose_agent_user       (full)     "exactly what's missing, and what fixes it?"
       ↓ has missing items
provision_agent_user      (mutating) "fix it idempotently; defaults to dry_run"
```

| Verb                   | Reads    | Writes                                    | When                                                                                                                                      |
| ---------------------- | -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_user_status`    | 2 SOQL   | none                                      | Use as a publish preflight or a one-shot health check. Returns `ready` / `not_ready` / `n/a` plus a stable `reason`.                      |
| `diagnose_agent_user`  | 4-6 SOQL | none                                      | When `agent_user_status` returns `not_ready` and you want the full per-check breakdown (license, user, system PS, per-Apex-class access). |
| `provision_agent_user` | 4-6 SOQL | User insert, PSA insert, custom-PS deploy | After diagnose surfaces concrete gaps. **Defaults to `dry_run: true`** — preview the plan, then re-call with `dry_run: false`.            |

Always call `agent_user_status` before `publish` (the verb does this
automatically — but if you're wiring multiple agents into the same
org, batching the checks first is faster).

## What `provision_agent_user` does, in order

1. **`create_user`** — if the username in `default_agent_user` (or the
   `username_override` param) doesn't resolve to an active User, insert
   one against the `Einstein Agent User` profile. Skips if the user
   exists; fails fast if it exists but is inactive (manual fix).
2. **`assign_system_ps`** — idempotent `PermissionSetAssignment` for
   `AgentforceServiceAgentUser`. Required before publish; without it
   publish returns the cryptic "Internal Error".
3. **`deploy_custom_ps`** — synthesize a `<AgentName>_Access`
   `PermissionSet` whose `<classAccesses>` cover every `apex://X` target
   in the bundle, deploy via `@salesforce/source-deploy-retrieve`. Skips
   if every required class is already reachable from the user's existing
   PS bundle.
4. **`assign_custom_ps`** — PSA insert for the freshly-deployed custom
   PS (or the existing one if step 3 was a skip).

All four steps are skip-if-already-done. Run provision twice and the
second run is a no-op.

### dry_run defaults to true

`provision_agent_user dry_run=true` (the default) walks the diagnose
snapshot and emits a `would_execute` plan plus the fully-rendered
custom PS XML. **No org mutations.** The LLM (and human) review, then
re-call with `dry_run=false` to execute. Re-running with `dry_run=false`
is safe regardless of state — every step's idempotency guard short-
circuits when the work is already done.

## What each check covers

### License

`PermissionSetLicense.DeveloperName` against an Agentforce family:
`PID_DigitalAgent`, `EinsteinGPTCopilotPsl`,
`AgentforceServiceAgentUserPsl`, `AgentPlatformBuilderPsl`,
`AgentforceServiceAgentBuilderPsl`. Different org types provision
different members of this family — accepting any active match is
intentional.

If license is missing, every other check is **skipped**: the org
isn't Agentforce-enabled, so wiring questions are moot. An admin
must provision the license first.

### Einstein Agent User exists + active

Resolves `default_agent_user` from the .agent's `config:` block to a
`User` row. When it doesn't resolve, diagnose lists candidate active
Einstein Agent Users (`Profile.Name = 'Einstein Agent User' AND IsActive = true`)
so the LLM can either rename `default_agent_user` to one of them or
provision a new one.

### System Permission Set assigned

`AgentforceServiceAgentUser` is the system PS that lets the agent user
actually act in the org. **Without it, publish fails with a cryptic
"Internal Error"** — assign it before publishing, not after.

### Per-Apex-class access

Capability check, not name match. Walks every `apex://X` action
target in the .agent file and verifies the agent user has class-level
permission on `X` via _any_ assigned PS. Auto-generated PS names
(`NextGen_<AgentName>_Permissions`) are unreliable in practice — checking
by capability gets the right answer regardless of naming.

## Interpreting the diagnose report

The verb returns a structured report:

```ts
{
  ok: false,
  agent_type: "Service",
  default_agent_user: "agent@example.com",
  found_licenses: ["EinsteinGPTCopilotPsl"],
  checks: [
    { id: "license",                  status: "ok",      detail: "...", },
    { id: "agent_user_exists",        status: "ok",      detail: "...", },
    { id: "agent_user_active",        status: "ok",      detail: "...", },
    { id: "system_permset_assigned",  status: "missing", detail: "...",
      fix_hint: "Run agentscript_lifecycle action='provision_agent_user' …" },
    { id: "apex_class_access",        status: "missing", detail: "...",
      fix_hint: "Run agentscript_lifecycle action='provision_agent_user' …" },
  ],
  apex_actions: [
    { name: "lookup_account", apex_class: "AccountLookup", status: "ok",      granted_via: "MyAgent_Access" },
    { name: "create_case",    apex_class: "CaseCreator",   status: "missing" },
  ],
  recover_via: { tool: "agentscript_lifecycle", params: { action: "provision_agent_user", … } },
}
```

`ok` is true only when every check is `ok` or `n/a`. The first
non-ok check is the priority fix — they're ordered so the upstream
gate has to clear before a downstream check is meaningful.

`recover_via` always points at `provision_agent_user` with `dry_run: true`
when there's anything to fix.

## Org-type quirks

- **Username format depends on the org type.** Production:
  `{name}_agent@{orgId}.ext`. Dev/scratch:
  `{name}.{suffix}@{orgfarm}.salesforce.com`. Don't synthesize a
  username — let `provision_agent_user` query existing Einstein Agent
  Users first; the verb refuses to create a duplicate.
- **`PermissionSetLicenseAssignment` is unsupported on some org types.**
  License check uses `PermissionSetLicense` directly to avoid this.
- **`WITH USER_MODE` Apex needs object-level read access too.** Class
  access (what the per-Apex-class check covers) is necessary but not
  sufficient. If preview returns empty results, add
  `<objectPermissions>` to the custom PS for the SObject(s) the Apex
  queries. `provision_agent_user` does NOT touch object permissions
  — those must be added by the developer because the verb can't infer
  the SObjects from static analysis.
- **Auto-generated `NextGen_{AgentName}_Permissions` is unreliable.**
  Don't rely on it; the capability check ignores PS name and just
  asks "is class X reachable from any PS the user has".

## Common short-circuits

- License missing → every downstream check is `skipped`. Fix license,
  re-run.
- `default_agent_user` not in .agent → `agent_user_exists: missing`,
  diagnose lists candidate Einstein Agent Users, you pick one and edit
  the .agent.
- Edited `.agent`, deployed via plain `sf project deploy`, activation
  still fails: **deploy doesn't propagate `agent_type` /
  `default_agent_user` into the BotDefinition record**. You must
  re-publish via `agentscript_lifecycle action='publish'` — the
  publish path is what threads the config through SFAP and back into
  the BotDefinition.

## Validated against

The doc that drove this design:
[forcedotcom/afv-library — agent-user-setup.md](https://github.com/forcedotcom/afv-library/blob/main/skills/developing-agentforce/references/agent-user-setup.md).
The verbs cover the same workflow but skip the `sf` CLI — every step
runs through `@salesforce/core` `Connection` + `@salesforce/source-deploy-retrieve`
so the flow works in CI / programmatic contexts that don't have a
shell.
