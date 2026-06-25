# ADR 0068: Fresh Ephemeral Herdr Lanes

## Status

Accepted

## Context

ADR 0016 established Dynamic Herdr Lane planning with a reuse-friendly posture: agents could reuse existing panes, split panes, or tabs depending on placement. In practice, reuse makes command-scoped agent workflows harder to reason about because old pane state can contaminate new jobs and successful cleanup becomes ambiguous.

## Decision

SF Herdr treats ephemeral lanes as **Fresh Ephemeral Lanes**: command-scoped split panes created just in time for one job. Normal command-scoped jobs split from the current agent/orchestrator pane by omitting the `pane` parameter to upstream `herdr.pane_split`; agents pass `pane` only when the user asks for a specific source pane or a simultaneous lane must split from a worker pane to protect layout. Existing panes are not reused for ephemeral jobs; `herdr.list` is used to detect live alias collisions, and agents choose a short-id suffixed fresh alias such as `apex_tests_k7f3`. Closed ephemeral aliases are not recycled within the same session, even when `herdr.list` no longer shows them.

A Fresh Ephemeral Lane closes via an explicit visible `herdr.stop` call only after the agent observes the workflow's success condition. On failure, timeout, or ambiguous output, the agent reads recent unwrapped output, summarizes the issue, leaves the lane open for inspection, and asks the user whether to close it.

SF Herdr may return structured, non-executable Herdr Action Hints that name upstream Herdr actions and safe parameter guidance. These hints must not generate shell commands or mutate panes by themselves; actual pane operations remain explicit upstream `herdr` tool calls.

SF Brain owns **Proactive Herdr Guidance** in prompt context. SF Herdr owns explicit lane planning. SF Herdr does not need a separate workflow-mode preference that turns planning "off" while still returning plans.

## Consequences

- Ephemeral lane planning prioritizes isolation and reliable cleanup over reuse.
- Sticky and manual lanes remain available for long-running servers, reviewer panes, or explicit user-directed reuse.
- Fresh ephemeral lanes use split panes because upstream Herdr exposes pane stop/close semantics; tabs and workspaces are reserved for sticky/manual lanes or explicit user request.
- Normal Fresh Ephemeral Lanes split from the current agent/orchestrator pane. Worker-pane source splits are explicit exceptions for user-directed source panes or simultaneous-lane layout protection.
- Old persisted `workflowMode` values in SF Herdr preferences are ignored on read and omitted on the next write; proactive Herdr opt-out remains in SF Brain settings.
- Lane preferences no longer carry an `enabled` flag. If the planner is explicitly asked for a lane, lifecycle and alias settings shape the plan rather than blocking it.
- SF Herdr preferences no longer carry a generic lane style. Split panes are the default lane placement until sticky/manual tab or workspace workflows earn a deeper model.
- SF Herdr preferences no longer carry a preserve-focus flag. Fresh lane action hints use `focus: false`; workflows that require visible interaction can explicitly focus later.
- ADR 0016's hybrid orchestration boundary remains intact: SF Herdr plans, while the upstream `herdr` tool mutates panes visibly.
