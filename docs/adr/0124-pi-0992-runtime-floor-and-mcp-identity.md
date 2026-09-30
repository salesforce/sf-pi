---
id: "0124"
status: accepted
date: 2026-09-30
supersedes: ["0123"]
---

# ADR 0124: Pi 0.99.2 Runtime Floor and MCP Identity

SF Pi raises both the **Pi Runtime Floor** and **Pi Runtime Audit Edge** to exact
Pi `0.99.2`. Stable releases below `0.99.2`, prereleases, and Pi 1.x or later
are blocked with bounded repair guidance. Stable releases from `0.99.3` through
the pre-1.0 hard ceiling load in forward-compatibility mode under ADR 0079.
The exact required-CI audit range is therefore `>=0.99.2 <0.99.3`; a future
patch release never becomes audited merely because it shares the same minor
version.

This remains a clean runtime cut rather than a compatibility-shim release.
Development dependencies, the repair recommendation, package peer floor,
required compatibility lane, documentation, and runtime gate move together.

Pi 0.99.2 canonicalizes MCP server names by replacing hyphens with underscores
in runtime tool namespaces. SF Guardrail canonicalizes the runtime identity and
matches it to the original `mcp.json` key before classifying an **MCP Tool Safety
Subject**. Ambiguous canonical matches fail closed as an unknown target. Focused
Behavior Proofs cover Salesforce record writes and deletes, Data 360 execution,
Salesforce DX mutations, external operations, and hosted sandbox target
resolution through Pi 0.99.2-shaped tool names.

SF MCP uses Pi's exported `McpServerConfig` and `McpExposure` Interfaces instead
of maintaining a local copy. Managed presets use the canonical `codemode`
exposure and publish their existing short descriptions to Pi for the
`mcp_servers` prompt section, tool-search ranking, and `describeNamespace()`.
SF MCP retains its atomic file mutation, conflict planning, ownership
fingerprints, and no-overwrite behavior because those remain Salesforce-specific
leverage rather than Pi runtime duplication.

SF Pi inherits Pi 0.99.2's background connection behavior for non-direct MCP
servers, stable codemode descriptions, provider-model startup fix, strict-schema
fallback, retry correction, codemode validation and rendering fixes, and
`defaultTools` reload behavior. Anthropic workload identity federation remains
Pi-owned. This adoption adds no virtual-model router, classifier-based safety or
routing, blanket deferred tool exposure, or automatic user-tool setting change.

Behavior Proofs include exact Pi 0.99.2 type checking, full tests, Manifest
Runtime Surface Attestation, every SF LLM Gateway test, SF MCP focused tests,
clean-home CLI package loading, Pi-native MCP availability, and the normalized
MCP identity regressions above.
