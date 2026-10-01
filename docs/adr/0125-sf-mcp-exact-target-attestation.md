---
id: "0125"
status: accepted
date: 2026-10-01
---

# ADR 0125: SF MCP Exact Target Attestation

Salesforce Hosted MCP endpoint paths prove only an environment family. They do
not prove that the org selected during MCP OAuth matches the Salesforce CLI org
that SF Pi uses for target-aware safety decisions. Treating a sandbox endpoint
as exact identity would allow an OAuth account switch to bypass the intended
org comparison.

SF MCP therefore registers one read-only tool, `sf_mcp_verify_target`, for
SObject mutation, delete, and all servers. The tool executes this bounded query
through the same authenticated MCP connection by using Pi's nested-tool
pipeline:

```sql
SELECT Id, IsSandbox FROM Organization LIMIT 1
```

It resolves an explicit Salesforce CLI target through the shared Salesforce
Connection Module and compares the organization IDs and sandbox classification.
A successful match records no OAuth token and no record data. It creates one
short-lived, in-memory attestation bound to:

- the current Pi session;
- the canonical MCP server name;
- the native MCP configuration fingerprint;
- the exact next mutation tool.

The next matching call consumes the attestation. Mismatch, expiry, a different
tool, a configuration change, or another session fails closed. Verification is
identity evidence rather than approval: SF Guardrail still blocks production
writes and still requires Human-in-the-Loop Approval for an attested sandbox
write.

Hosted mutation servers without a tool that can return an exact organization
fingerprint remain blocked. SF Pi does not inspect Pi's MCP OAuth credential
store, persist target attestations, infer identity from usernames, or start a
second MCP client. Pi remains the owner of transport, OAuth, connection state,
and nested tool execution.

This decision adds a small shared in-process attestation store because SF MCP
produces the evidence and SF Guardrail consumes it. The store is deliberately
one-use and non-persistent; it is not an approval ledger or trust registry.
Focused Behavior Proofs cover match, mismatch, expiry, configuration and tool
binding, sandbox confirmation, and production or missing-evidence blocking.
