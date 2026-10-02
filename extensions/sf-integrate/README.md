# SF Integrate

## What It Does

SF Integrate provides plan-bound Salesforce integration authentication setup in explicit non-production orgs.

```text
plan → guarded create → secret-safe population → authorization → verify → bounded test
```

Three lifecycle directions are available:

- Hosted MCP OAuth through a public External Client App
- Generic inbound External Client Apps across the core OAuth flow matrix
- Outbound callouts through modern External Credentials and Named Credentials

## Commands

```text
/sf-integrate          Open SF Integrate in the SF Pi Manager
/sf-integrate status   Print extension status
/sf-integrate help     Print command and tool usage
```

## Actions

The `sf_integrate` family tool exposes:

```text
status
org.preflight
design.plan
setup.apply
secret.populate
oauth.authorize
setup.verify
connection.test
mcp.handoff
```

### Hosted MCP

`direction=mcp` creates and verifies the Salesforce side of Headless 360 OAuth:

- Callback: `http://localhost:8765/callback`
- Metadata scopes: `MCP, RefreshToken`
- OAuth request scopes: `mcp_api refresh_token`
- PKCE required
- Consumer secret optional
- Named-user JWT access tokens enabled
- Refresh-token rotation enabled

Salesforce generates the consumer key. `mcp.handoff` presents that public identifier for the human-reviewed `/sf-mcp` configuration flow. SF Integrate doesn't edit `mcp.json` or own OAuth tokens.

### Generic External Client Apps

`direction=inbound` supports these check-only-backed profiles:

- Confidential Authorization Code with enforced PKCE and consumer-secret requirements
- Public Authorization Code + PKCE
- Client Credentials with an explicit Salesforce execution user
- Device Flow with a localhost callback
- JWT Bearer with a PEM public certificate and pre-authorization Permission Set
- Token Exchange with matching global and org-policy flow flags

Every profile deploys and reads back four core components:

```text
ExternalClientApplication
ExtlClntAppGlobalOauthSettings
ExtlClntAppOauthSettings
ExtlClntAppOauthConfigurablePolicies
```

Token Exchange adds an `OauthTokenExchangeHandler` binding to an existing Apex class that extends `Auth.Oauth2TokenExchangeHandler`.

The matrix E2E harness proves check-only validation, disposable deployment, exact readback, and cleanup for all six profiles. Authorization Code receives an authorization-endpoint handshake, Device receives a device code, JWT Bearer performs and revokes a real token exchange, and Token Exchange deploys a disposable `Auth.Oauth2TokenExchangeHandler`, exchanges a synthetic JWT for an access token, and revokes it. Client Credentials creation and policy are proven; a complete token exchange still requires one-time custody of Salesforce's generated consumer secret.

### Outbound credentials

`direction=outbound` supports:

- OAuth Client Credentials with encrypted client-secret population
- OAuth JWT Bearer with an existing Salesforce signing certificate
- OAuth Authorization Code with External Auth Identity Provider credentials and browser consent
- Custom API-key headers backed by encrypted External Credential values

The generated stack contains the required subset of:

```text
External Auth Identity Provider → External Credential → Named Credential
                                      ↓
                         principal access Permission Set
                                      ↓
                         optional current-user assignment
```

`connection.test` invokes a GET-only `callout:` probe through SF Apex. Absolute test URLs, non-GET methods, and response-body disclosure are outside the interface.

### Official references

- [Create an External Client App for Hosted MCP Servers](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/create-external-client-app.html)
- [External Client App Global OAuth Settings](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_extlclntappglobaloauthsettings.htm)
- [External Client App OAuth Policies](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_extlclntappoauthconfigurablepolicies.htm)
- [Create an OAuth Named Credential](https://developer.salesforce.com/docs/platform/named-credentials/guide/nc-create-oauth-cred.html)
- [Populate External Credential Principals](https://developer.salesforce.com/docs/platform/named-credentials/guide/nc-populate-external-credentials.html)
- [Named Credential API Links](https://developer.salesforce.com/docs/platform/named-credentials/references/named-credentials-reference/nc-api-links.html)
- [Named Credentials Glossary](https://developer.salesforce.com/docs/platform/named-credentials/references/named-credentials-reference/nc-glossary.html)

## Safety and Data Boundaries

- No startup org probe, metadata describe, subprocess, or network call runs automatically.
- Every org-backed action requires an explicit target org.
- `setup.apply`, `secret.populate`, and `oauth.authorize` require a source-bound plan, `allow_mutation=true`, and separate Guardrail approval.
- Production and unknown org mutations are refused.
- Plans are session-bound, org-bound, API-version-bound, content-rehashed at apply time, and create-only.
- Raw secret values aren't accepted by the tool schema. Secrets come from a masked prompt or named environment variable and are sent directly to Salesforce.
- Custom API-key External Credential metadata receives check-only validation before deployment.
- Exact plans, responses, and verification records are mode-`0o600` artifacts under `<globalAgentDir>/sf-pi/sf-integrate/`.
- OAuth consent and the GET-only connection probe are explicit actions.
- Existing-resource update, rotation, migration, rollback, and destructive cleanup aren't model-callable in this phase.

## Troubleshooting

**Preflight is blocked:** Use an explicit sandbox, scratch, developer, or trial org with the required metadata support.

**Planning reports existing resources:** The current lifecycle is create-only. Choose new names or inspect the existing stack manually.

**Secret entry is unavailable:** Use interactive TUI prompt mode or set an uppercase environment variable and pass only its name through `secret_env`.

**OAuth client credentials remain unconfigured:** Verify the token URL, client ID, secret, scope, and whether the provider expects a different client-authentication method.

**Browser OAuth returns no consent URL:** Verify Identity Provider client credentials, principal access, permission-set assignment, and authorization/token URLs.

**Device Flow check-only fails:** Device Flow requires a localhost callback and must be isolated from other OAuth flows in the same local ECA.

**Inbound JWT Bearer planning fails:** Pass a workspace-contained PEM public certificate and an existing Permission Set assigned to the JWT subject user. Private-key files are refused.

**Inbound Client Credentials token exchange fails:** The ECA creation and policy can be automated, but Salesforce's generated consumer secret requires separate one-time custody before a real token exchange.

**Token Exchange planning fails:** Provide an existing Apex class that extends `Auth.Oauth2TokenExchangeHandler`, an active execution username, and an existing assigned pre-authorization Permission Set.

**Outbound JWT planning is blocked:** The signing certificate must already exist in Salesforce, and `iss`, `sub`, and `aud` must be explicit literal values.

**Connection test fails:** Verify authentication status first. The probe intentionally reports only the callout failure, not the external response body.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-integrate/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
