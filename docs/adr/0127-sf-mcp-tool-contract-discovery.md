---
id: "0127"
status: accepted
date: 2026-10-01
---

# ADR 0127: SF MCP Tool Contract Discovery

SF MCP opens every preset with a non-mutating overview before offering connection
setup or configuration changes. The overview presents the preset's capabilities,
support maturity, risk, active SF Pi overlaps, official documentation, and tool
contract. Selecting a preset no longer advances directly into setup or conflict
resolution.

Governed Salesforce Hosted MCP presets carry concise, versioned tool summaries
sourced from the official documentation URL already declared by the preset. A
summary records the exact approved tool name, one short description, a human
capability group, and a conservative risk classification. Package-defined,
permission-scoped, and custom servers whose exact contract is not stable in the
local preset show reviewed server capabilities and explicitly state that exact
tools require a live connection.

Once Pi observes a connected MCP server, SF MCP captures a bounded session-local
view of the tool name, description, parameter schema, effective exposure, and MCP
annotations returned by `pi.getAllTools()`. The detail page labels observed data
separately from the documented contract. Runtime descriptions take precedence
for display because they describe the connected server, while the documented
contract continues to determine whether a tool is approved. Runtime metadata is
never persisted.

Observed tools absent from the approved contract remain visible as unapproved
and inherit the server's hidden exposure. Documented tools absent from the live
contract remain visible as not observed. This extends the existing drift model;
it does not approve new tools or change any exposure policy.

Pi remains authoritative for transport, OAuth, connection state, and native MCP
execution. Phase 1 adds discovery pages only. The existing conflict review,
setup, adoption, reset, redacted diff, atomic write, reload, and Guardrail
contracts remain unchanged and require an explicit Configure action.
