---
id: "0128"
status: accepted
date: 2026-10-01
---

# ADR 0128: SF MCP Reviewed Tool Exposure Policy

SF MCP adds a governed per-tool exposure workflow for presets with a reviewed
tool contract. Users start from one of five deterministic profiles —
Recommended, Read-only, All approved, Custom, or Quarantine — and can assign an
available reviewed tool to Pi's Hidden, Code Mode, Deferred, or Direct exposure.
The Recommended profile preserves the existing approved Code Mode contract in
this phase. Conflict-aware recommendations remain a separate future decision.

Every governed native entry retains `exposure: hidden`. SF MCP writes an exact
`toolExposure` value for every reviewed tool, including explicit `hidden` values.
As a result, a tool added later by the server remains unreachable until a preset
revision reviews it. A session-observed tool absent from the reviewed contract is
visible but locked hidden. When Pi has observed a live contract, a documented
tool absent from that contract is unavailable and also locked hidden.

The Read-only profile exposes only tools whose reviewed contract classifies them
as read operations. Write, destructive, mixed, and unknown-risk tools remain
hidden. Direct exposure is an explicit advanced choice. SF MCP warns whenever a
non-read tool is assigned Direct exposure, but execution still passes through
Salesforce permissions, Pi's tool pipeline, and SF Guardrail.

For a missing server, the selected policy travels through the existing conflict,
connection setup, review, and atomic install workflow. For an unchanged managed
server, SF MCP produces a redacted native configuration diff and updates only the
server and tool exposure fields while preserving endpoint, OAuth client,
timeout, enabled state, and unrelated configuration. Manual, externally modified,
outdated, invalid, or canonically conflicting entries must use the existing
adoption or reset workflow before tool exposure can change.

The effective policy is stored only in Pi's native `mcp.json`. SF MCP continues
to persist a fingerprint, preset revision, and resolution solely for ownership
and drift detection; it does not create a second policy store. Pi remains the
runtime authority for Code Mode, tool search, direct declarations, hidden tools,
and MCP execution.

Presets without a reviewed exact tool contract continue to show their documented
capabilities and live observed tools, but SF MCP does not offer governed per-tool
editing for them. This avoids converting package-defined, permission-scoped, or
custom runtime tools into trusted contracts merely because a server advertised
them.
