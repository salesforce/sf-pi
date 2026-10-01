# SF Integrate Agent Guide

Use `sf_integrate` for plan-bound integration authentication setup in explicit non-production Salesforce orgs.

## Choose the lifecycle

- `direction=mcp` owns the Salesforce-org side of a public External Client App for the Headless 360 hosted MCP preset.
- `direction=outbound` owns modern External Credential, Named Credential, principal access, and bounded connection proof.
- SF MCP still owns `mcp.json`, server exposure, connections, and native MCP OAuth tokens.
- SF Apex owns the Anonymous Apex execution used by `connection.test`.

## Inbound hosted MCP lifecycle

1. `org.preflight`
2. `design.plan` with `direction=mcp` and `mcp_preset=headless-360`
3. `setup.apply` with the exact plan ID/hash/app name and `allow_mutation=true`
4. `setup.verify`
5. `mcp.handoff`
6. Copy the public consumer key into `/sf-mcp`, reload, then use `/mcp login salesforce-headless-360`

The generated public client uses `http://localhost:8765/callback`, Metadata API scopes `MCP, RefreshToken`, PKCE, named-user JWT access tokens, and refresh-token rotation. It never needs a client secret.

## Outbound lifecycle

1. `design.plan` with `direction=outbound`, an `auth_type`, exact HTTPS endpoint, and protocol-specific inputs.
2. Review the resource graph and source-bound plan artifact.
3. `setup.apply` with the exact plan ID/hash/named credential name and `allow_mutation=true`.
4. If the plan reports a credential shape, run `secret.populate` with either:
   - `secret_source=prompt` in the interactive TUI, or
   - `secret_source=env` plus an uppercase `secret_env` name.
5. For `oauth_browser`, run `oauth.authorize`, open the returned provider URL, and complete consent.
6. Run `setup.verify` until the stack and credential status match the plan.
7. Run `connection.test` with a relative `test_path`. It performs a GET-only callout through `sf_apex` and doesn't return the response body.

### Supported outbound authentication

- `oauth_client_credentials`: requires `token_url`; `secret.populate` takes a public `client_id` plus a secret from prompt/environment.
- `oauth_jwt_bearer`: requires an existing `signing_certificate`, literal `jwt_issuer`, `jwt_subject`, `jwt_audience`, and `token_url`; no secret population step.
- `oauth_browser`: requires `authorize_url`, `token_url`, identity-provider credentials through `secret.populate`, then `oauth.authorize`. Defaults to a per-user principal.
- `api_key`: requires `api_key_header`. The External Credential parameter is check-only validated through Metadata API before deployment, and `secret.populate` stores the key encrypted in Salesforce.

## Ownership and secret safety

- Never put a secret value in tool arguments, chat, artifacts, source, or an environment-variable name field.
- The masked prompt value exists only in memory long enough to send it to Salesforce.
- Environment mode reads the value by name at execution and never echoes it.
- OAuth client IDs aren't secrets, but cards and artifacts remain private by default.
- Salesforce owns encrypted User External Credentials and browser-flow tokens.
- `connection.test` is GET-only and requires a named credential API name plus a relative path; absolute URLs and alternate callout targets are rejected.

## Mutation safety

- Every org-backed action requires `target_org`; default-org fallback is refused.
- `setup.apply`, `secret.populate`, and `oauth.authorize` require `allow_mutation=true`, remain Guardrail-mediated, and refuse production or unknown orgs.
- Plans are session-bound, org-bound, API-version-bound, source-hashed, and create-only.
- Existing resources or state that appears after planning is drift. Phase 2 doesn't adopt or overwrite it.
- Custom API-key External Credentials receive Metadata API check-only validation. Connect REST resources have no check-only API, so the exact plan and current-state recheck are their rehearsal boundary.
- Partial failures are reported as unverified state. Run verification before manual cleanup or repair.

## Evidence boundaries

- `org.preflight` proves target and External Client App metadata eligibility at that time.
- `design.plan` proves deterministic payloads/source and current absence of the requested names.
- `setup.apply` proves create responses and immediate readback, not external authentication.
- `secret.populate` proves Salesforce accepted encrypted credential values; it doesn't prove the external provider accepted them.
- `oauth.authorize` proves Salesforce generated a consent URL, not that the user completed consent.
- `setup.verify` proves exact stack, access, assignment, and available authentication status.
- `connection.test` proves only one bounded GET callout at that time.

Production policies, existing-resource updates, rotation, migration, rollback, private endpoints, AWS SigV4, and user-selected destructive cleanup remain future work.
