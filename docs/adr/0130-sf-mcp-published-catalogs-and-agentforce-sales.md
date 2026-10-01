---
id: "0130"
status: accepted
date: 2026-10-01
---

# ADR 0130: SF MCP Published Catalogs and Agentforce Sales

SF MCP replaces capability-only placeholders for Salesforce DX, Marketing Cloud
Engagement, and MuleSoft DX with reviewed tool contracts from their public
references. Their generated native entries now use hidden server exposure and
exact per-tool Code Mode defaults, so later server additions remain unreachable
until reviewed.

The Salesforce DX contract includes the nine GA tools in the toolsets SF MCP
actually configures: always-on core plus `orgs`, `metadata`, `data`, `users`, and
`testing`. The four documented NON-GA org tools remain absent because SF MCP does
not pass `--allow-non-ga-tools`. The complementary DX resolution omits the SOQL
and test tools together with their disabled `data` and `testing` toolsets.

Marketing Cloud Engagement includes the tools published across Automations,
Campaigns, Contacts, Content, Data Extensions, Email, Journeys, Push, SMS,
Tracking, and Utilities. Permission scopes can cause the connected server to
advertise a subset; the existing drift workflow marks missing documented tools
unavailable. MuleSoft DX includes the official command-summary catalog. Tools
that are Anypoint Code Builder-only or Connector Builder-only remain documented
but become unavailable when the generic connected server does not advertise
them. The three preset revisions increase so existing managed configurations
must review the new allowlist before reset.

SF MCP also adds the Agentforce Sales ChatGPT sandbox Beta endpoint as an SF Pi
Alpha preset. Salesforce documents the sandbox URL, required OAuth scopes,
confidential External Client App setup, and ChatGPT-specific workflow, but does
not publish an exact MCP tool reference or generic Pi-client support. SF MCP
therefore publishes capabilities only, uses the fixed documented sandbox
endpoint, references `AGENTFORCE_SALES_CLIENT_SECRET` from the environment, and
labels generic-client interoperability as experimental. It does not infer a
production endpoint or reviewed tool allowlist.

Because the Agentforce Sales surface can both read and mutate CRM data while its
exact tool names and authenticated org identity remain unverified, SF Guardrail
classifies every operation as a hosted Agentforce Sales operation and fails
closed. Adding the catalog entry is discovery and experimental configuration
support, not evidence of successful live interoperability or permission to
bypass exact-target safety.

The tool exposure editor now renders available metadata and the selected
Hidden, Code Mode, Deferred, or Direct state with text or accent contrast rather
than muted text. Muted color remains reserved for explanatory help. Width-safe
Behavior Proofs continue to cover the Manager minimum width.

Official source contracts:

- Salesforce DX core tools:
  https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-mcp-use-core-tools.html
- Marketing Cloud Engagement tools:
  https://developer.salesforce.com/docs/marketing/mce-mcp/references/mce-mcp-tools/mce-mcp-tools.html
- MuleSoft DX tools:
  https://docs.mulesoft.com/mulesoft-mcp-server/reference-mcp-tools
- Agentforce Sales ChatGPT sandbox setup:
  https://help.salesforce.com/s/articleView?id=sales.test_sales_chatgpt_sandbox.htm&type=5
