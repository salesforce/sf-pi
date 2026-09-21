---
id: "0119"
status: accepted
date: "2026-09-21"
supersedes: ["0118"]
---

# ADR 0119: Pi 0.87 Runtime Floor and Actionable Settlement

SF Pi raises its **Pi Runtime Floor** and **Pi Runtime Audit Edge** to exact
Pi `0.87.0`. Stable runtimes below `0.87.0`, prereleases, and Pi 1.x or later
are blocked with bounded repair guidance. Stable releases from `0.88.0` through
the pre-1.0 hard ceiling continue to load in forward-compatibility mode under
ADR 0079.

Pi 0.87 adds actionable `turn_end` and `agent_before_settle` extension
boundaries. SF Agent Script and SF Code Analyzer adopt `agent_before_settle` for
quality repair because it runs after automatic retry, recovery compaction, and
queued user work have finished while still allowing one structural repair entry
and one native continuation. Clean results remain Human-Only Transcript Rows,
new actionable findings preserve prior boundary drafts and request one
continuation, and unchanged finding signatures stop the repair loop. The
notification-only `agent_settled` event remains the correct seam for SF Pi
Manager Auto Update and SF Flow presentation cleanup.

The runtime-floor change is intentional: SF Pi keeps no pre-0.87 lifecycle shim
and no parallel `agent_settled` quality path. Package metadata, lockfile, runtime
gate, install guidance, manifests, generated catalog, and required exact-version
CI move together.

SF Pi inherits Pi-owned canonical session context, recovery omissions, context
accounting, context-filter prompt/tool restoration, and per-model image
preprocessing. Broad adoption of `ContextEditEntry` is deferred because current
mutable Salesforce context is computed during `before_agent_start`, whose
public result cannot append a context-edit draft alongside the new message.
SF Pi also does not adopt `context_with_system`; raw prompt/tool transcript
rewriting would widen its interface without a current Salesforce workflow need.

Behavior Proofs require exact Pi 0.87 type checking, the full suite, runtime
surface attestation, offline runtime loading, and focused actionable-settlement
coverage for prior-draft preservation, one continuation, human-only clean
results, and repeated-signature termination.
