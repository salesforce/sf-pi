# SF MCP Agent Guide

Use `sf_mcp` to inspect and author reviewed Salesforce MCP entries in Pi's native MCP configuration. Pi remains the runtime authority for transport, connections, OAuth, token storage, tools, resources, and readiness.

## Hosted OAuth lifecycle

1. Use `sf_integrate` to create and verify the Salesforce External Client App when one doesn't already exist.
2. Run `sf_mcp` action `status` with the intended `scope` and `preset_id`.
3. Run `configure.plan` with an explicit scope, preset, conflict resolution, reviewed tool profile, and preset-specific setup values.
4. Review the redacted diff, warnings, `plan_id`, and `plan_hash`.
5. Run `configure.apply` with the exact plan identity and `allow_mutation=true`.
6. Run `login.handoff` after exact resulting-state verification.
7. Reload Pi when the apply result says it is required, run the returned `/mcp login <server>` command, and complete human OAuth consent.
8. Use `/mcp` to inspect connection state, errors, tools, resources, reconnects, and logout.

For Headless 360, pass the public External Client App consumer key as `oauth_client_id`, choose the matching `production` or `sandbox` endpoint family, and use the callback required by the preset. Never pass a client secret or OAuth token.

## Actions

- `status`: Read native configuration ownership, drift, overlap, and scope-conflict state. Defaults to global scope only when scope is omitted.
- `configure.plan`: Build a session-bound, source-bound redacted plan. It never writes configuration.
- `configure.apply`: Apply only the exact plan while its target source state is unchanged. Requires `allow_mutation=true` and remains Guardrail-mediated.
- `disable.plan`: Plan disabling one unchanged SF MCP-managed entry.
- `disable.apply`: Apply the exact disable plan with explicit mutation intent and Guardrail approval.
- `login.handoff`: Return the exact Pi-native login command. It never performs browser consent or stores tokens.

## Scope and ownership

- Use `global` for user-level configuration across workspaces.
- Use `project` only in a trusted project. Project entries override global entries with the same normalized server name.
- Manual, modified, outdated, invalid, and canonically colliding entries fail closed. Set `replace_existing=true` only after reviewing status and the proposed diff.
- A project entry containing only `enabled`, `exposure`, or `toolExposure` is a Pi-native override of the matching global server, not a complete manual server. Use `/mcp` for ordinary override changes; replace it with a full project preset only after explicit review.
- The plan is bound to the current Pi session, workspace, scope, preset revision, current target entry, proposed configuration, and managed-state record. Any target drift requires a new plan.

## Tool exposure

Use `recommended` unless the user explicitly requests another reviewed profile:

- `recommended`: Apply conflict-aware SF Pi ownership guidance.
- `read-only`: Expose approved read tools through Code Mode and hide other tools.
- `all-approved`: Expose every available reviewed tool through Code Mode.
- `quarantine`: Keep every reviewed tool hidden while preserving the connection entry.

Custom per-tool exposure remains an interactive `/sf-mcp` Manager workflow. Newly observed tools that aren't in the reviewed preset contract remain hidden.

## Evidence boundaries

- `status` proves only the current local native configuration and SF MCP managed-state view.
- `configure.plan` proves a deterministic proposed configuration against that source view; it doesn't write or connect.
- `configure.apply` proves exact local readback after the native configuration and managed record are written. Reload is still required before the running Pi MCP runtime sees an external file change.
- `login.handoff` proves that an unchanged enabled managed entry exists. It doesn't prove OAuth completion or server connectivity.
- `/mcp` owns connection and OAuth evidence after reload.
