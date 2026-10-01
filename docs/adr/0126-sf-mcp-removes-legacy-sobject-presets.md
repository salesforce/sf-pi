---
id: "0126"
status: accepted
date: 2026-10-01
supersedes: ["0125"]
---

# ADR 0126: SF MCP Removes Legacy SObject Presets

SF MCP removes the SObject Reads, SObject Mutations, SObject Deletes, and
SObject All presets from its catalog and management surface. The overlapping
choices created avoidable routing and setup ambiguity next to the native SF SOQL
lifecycle and the broader Headless 360 server.

This is an SF Pi product simplification. Current Salesforce documentation still
lists the underlying standard servers, so SF Pi does not claim that Salesforce
has deprecated or retired their public endpoints.

Upgrading SF Pi never deletes or rewrites existing Pi `mcp.json` entries. Users
with a previously configured SObject server continue to manage it through Pi's
native `/mcp` surface and can disable or remove it there. SF MCP no longer
creates, adopts, repairs, versions, verifies, or displays those entries.

The `sf_mcp_verify_target` tool and its in-process attestation store are removed
because they existed only for SObject mutation presets. SF Guardrail retains
legacy SObject tool recognition so a manually retained mutation endpoint cannot
silently bypass Known-Surface Mediation. Without an SF MCP-owned exact identity
workflow, legacy record writes and deletes fail closed.

Headless 360 remains a separate Beta preset with its documented discover,
describe, dispatch, and read-only dispatch contract. Removing the focused
SObject presets does not broaden Headless 360 permissions or infer that its
operation corpus is identical to those servers.
