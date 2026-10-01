# SF MCP

SF MCP makes Salesforce-published MCP servers easy to discover and configure while leaving the MCP runtime entirely with Pi.

## What It Does

- Shows a local, versioned catalog of Salesforce MCP presets.
- Detects semantic overlap with enabled SF Pi family tools.
- Recommends a complementary profile instead of silently duplicating capabilities.
- Writes explicit, user-reviewed entries to Pi's native global or project `mcp.json`.
- Publishes each preset's short description for Pi's MCP prompt summary, tool-search ranking, and namespace inspection.
- Preserves unknown top-level configuration and unrelated servers.
- Detects server names that collide after Pi normalizes hyphens and underscores.
- Offers explicit adoption, redacted diff, reset, and canonical-name reconciliation for existing entries.
- Versions governed preset contracts and reports observed tool additions or removals.
- Keeps newly discovered tools hidden for presets with an approved tool contract.
- Uses `/mcp` for connection state, OAuth, errors, reconnects, and exposure review.

The SF MCP extension is enabled by default for discoverability, but **every MCP server is off by default**. Loading SF Pi performs no Salesforce MCP network request or subprocess launch.

## Capability Ownership

The default routing policy is:

1. Prefer the specialized SF Pi family tool when it owns the lifecycle.
2. Expose only complementary MCP tools that add a capability.
3. Offer full MCP side-by-side exposure only as an explicit advanced choice.
4. Never disable an SF Pi extension automatically.

For example, when SF SOQL is enabled, selecting SObject All recommends keeping SF SOQL for bounded reads and enabling SObject Mutations only for create/update. Delete remains a separate elevated-risk preset.

## Commands

```text
/sf-mcp
/sf-mcp catalog
/sf-mcp status [--scope global|project]
/sf-mcp conflicts <preset-id> [--scope global|project]
/sf-mcp disable <preset-id> [--scope global|project]
/sf-mcp native
/sf-mcp help
```

Interactive setup lives in the SF Pi Manager settings panel. `/sf-mcp native` prepares Pi's built-in `/mcp` manager after installation.

## Tool

`sf_mcp_verify_target` performs the read-only, one-use exact-org attestation required immediately before an SObject MCP mutation. Pass the configured SObject server name, an explicit Salesforce CLI alias or username, and the exact next MCP mutation tool. The tool invokes the server's own `soqlQuery` through Pi's nested-tool pipeline, so MCP OAuth, SF Guardrail hooks, and cancellation remain Pi-owned.

## Configuration

Open `/sf-mcp`, enter **Settings**, select a preset, and press Enter. Capability review, setup fields, configuration review, apply, and result states remain inside the same SF Pi Manager window. Choose global or trusted-project scope before applying the preset. Hosted Salesforce servers collect only the environment and External Client App consumer key needed to generate native Pi configuration. Use `/mcp` after reload for OAuth sign-in, connection diagnostics, exposure changes, and reconnects.

SF MCP-managed entries can be disabled from the catalog or `/sf-mcp disable <preset-id>`. Existing manual entries and entries changed outside SF MCP remain user-owned. The Manager can adopt a compatible entry without changing it, or show a redacted field-level diff before an explicit reset. Canonically colliding names require the user to choose the one entry to keep.

## Safety and Data Boundaries

- The catalog is local and performs no network request or subprocess launch at startup.
- MCP servers, tools, OAuth, and resources remain off until explicit setup.
- Complementary profiles hide overlapping tools rather than merely deferring them.
- Governed hosted presets use hidden server exposure with exact approved tools, so newly discovered tools remain unreachable until a preset revision approves them.
- New custom servers start with `hidden` exposure and no callable tools.
- OAuth tokens remain in Pi's native MCP credential store.
- External Client App consumer keys are public client identifiers; client secrets are never requested for Salesforce Hosted MCP presets.
- MuleSoft credentials are environment references only and are never copied into SF MCP state.
- Salesforce record writes and deletes, Backup and Recover writes, Content writes, and Headless 360 dispatch pass through SF Guardrail. Production or unknown hosted targets fail closed.
- SObject mutations require `sf_mcp_verify_target` to match the authenticated MCP `Organization.Id` to an explicit Salesforce CLI org before Guardrail can offer confirmation. The attestation is one-use, configuration-bound, session-local, and expires after two minutes.
- Hosted mutation servers that cannot return an exact org fingerprint remain fail-closed; endpoint classification alone never authorizes a write.

