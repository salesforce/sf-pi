---
id: "0137"
status: accepted
date: 2026-10-04
---

# ADR 0137: SF MCP Separates Connection and Tool Access

SF MCP separates connection and authentication from tool exposure. The Manager
preset overview now routes to distinct Connection & Authentication, Tool Access,
Tool Conflict Review, and Tool Details pages. New reviewed connections are saved
with a Quarantine tool policy, and changing connection fields preserves the
existing reviewed policy on unchanged managed entries. Conflict rows remain
compact in the Tool Access page; complete ownership and recommendation detail
lives in the dedicated review page.

The agent-facing `sf_mcp` tool follows the same model. `connection.plan` and
`connection.apply` own transport, endpoint, environment, and OAuth fields.
`tools.plan` and `tools.apply` own reviewed profiles and exact tool-name exposure
overrides. Both lifecycles remain session-bound, source-bound, diff-reviewed,
and Guardrail-mediated. The former `configure.plan` and `configure.apply`
actions remain as a combined compatibility workflow.

The SF Pi Manager settings-panel protocol also gains an optional active-row
anchor. Keyboard navigation in a long interactive panel asks the Manager to keep
the selected rendered row visible, while explicit PageUp, PageDown, Home, and
End navigation temporarily controls the viewport. This fixes catalog entries
being selectable below the visible region without weakening generic long-page
scrolling.

SF MCP adds these product families:

- Slack MCP uses Slack's fixed Streamable HTTP endpoint and a registered Slack
  OAuth client. Its client secret remains an environment reference. Slack
  publishes the capability surface but not a stable exact tool-name contract,
  so the server starts Hidden and observed tools remain quarantined.
- Informatica Catalog Discovery and Informatica Data Exploration use
  pod-specific HTTPS endpoints and IDMC Public OAuth 2.1 clients. Their public
  setup guidance does not publish stable exact tool-name contracts, so they also
  start Hidden and remain quarantined.
- B2C Commerce uses the GA `@salesforce/b2c-dx-mcp` stdio package. Its open
  contract is reviewed and versioned in SF MCP, so exact per-tool profiles are
  available immediately while the server default remains Hidden.

This design keeps product discovery broad without treating runtime observation
as approval. A product can be connected before its exact contract is reviewed,
but no unknown tool becomes callable merely because a server advertised it.

Official sources:

- Slack MCP server:
  https://docs.slack.dev/ai/slack-mcp-server
- Informatica connector and OAuth setup:
  https://www.informatica.com/blogs/powering-your-enterprise-ai-with-informatica-plugin-for-claude.html
- B2C Commerce MCP:
  https://salesforcecommercecloud.github.io/b2c-developer-tooling/mcp/
