---
id: "0129"
status: accepted
date: 2026-10-01
---

# ADR 0129: SF MCP Exact Conflict and Drift Governance

SF MCP extends preset-level overlap detection with reviewed mappings from exact
MCP tools to enabled SF Pi capability owners. Each mapping records the tool,
human capability, direct or partial relationship, owner set, rationale, broad
meta-tool status, and recommended exposure. The mapping is active only when the
preset's existing conflict plan reports that owner as enabled.

The Recommended profile from ADR 0128 is now conflict-aware. Headless 360 keeps
`discover` and `describe` in Code Mode, hides broad `dispatch`, and makes
`dispatch_readonly` Deferred when the relevant native owners are enabled. Data
360 keeps `search` and `payload_examples` in Code Mode while hiding broad
`execute` when the typed SF Data 360 families are enabled. Keep-both remains an
explicit choice that exposes the complete reviewed contract through Code Mode.

A broad meta-tool warning is mandatory when one MCP tool dispatches multiple
internal operations. Tool exposure governs the dispatcher only; SF MCP does not
claim that Pi can independently allow selected operations behind Headless 360
`dispatch` or Data 360 `execute`. Salesforce permissions, the server's access
controls, Pi's tool pipeline, and SF Guardrail continue to mediate execution.

Conflict choices modify only MCP exposure. SF MCP never disables an SF Pi
extension. Compact side-by-side routing guidance names only owners whose mapped
conflicting MCP tools remain non-hidden, rather than repeating every server-level
overlap.

SF MCP also adds an explicit observed-contract drift workflow. A live tool absent
from the reviewed contract is shown as added and locked hidden. Runtime
observation never promotes it; approval requires a code-reviewed preset revision.
A documented tool absent from the live contract is shown as removed and
unavailable. For an unchanged managed entry, repair reconstructs the current
custom policy, forces removed tools to Hidden, and presents the exact native diff
before applying it. An outdated preset routes to the existing reviewed reset
workflow.

The repair does not erase documented tools from the local contract because a
missing tool can reflect server version, entitlement, or rollout state. Keeping
an explicit Hidden entry preserves fail-closed behavior if the tool returns. The
session continues to report drift until the server contract matches a reviewed
preset revision. No drift acknowledgment, runtime approval ledger, or duplicate
policy store is introduced.
