# Agent Script Uses Branch-Durable Tool State for Workflow Pointers

## Status

Accepted

## Context

`sf-agentscript` writes durable preview, eval, trace, and report artifacts to disk, but agents still have to carry transient identifiers such as preview `agent_name`/`session_id` and eval `run_id` between tool calls. Scanning disk for the latest artifact is not branch-aware, and selecting the newest candidate can silently route live-org actions to the wrong session or agent.

## Decision

`sf-agentscript` tool results may include a namespaced `sf_agentscript_branch_state` array of small schema-versioned events in `details`. These events store pointer-sized workflow facts, such as the current `.agent` file, active preview session, latest preview turn, generated eval spec, eval run, or lifecycle version. Tools reconstruct state only from successful tool results on the current Pi branch, validate any inferred disk artifact before using it, and refuse with structured candidates when resolution is ambiguous. Existing disk artifacts remain the source of truth for heavy data such as traces, transcripts, raw eval responses, failure records, and reports.

## Consequences

- The pilot stays local to `sf-agentscript`; a generic `lib/common` helper is deferred until another extension needs the same pattern.
- Omitted parameters can be resolved only for low-surprise continuity flows: current `.agent` path, preview session continuation, and eval spec/run continuation. Lifecycle activation/deactivation and broad cleanup operations remain explicit.
- The model gets better ergonomics without losing branch safety: cardinality `1` auto-resolves, cardinality `0` asks for explicit input, and cardinality `>1` refuses instead of choosing the newest candidate.
