---
id: "0123"
status: accepted
date: 2026-09-30
---

# ADR 0123: Pi 0.99.1 Runtime Floor and Native Ownership

SF Pi raises both the **Pi Runtime Floor** and **Pi Runtime Audit Edge** to exact
Pi `0.99.1`. Stable releases below `0.99.1`, prereleases, and Pi 1.x or later
are blocked with bounded repair guidance. Stable releases from `0.100.0`
through the pre-1.0 hard ceiling continue to load in forward-compatibility mode
under ADR 0079.

This is a clean runtime cut rather than a compatibility-shim release. SF Pi uses
Pi 0.99.1's native tool-execution context, Pi AI chat `Model` and complete
`Provider` Interfaces, and built-in MCP ownership. Required CI no longer covers
Pi 0.87.x. Development dependencies, the repair recommendation, package peer
floor, and exact required compatibility lane move together.

SF LLM Gateway keeps its existing authentication, discovery, catalog admission,
three transport APIs, payload policies, retry behavior, compaction, and usage
contracts. Its discovery catalog now uses Pi AI's native chat `Model` Interface
rather than the coding-agent `ProviderModelConfig` union. This removes a
configuration-layer dependency and type cast without changing Gateway runtime
behavior.

Pi's built-in MCP extension owns MCP configuration, connections, OAuth,
exposure, codemode, tool search, and readiness. SF Pi removes its recommendation
and private status-event dependency on `pi-mcp-adapter`; SF Skills no longer
implements a parallel MCP readiness Module. Independently installed MCP
extensions remain user-owned and may replace Pi's built-in MCP support according
to Pi's extension rules.

Tool tests use the native `ExtensionToolContext` Interface. Future SF Pi
orchestrators that need to invoke another registered tool use
`ctx.executeTool()` so validation, lifecycle events, cancellation, usage,
nested-call identity, and Guardrail mediation remain Pi-owned. Ordinary family
tools keep direct ownership of their implementation.

Behavior Proofs include exact Pi 0.99.1 type checking, full tests,
Manifest Runtime Surface Attestation, every SF LLM Gateway test, clean-home CLI
package loading, Pi-native MCP availability, and focused proof that SF Skills
emits no adapter-specific readiness row.
