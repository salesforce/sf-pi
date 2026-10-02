---
id: "0133"
status: accepted
date: 2026-10-01
---

# ADR 0133: SF Integrate hardens core ECA OAuth profiles

SF Integrate adds `direction=inbound` with six grounded External Client App OAuth profiles: confidential Authorization Code, public Authorization Code with PKCE, Client Credentials, Device, JWT Bearer, and Token Exchange. Specialized Authorization Code and Credentials and Asset Token flows remain separate because they require headless-identity, Experience Cloud, or asset-token prerequisites beyond the core API-client lifecycle.

Each profile compiles to four core Metadata API components: `ExternalClientApplication`, `ExtlClntAppGlobalOauthSettings`, `ExtlClntAppOauthSettings`, and `ExtlClntAppOauthConfigurablePolicies`. Token Exchange adds an `OauthTokenExchangeHandler` binding to an existing Apex handler class. Every create runs check-only first, deploys only after validation, reads the planned components back, and compares callback, scopes, flow flags, secret requirements, certificate presence, execution user, handler binding, and permitted-users policy with the source-bound plan. Apply recomputes the plan-content hash so in-memory source mutation can't reuse prior approval evidence.

Current platform enforcement normalizes PKCE to required for supported authorization flows, including confidential Authorization Code clients. Device Flow requires a localhost callback and must be isolated from other OAuth flows in the same local ECA. Client Credentials requires an execution user in org-local policy. JWT Bearer requires a workspace-contained PEM public certificate plus an existing assigned Permission Set; private-key files are refused. Token Exchange sets matching global and policy flags.

A sandbox/developer-only matrix harness check-only validates every core profile and can create, read back, perform bounded handshakes, and clean up disposable apps. Authorization Code proves the authorization endpoint recognizes the client. Device proves device-code issuance. JWT Bearer signs a short-lived assertion, exchanges it for an access token, and revokes the token. Token Exchange deploys a disposable Apex class plus `OauthTokenExchangeHandler` binding, validates a synthetic JWT, maps it to the test user, exchanges it for an access token, and revokes the token. Client Credentials proves metadata and policy but a full exchange remains gated by one-time custody of Salesforce's generated consumer secret; SF Pi doesn't persist or fabricate that secret.

Global OAuth metadata can contain sensitive consumer material. SF Integrate stages it only in temporary deployment directories and mode-0600 artifacts. Runtime private keys remain E2E-temporary, never enter plans or artifacts, and are removed during cleanup.
