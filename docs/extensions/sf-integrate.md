---
title: "SF Integrate"
description: "Plan-bound Salesforce inbound OAuth and outbound modern credential setup, with guarded apply, secret-safe population, resulting-state verification, and bounded connection proof."
editLink: false
---

# SF Integrate

<p class="sfpi-page-lead">Plan-bound Salesforce inbound OAuth and outbound modern credential setup, with guarded apply, secret-safe population, resulting-state verification, and bounded connection proof.</p>

## What it does

Owns plan-bound Salesforce integration authentication setup in explicit non-production orgs. The inbound slice supports Headless 360 External Client Apps with Metadata API check-only validation and SF MCP handoff. The outbound slice supports OAuth client credentials, OAuth JWT bearer, OAuth authorization code, and custom API-key External Credential plus Named Credential stacks, secret-safe population from a masked prompt or environment reference, principal permission access, OAuth consent URLs, resulting-state verification, and GET-only callout proof through SF Apex.

## Start

Open the extension from its primary command:

```text
/sf-integrate
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-integrate
/sf-pi enable sf-integrate
/sf-pi disable sf-integrate
```

## Safety notes

- No startup org probes, metadata describes, subprocesses, or network calls; the family tool registers on session_start and contacts Salesforce only for explicit actions.
- Every org-backed action requires an explicit target_org. setup.apply, secret.populate, and oauth.authorize require a current session-bound plan ID/hash/exact target plus allow_mutation=true, remain Guardrail-mediated, and refuse production or unknown orgs.
- setup.apply is create-only in Phase 1, runs Metadata API check-only validation before deployment, refuses current-state drift, and verifies three exact External Client App components after deployment.
- The Headless 360 app is a public PKCE client and never uses a client secret. Outbound secrets are accepted only through a masked TUI prompt or named environment variable, sent directly to Salesforce, and never written to tool arguments, model output, or artifacts.
- SF Integrate never edits mcp.json or stores OAuth tokens. The final client-ID copy remains an explicit handoff to SF MCP and Pi's native MCP OAuth runtime.
- Both slices are create-only and refuse existing-resource drift. The outbound connection proof is GET-only, delegates execution to sf_apex, and never returns the external response body.
- Production policies, existing-resource updates, rotations, migration, rollback, and user-selected destructive cleanup remain out of scope.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-integrate`
- **Intent:** Work with Salesforce orgs
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-integrate`
- **LLM tools:** `sf_integrate`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-integrate/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-integrate)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-integrate/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-integrate/README.md#troubleshooting) for extension-specific recovery steps.
