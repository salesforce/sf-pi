# SF MCP Agent Guide

Use `sf_mcp` to inspect and author reviewed Salesforce MCP entries in Pi's native MCP configuration. Pi remains the runtime authority for transport, connections, OAuth, token storage, tools, resources, and readiness.

## Hosted OAuth lifecycle

1. Use `sf_integrate` to create or adopt the exact Salesforce External Client App, activate the hosted server, and obtain the org-bound handoff.
2. Run `sf_mcp` action `status` with the intended `scope` and `preset_id`.
3. Run `connection.plan` with the same explicit `target_org`, the public consumer key, and the intended scope. SF MCP proves the org-pinned My Domain OAuth issuer and derives a per-org connection name. Conflict resolution is optional here; SF MCP chooses a safe connection resolution when omitted.
4. Review the redacted connection diff, warnings, `plan_id`, and `plan_hash`.
5. Run `connection.apply` with the exact plan identity and `allow_mutation=true`.
6. Run `login.handoff` after exact resulting-state verification for HTTP presets.
7. Reload Pi when the apply result says it is required, run the returned `/mcp login <server>` command, and complete human OAuth consent.
8. Run `tools.plan` with the recommended or read-only profile and optional exact `tool_overrides`, then `tools.apply` with its exact plan identity.
9. Run `identity.verify` with the exact `connection_name`; it invokes bounded `dispatch_readonly` userinfo and compares the authenticated organization id with the source-bound org binding.
10. Use `/mcp` to inspect connection state, errors, tools, resources, reconnects, and logout.

`configure.plan` and `configure.apply` remain available as a combined compatibility workflow.

For Headless 360, pass the public External Client App consumer key as `oauth_client_id` plus an explicit `target_org`. The proved org-pinned endpoint is preferred over the generic environment family. One preset can have several org-bound connection instances; pass `connection_name` for tool access, disable, or login actions when more than one exists. For Slack, pass the approved app client ID and set `SLACK_MCP_CLIENT_SECRET` outside the tool call. For Informatica, pass the IDMC Public OAuth 2.1 client ID plus the pod-specific `server_url`. Never pass a client secret or OAuth token.

## Actions

- `status`: Read native configuration ownership, every managed connection instance, drift, overlap, and scope-conflict state. Defaults to global scope only when scope is omitted.
- `conflicts`: Read exact reviewed tool conflicts and the current recommendation for one preset.
- `connection.plan` / `connection.apply`: Configure transport, URL or command, and authentication separately. Headless 360 `target_org` planning proves the org-pinned endpoint and derives a per-org name. New reviewed instances start with every tool Hidden; existing managed tool access is preserved.
- `tools.plan` / `tools.apply`: Apply a reviewed profile plus optional exact per-tool overrides without changing connection fields.
- `configure.plan` / `configure.apply`: Combined compatibility workflow for callers that intentionally want connection and reviewed profile in one plan.
- `disable.plan`: Plan disabling one unchanged SF MCP-managed entry.
- `disable.apply`: Apply the exact disable plan with explicit mutation intent and Guardrail approval.
- `login.handoff`: Return the exact Pi-native login command. It never performs browser consent or stores tokens.
- `identity.verify`: After login and reviewed read-only exposure, call bounded Headless 360 userinfo and require the authenticated organization id to match the planned connection binding.

## Scope and ownership

- Use `global` for user-level configuration across workspaces.
- Use `project` only in a trusted project. Project entries override global entries with the same normalized server name.
- Manual, modified, outdated, invalid, and canonically colliding entries fail closed. Set `replace_existing=true` only after reviewing status and the proposed diff.
- A project entry containing only `enabled`, `exposure`, or `toolExposure` is a Pi-native override of the matching global server, not a complete manual server. Use `/mcp` for ordinary override changes; replace it with a full project preset only after explicit review.
- The plan is bound to the current Pi session, workspace, scope, preset revision, exact connection name, optional Salesforce org identity and issuer proof, current target entry, proposed configuration, and managed-state record. Any target drift requires a new plan.
- Existing singleton entries remain compatible but unbound. SF MCP never guesses their Salesforce org identity.

## Tool exposure

Use `recommended` unless the user explicitly requests another reviewed profile:

- `recommended`: Apply conflict-aware SF Pi ownership guidance.
- `read-only`: Expose approved read tools through Code Mode and hide other tools.
- `all-approved`: Expose every available reviewed tool through Code Mode.
- `quarantine`: Keep every reviewed tool hidden while preserving the connection entry.

Exact per-tool exposure is available through the interactive `/sf-mcp` Manager and through `tools.plan` with `tool_overrides`. Newly observed tools that aren't in the reviewed preset contract remain hidden.

Slack and Informatica Catalog Discovery/Data Exploration publish connection guidance but not stable exact tool-name contracts. Their presets can be connected, but `tools.plan` refuses them and all observed tools remain Hidden. B2C Commerce has a reviewed contract from the GA `@salesforce/b2c-dx-mcp` package.

## Evidence boundaries

- `status` proves only the current local native configuration and SF MCP managed-state view.
- `configure.plan` proves a deterministic proposed configuration against that source view; it doesn't write or connect.
- `configure.apply` proves exact local readback after the native configuration and managed record are written. Reload is still required before the running Pi MCP runtime sees an external file change.
- `login.handoff` proves that an unchanged enabled managed entry exists. It doesn't prove OAuth completion or server connectivity.
- `/mcp` owns connection and OAuth evidence after reload.
