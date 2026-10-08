---
id: "0145"
status: accepted
date: 2026-10-08
---

# ADR 0145: SF MCP supports org-bound connection instances

SF MCP separates a reviewed MCP preset from its concrete connection instances. A preset continues to own one versioned tool contract, support classification, conflict mapping, and recommended exposure policy. An MCP Connection Instance owns one Pi-native server name, native configuration entry, optional Salesforce org binding, endpoint, public OAuth client identifier, scope, and configuration fingerprint. Several instances can reference the same preset without overwriting one another.

For Headless 360, `sf_mcp connection.plan` can accept an explicit Salesforce target org. It resolves that org through the Salesforce Connection Module, derives a trusted key from the existing My Domain, and probes the org-pinned protected-resource metadata. Planning succeeds only when discovery advertises exactly that org's My Domain and its OpenID metadata publishes matching issuer, authorization, and token endpoints. The proved endpoint and org identity become source-bound plan material and private managed-state evidence. Existing generic endpoint setup remains compatible, while actions that face several managed instances require an exact connection name.

SF Integrate expands its existing `design.plan` and `setup.apply` lifecycle instead of adding an independent activation command. Planning classifies an exact existing Headless 360 External Client App as adoptable, refuses mismatched existing metadata, and includes hosted-server activation. `setup.apply` keeps Metadata API check-only before ECA creation, adopts exact existing apps without redeployment, and activates Headless 360 through the Tooling `McpServerAccess` object when runtime describe proves the required fields and write capabilities. The activation operation is source-bound as no-op, create, or update and receives exact readback verification.

`McpServerAccess` is an observed Tooling capability rather than a public documented contract. Missing schema, insufficient permissions, unsupported writes, duplicate rows, or ambiguous resulting state fail closed and route to the curated SF Browser `mcp-servers` destination. SF Browser remains the evidence-backed fallback, not the default. Production and unknown-org mutations remain refused.

The Headless 360 handoff now retains the explicit org identity, org type, trusted host key, activation state, and deterministic per-org server name. After human OAuth and reviewed read-only exposure, `identity.verify` invokes bounded `dispatch_readonly` userinfo and requires the authenticated organization id to equal the source-bound org binding. The SF MCP Manager remains preset-first and displays configured connection instances beneath the preset. Pi continues to own transport, OAuth consent, token storage, refresh, and runtime connection state. Tool exposure remains stored only in each native MCP entry; SF MCP introduces no second policy store.

This decision preserves existing singleton entries as unbound compatible connections. SF MCP never guesses their org identity. A future reviewed migration can bind or rename one after runtime identity proof.
