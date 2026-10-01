---
id: "0132"
status: accepted
date: 2026-10-01
---

# ADR 0132: SF Integrate adds plan-bound outbound credentials

SF Integrate expands its existing plan/apply/verify lifecycle with `direction=outbound`. The extension creates modern External Credential plus Named Credential stacks for OAuth Client Credentials, OAuth JWT Bearer, OAuth Authorization Code, and custom API-key headers. It also creates one Permission Set, grants External Credential principal access through `SetupEntityAccess`, and can assign that Permission Set to the authenticated user.

Connect REST creation has no check-only mode. Its rehearsal boundary is therefore an immutable, org-bound, API-version-bound plan plus a fresh absence check immediately before every create. Custom API-key External Credentials use Metadata API because their encrypted parameter definition isn't expressible by the create endpoint used in this slice; that component receives check-only validation before deployment. Every slice remains create-only and refuses existing-resource drift.

Secrets never enter tool arguments. `secret.populate` resolves a masked TUI value or an uppercase environment-variable reference at execution, sends it directly to Salesforce, and persists only Salesforce's secret-free response and resulting state. OAuth browser client credentials use the External Auth Identity Provider credential endpoint. OAuth Client Credentials and custom API keys use the principal credential endpoint. JWT Bearer relies on an existing Salesforce signing certificate and literal JSON-quoted `iss`, `sub`, and `aud` claims.

`oauth.authorize` returns Salesforce's generated provider consent URL only after the planned principal access exists. Salesforce owns the resulting User External Credential and tokens. `connection.test` accepts one Named Credential API name plus a relative path and delegates a GET-only Anonymous Apex probe to SF Apex; it doesn't expose arbitrary methods, alternate hosts, or response bodies.

SF Guardrail separately mediates setup, credential population, and OAuth authorization. All mutations refuse production and unknown orgs. Existing-resource updates, secret rotation, migration, rollback, private endpoints, AWS Signature v4, and model-callable deletion remain future lifecycle work.
