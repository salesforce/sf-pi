# SF MCP

SF MCP makes Salesforce-published MCP servers easy to discover and configure while leaving the MCP runtime entirely with Pi.

## What It Does

- Shows a local, versioned catalog of Salesforce MCP presets grouped by product family.
- Opens every preset with a non-mutating overview of capabilities, documented tools, risk, support maturity, conflicts, and official documentation.
- Merges bounded session-observed tool descriptions, input schemas, annotations, and effective exposure after a server connects; runtime metadata is never persisted.
- Detects semantic overlap with enabled SF Pi family tools.
- Maps reviewed MCP tools to exact enabled SF Pi capability owners, including broad dispatcher warnings.
- Offers a deterministic native-preferred recommendation or an explicit keep-both policy without disabling native extensions.
- Writes explicit, user-reviewed entries to Pi's native global or project `mcp.json`.
- Publishes each preset's short description for Pi's MCP prompt summary, tool-search ranking, and namespace inspection.
- Preserves unknown top-level configuration and unrelated servers.
- Detects server names that collide after Pi normalizes hyphens and underscores.
- Offers explicit adoption, redacted diff, reset, and canonical-name reconciliation for existing entries.
- Versions governed preset contracts and reports observed tool additions or removals.
- Reviews live contract drift: additions remain locked hidden pending a preset revision, while removed tools become unavailable and can be repaired to Hidden through an explicit diff.
- Keeps newly discovered tools hidden for presets with an approved tool contract.
- Authors exact per-tool exposure through Recommended, Read-only, All approved, Custom, and Quarantine profiles.
- Supports Pi's Hidden, Code Mode, Deferred, and Direct exposure modes with explicit diff review and warnings for risky Direct choices.
- Uses `/mcp` for connection state, OAuth, errors, reconnects, and manual runtime review.

The SF MCP extension is enabled by default for discoverability, but **every MCP server is off by default**. Loading SF Pi performs no Salesforce MCP network request or subprocess launch.

## Capability Ownership

The default routing policy is:

1. Prefer the specialized SF Pi family tool when it owns the lifecycle.
2. Map reviewed MCP tools to exact active owners and recommend Hidden for direct or broad mutation overlap.
3. Keep complementary discovery tools in Code Mode and partial read overlap Deferred when the reviewed mapping says they add value.
4. Offer full MCP side-by-side exposure only as an explicit keep-both choice.
5. Never disable an SF Pi extension automatically.

For example, the Data 360 recommendation keeps `search` and `payload_examples` in Code Mode while hiding broad `execute`. The Headless 360 recommendation hides `dispatch`, keeps discovery tools in Code Mode, and makes `dispatch_readonly` Deferred. Selecting keep-both exposes the complete reviewed contract and adds compact routing guidance for the owners whose conflicting tools remain reachable.

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

Open `/sf-mcp`, enter **Settings**, select a preset, and press Enter. The first page is always a read-only overview. **Configure tool exposure** opens a reviewed profile and per-tool editor; **Configure connection** continues to capability review, setup fields, configuration review, apply, and result states. For a new server, SF MCP carries the selected tool policy through connection setup. For an unchanged managed server, it shows an exact redacted diff and updates only `exposure` and `toolExposure`. Choose global or trusted-project scope before applying a change. Hosted Salesforce servers collect only the environment and External Client App consumer key needed to generate native Pi configuration. Use `/mcp` after reload for OAuth sign-in, connection diagnostics, manual exposure review, and reconnects.

Governed presets include concise, versioned tool summaries sourced from official documentation. Salesforce DX catalogs the nine GA tools in the configured core toolsets; standalone Tableau, Tableau Next, Trailhead, Marketing Cloud Engagement, and MuleSoft DX include their published tool references. The connected server can advertise a subset based on enabled features, toolsets, client support, permissions, or entitlements, and unavailable documented tools remain locked hidden. Custom servers and Agentforce Sales show reviewed capability groups plus live metadata because Salesforce doesn't currently publish an exact Agentforce Sales tool reference. An observed tool absent from an approved contract remains visibly unapproved and inherits hidden exposure.

**Tableau MCP and Tableau Next MCP are distinct.** Tableau MCP connects to Tableau's standalone managed stack at `mcp.tableau.com`; Tableau Next MCP connects to the Salesforce/Core hosted endpoint and its semantic layer. Trailhead MCP connects without authentication and exposes only public learning-content search and retrieval.

**Review tool conflicts** shows the exact tools, capability, active owners, relationship, and recommended exposure. Broad meta-tools explicitly warn that Pi can govern the dispatcher but not individual operations behind it. **Review contract drift** separates observed additions from documented removals. Added tools require a reviewed SF MCP preset revision; removed tools can be repaired to Hidden when the native entry remains unchanged and managed.

SF MCP-managed entries can be disabled from the catalog or `/sf-mcp disable <preset-id>`. Existing manual entries and entries changed outside SF MCP remain user-owned. The Manager can adopt a compatible entry without changing it, or show a redacted field-level diff before an explicit reset. Canonically colliding names require the user to choose the one entry to keep.

## Safety and Data Boundaries

