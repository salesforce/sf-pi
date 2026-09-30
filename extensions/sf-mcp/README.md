# SF MCP

SF MCP makes Salesforce-published MCP servers easy to discover and configure while leaving the MCP runtime entirely with Pi.

## What It Does

- Shows a local, versioned catalog of Salesforce MCP presets.
- Detects semantic overlap with enabled SF Pi family tools.
- Recommends a complementary profile instead of silently duplicating capabilities.
- Writes explicit, user-reviewed entries to Pi's native global or project `mcp.json`.
- Publishes each preset's short description for Pi's MCP prompt summary, tool-search ranking, and namespace inspection.
- Preserves unknown top-level configuration and unrelated servers.
- Refuses to overwrite manual, malformed, or externally modified entries.
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

## Configuration

Open `/sf-mcp`, enter **Settings**, select a preset, and press Enter. Capability review, setup fields, configuration review, apply, and result states remain inside the same SF Pi Manager window. Choose global or trusted-project scope before applying the preset. Hosted Salesforce servers collect only the environment and External Client App consumer key needed to generate native Pi configuration. Use `/mcp` after reload for OAuth sign-in, connection diagnostics, exposure changes, and reconnects.

SF MCP-managed entries can be disabled from the catalog or `/sf-mcp disable <preset-id>`. Existing manual entries and entries changed outside SF MCP remain user-owned and are never replaced automatically.

## Safety and Data Boundaries

- The catalog is local and performs no network request or subprocess launch at startup.
- MCP servers, tools, OAuth, and resources remain off until explicit setup.
- Complementary profiles hide overlapping tools rather than merely deferring them.
- New custom servers start with `hidden` exposure and no callable tools.
- OAuth tokens remain in Pi's native MCP credential store.
- External Client App consumer keys are public client identifiers; client secrets are never requested for Salesforce Hosted MCP presets.
- MuleSoft credentials are environment references only and are never copied into SF MCP state.
- Salesforce record writes and deletes pass through SF Guardrail. Production or unknown hosted targets fail closed; trusted sandbox endpoint configuration still requires confirmation.

## Native Configuration Ownership

Pi remains authoritative for:

- MCP transport and process lifecycle
- OAuth token storage and refresh
- connection and error state
- tool discovery and resources
- exposure, codemode, and tool search

SF MCP stores only a short configuration fingerprint, preset id, and selected resolution so it can detect manual edits. It stores no OAuth tokens, client secrets, record data, or tool arguments.

## Current Presets

- Salesforce DX
- SObject Reads
- SObject Mutations
- SObject Deletes
- SObject All
- Data 360
- Marketing Cloud Engagement
- MuleSoft DX
- Custom Salesforce MCP quarantine entry

## Official Sources

- [Pi MCP configuration and exposure](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
- [Salesforce DX MCP setup](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-mcp-server.html)
- [Salesforce Hosted MCP standard servers](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/servers-reference.html)
- [Marketing Cloud Engagement MCP setup](https://developer.salesforce.com/docs/marketing/mce-mcp/guide/mce-mcp-setup.html)
- [MuleSoft DX MCP setup](https://docs.mulesoft.com/mulesoft-mcp-server/getting-started)

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-mcp/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