## Native Configuration Ownership

Pi remains authoritative for:

- MCP transport and process lifecycle
- OAuth token storage and refresh
- connection and error state
- tool discovery and resources
- exposure, codemode, and tool search

SF MCP stores only a short configuration fingerprint, preset id, preset revision, and selected resolution so it can detect manual edits and outdated presets. Observed tool names are session-local. It stores no OAuth tokens, client secrets, record data, or tool arguments.

## Exact Target Attestation

A hosted endpoint proves an environment family, not the exact org selected during OAuth. `sf_mcp_verify_target` closes that gap for SObject mutation, delete, and all servers by executing this bounded read through the same authenticated MCP connection:

```sql
SELECT Id, IsSandbox FROM Organization LIMIT 1
```

It compares the returned `Organization.Id` and sandbox classification with an explicit Salesforce CLI target resolved through the shared Salesforce Connection Module. A successful match records one in-memory attestation bound to the session, canonical server name, exact next mutation tool, and native MCP configuration fingerprint. The next matching tool call consumes it. Mismatches, expiry, configuration changes, another tool, another session, or missing evidence fail closed.

Verification is not approval. SF Guardrail still blocks production writes and still asks before an exactly attested sandbox write. SF MCP never reads Pi's OAuth token store and never starts a second MCP client.

Other hosted mutation servers remain blocked until their own MCP tool surface can return an equivalent exact org fingerprint.

## Live Sandbox Smoke

Use a dedicated sandbox fixture and never substitute a production org:

1. Configure SObject Reads with the sandbox endpoint and a public External Client App consumer key.
2. Reload Pi, open `/mcp`, complete OAuth, and verify the server and approved tool count.
3. Run `getUserInfo`, `getObjectSchema`, and a bounded `soqlQuery`.
4. Configure SObject Mutations and call `sf_mcp_verify_target` for the exact next mutation and explicit CLI sandbox target.
5. Update a dedicated fixture record, re-verify, and restore the original value.
6. Confirm that Guardrail asks before both exactly attested writes.
7. Keep production, unknown, missing-attestation, and mismatch blocking as automated Behavior Proofs; no production connection is required.

The repository's normal automated suite does not require Hosted MCP credentials. Live smoke evidence is release evidence, not a default CI dependency.

## Current Presets

- Salesforce DX
- SObject Reads
- SObject Mutations
- SObject Deletes
- SObject All
- Data 360
- Backup and Recover (**SF Pi Alpha**; the current Salesforce reference leaves GA/Beta status unresolved)
- Content Read-Only (**SF Pi Alpha**; Salesforce currently documents Agentforce Vibes as the only supported client)
- Content Write (**SF Pi Alpha**; Salesforce currently documents Agentforce Vibes as the only supported client)
- Headless 360 (Beta; includes Archive Connect operations)
- Tableau Next
- CRM Analytics (Beta)
- Marketing Cloud Engagement
- MuleSoft DX
- Custom Salesforce MCP quarantine entry

## Official Sources

- [Pi MCP configuration and exposure](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
- [Salesforce DX MCP setup](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-mcp-server.html)
- [Salesforce Hosted MCP standard servers](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/servers-reference.html)
- [SObject Reads identity and read tools](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html)
- [Marketing Cloud Engagement MCP setup](https://developer.salesforce.com/docs/marketing/mce-mcp/guide/mce-mcp-setup.html)
- [MuleSoft DX MCP setup](https://docs.mulesoft.com/mulesoft-mcp-server/getting-started)

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-mcp/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
