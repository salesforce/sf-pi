---
id: "0131"
status: accepted
date: 2026-10-01
---

# ADR 0131: SF Integrate owns hosted MCP org OAuth setup

SF Pi adds `sf-integrate` as a lean Integration Setup Lifecycle Extension with one `/sf-integrate` command and one `sf_integrate` family tool. Its first vertical slice owns only the Salesforce-org side of OAuth setup for the Headless 360 hosted MCP preset: explicit-org preflight, immutable create-only planning, Metadata API check-only validation, guarded deployment, exact metadata readback, and consumer-key handoff.

The extension creates a local External Client App with three components: `ExternalClientApplication`, `ExtlClntAppGlobalOauthSettings`, and `ExtlClntAppOauthSettings`. The public client uses `http://localhost:8765/callback`, Metadata API scopes `MCP, RefreshToken`, PKCE, an optional consumer secret, named-user JWT access tokens, and refresh-token rotation. The callback uses `localhost` rather than `127.0.0.1` because current External Client App Metadata API validation accepts the former for a loopback client while the Pi native MCP runtime supports an explicit localhost callback URL. SF MCP uses the same shared callback contract for new Headless 360 configurations.

`setup.apply` requires an explicit target org, current session-bound plan ID, source hash, matching app name, and `allow_mutation=true`. It is mediated by SF Guardrail, refuses production and unknown orgs, checks that no planned component appeared after planning, validates the exact source with `checkOnly=true`, deploys only after validation passes, and reads all three components back. Deployment evidence is not MCP connectivity evidence.

SF MCP remains the owner of `mcp.json`, preset governance, tool exposure, server connections, and the human configuration panel. Pi's native MCP runtime remains the owner of OAuth consent, tokens, refresh, login, and logout. `mcp.handoff` returns the public consumer key and exact callback/scopes for a human to paste into SF MCP; SF Integrate does not edit MCP configuration or store tokens.

Phase 1 is deliberately create-only and non-production. Existing app updates, permission allowlists, token TTL policy, propagation polling, Connected App migration, outbound Named Credentials, secret population, rotation, rollback, and deletion require separate lifecycle expansion and proof.