- The catalog is local and performs no network request or subprocess launch at startup.
- MCP servers, tools, OAuth, and resources remain off until explicit setup.
- Complementary profiles hide overlapping tools rather than merely deferring them.
- Governed hosted presets use hidden server exposure with an exact reviewed tool policy, so newly discovered tools remain unreachable until a preset revision approves them.
- Read-only profiles hide every write, destructive, mixed, or unknown-risk tool. Documented tools missing from an observed live contract remain locked hidden.
- Direct exposure for a non-read tool is allowed only as an explicit custom choice and produces a visible warning before apply.
- Native-preferred conflict recommendations alter only MCP exposure. They never disable `sf-soql`, `sf-apex`, `sf-flow`, `sf-data360`, or another SF Pi owner.
- Runtime observation never approves a new tool. Additions require a reviewed preset revision; removed tools remain unavailable and repair only changes their native exposure to Hidden.
- New custom servers start with `hidden` exposure and no callable tools.
- OAuth tokens, including standalone Tableau OAuth, remain in Pi's native MCP credential store.
- Trailhead MCP requires no authentication and is restricted to its two documented read-only public-content tools.
- External Client App consumer keys are public client identifiers. Standard hosted presets don't request client secrets.
- Agentforce Sales references `AGENTFORCE_SALES_CLIENT_SECRET`; MuleSoft references `ANYPOINT_CLIENT_ID` and `ANYPOINT_CLIENT_SECRET`. Secret values are never copied into SF MCP state.
- Backup and Recover writes, Content writes, Headless 360 dispatch, hosted Data 360 execution, and managed external operations pass through SF Guardrail. Every experimental Agentforce Sales operation fails closed because exact OAuth-org identity is unavailable. Hosted mutation targets without exact identity evidence remain fail-closed.
- The legacy SObject Reads, Mutations, Deletes, and All servers are intentionally absent from the SF MCP catalog. Existing native Pi entries are left untouched and remain visible in `/mcp`; users remove them there if desired. Legacy SObject mutation calls remain Guardrail-mediated and fail closed.

## Native Configuration Ownership

Pi remains authoritative for:

- MCP transport and process lifecycle
- OAuth token storage and refresh
- connection and error state
- tool discovery and resources
- runtime enforcement of exposure, Code Mode, and tool search

SF MCP authors reviewed native `exposure` and `toolExposure` fields, while Pi remains the runtime authority that enforces them. The selected per-tool policy lives in `mcp.json`; SF MCP does not duplicate it in extension state. SF MCP stores only a short configuration fingerprint, preset id, preset revision, and selected resolution so it can detect manual edits and outdated presets. Observed tool metadata is session-local. It stores no OAuth tokens, client secrets, record data, or tool arguments.

## Legacy SObject Servers

SF MCP no longer catalogs or manages the four legacy SObject server presets. This is an SF Pi product simplification to avoid overlapping choices with Headless 360 and the native SF SOQL lifecycle; it is not a claim that Salesforce has retired the underlying public endpoints.

Upgrades never delete user-owned Pi configuration. Existing `salesforce-sobject-*` entries continue to be owned by Pi's `/mcp` manager until the user disables or removes them.

## Current Presets

### Salesforce Core

- Salesforce DX
- Backup and Recover (**SF Pi Alpha**; the current Salesforce reference leaves GA/Beta status unresolved)
- Content Read-Only (**SF Pi Alpha**; Salesforce currently documents Agentforce Vibes as the only supported client)
- Content Write (**SF Pi Alpha**; Salesforce currently documents Agentforce Vibes as the only supported client)
- Headless 360 (Beta; includes Archive Connect operations)

### Data Cloud

- Data 360

### Tableau

- Tableau MCP (**SF Pi Alpha**; Tableau marks the standalone server Tableau Supported but does not publish a GA/Beta label)
- Tableau Next
- CRM Analytics (Beta)

### Marketing Cloud

- Marketing Cloud Engagement

### MuleSoft

- MuleSoft DX

### Agentforce

- Agentforce Sales (**SF Pi Alpha**; Salesforce documents the Beta sandbox endpoint for ChatGPT, while generic Pi interoperability and the exact tools remain undocumented)

### Custom

- Custom Salesforce MCP quarantine entry

### Trailhead

- Trailhead MCP (**SF Pi Alpha**; the official page doesn't publish a GA/Beta label)

## Official Sources

- [Pi MCP configuration and exposure](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
- [Salesforce DX MCP setup](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-mcp-server.html)
- [Salesforce DX core tool reference](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-mcp-use-core-tools.html)
- [Salesforce Hosted MCP standard servers](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/servers-reference.html)
- [Tableau MCP](https://tableau.github.io/tableau-mcp/)
- [Tableau Next MCP](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/tableau-next.html)
- [Trailhead MCP](https://trailhead.salesforce.com/support/mcp)
- [Marketing Cloud Engagement MCP tool reference](https://developer.salesforce.com/docs/marketing/mce-mcp/references/mce-mcp-tools/mce-mcp-tools.html)
- [MuleSoft DX MCP tool reference](https://docs.mulesoft.com/mulesoft-mcp-server/reference-mcp-tools)
- [Agentforce Sales ChatGPT sandbox setup](https://help.salesforce.com/s/articleView?id=sales.test_sales_chatgpt_sandbox.htm&type=5)

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
