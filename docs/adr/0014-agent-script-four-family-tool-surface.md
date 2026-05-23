# Agent Script Public Tool Surface Uses Four Family Tools

## Status

Accepted

## Context

`sf-agentscript` originally exposed seven public LLM tools: four local authoring tools plus preview, eval, and lifecycle tools. The authoring tools were clear individually, but the full surface increased prompt/tool-list payload and spread orchestration guidance across multiple tool descriptions. Because the Agent Script surface is still alpha, backward compatibility for the initial authoring tool names is less important than a clean, agent-first public API.

## Decision

`sf-agentscript` exposes four family-level tools: `agentscript_authoring`, `agentscript_preview`, `agentscript_eval`, and `agentscript_lifecycle`. `agentscript_authoring` owns the local create/compile/inspect/mutate loop using `verb` + `mode`; the other families keep their existing `action` discriminator. The old public authoring tools (`agentscript_compile`, `agentscript_create`, `agentscript_inspect`, and `agentscript_mutate`) are removed rather than kept as compatibility wrappers.

## Consequences

- The model sees a smaller, workflow-oriented Agent Script tool surface without collapsing everything into one oversized mega-tool schema.
- Authoring guidance can be centralized around the loop: compile/check, inspect, mutate/create, then preview/eval/lifecycle.
- Existing docs, skills, tests, and manifest tool lists must be rewritten to the new surface; old public authoring names should not remain in user-facing examples.
- The implementation should delete dead compatibility code and use red-green TDD vertical slices to regain behavior coverage through the new public interface.
