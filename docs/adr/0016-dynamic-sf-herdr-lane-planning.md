# ADR 0016: Dynamic SF Herdr Lane Planning

## Status

Accepted

## Context

ADR 0015 introduced Herdr Workflow Mode as conditional SF Brain guidance for
sessions where the upstream `npm:@ogulcancelik/pi-herdr` tool is active. That
first step made Herdr available as an opportunistic pane-orchestration surface
while preserving normal Pi behavior outside Herdr.

Further workflow design showed that Salesforce development does not fit a single
session-wide Herdr mode. A single task can combine Agent Script, Apex, Flow,
Data 360, browser/UI checks, deploy validation, and local tests. Users also want
Herdr panes and tabs to be created and cleaned up dynamically as part of the
agentic flow rather than relying on fixed permanent panes.

The design must satisfy these constraints:

- keep the upstream `herdr` tool as the pane/tab mutation surface;
- avoid hidden extension-driven terminal layout changes;
- let users configure workflow-specific lane preferences;
- infer workflow context from recent activity when possible;
- close successful ephemeral lanes automatically while preserving failure
  context;
- avoid shrinking the main orchestrator pane into a small quadrant through
  stacked splits;
- avoid creating another Salesforce command generator or bypassing
  `sf-guardrail`.

## Decision

Create an experimental **SF Herdr** Bundled Extension that owns Herdr status,
managed preferences, branch-scoped workflow signals, and non-mutating lane
planning. It does not replace the upstream `herdr` tool and does not perform
pane mutations itself.

### Hybrid orchestration

SF Herdr uses **Hybrid Herdr Orchestration**:

- SF Pi owns workflow policies, profiles, status, and non-mutating lane plans.
- Actual pane and tab mutations remain explicit `herdr` tool calls visible in
  the transcript.
- `sf-guardrail` mediates `herdr.run.command` through the same command and
  org-aware gates used for `bash.command`.

This preserves transparency while still enabling agentic auto-split and
auto-cleanup behavior through visible tool calls.

### Dynamic lanes

A **Dynamic Herdr Lane** is an ephemeral, sticky, or manual Herdr pane/tab lane
created during a workflow for a purpose such as tests, logs, preview, eval,
deploy validation, server output, or reviewer work.

Lane lifecycle defaults:

- `ephemeral` lanes are created just in time for the command/tool being run;
- `ephemeral` lanes prefer split panes and close via `herdr.stop` after
  successful watched completion;
- `ephemeral` lanes stay open on failure or timeout only long enough for
  inspection and an explicit cleanup decision;
- `sticky` lanes stay open across the task/session, such as servers, but are
  still opened only when their command is actually needed;
- `manual` lanes never auto-close unless the user asks.

Lane placement must protect the orchestrator pane: agents should not stack
multiple simultaneous splits directly off the main pane or shrink it below
roughly half the tab. If another lane is already open, agents should reuse it,
split from a worker pane, or choose a tab for the second simultaneous lane when
that is less disruptive.

Apex log tails are command-scoped in v1. A tail/log pane should open immediately
before the tail command, watch/read the expected marker, then stop the tail and
close the ephemeral pane on success. Workflow/session inference alone must not
pre-open an Apex log lane.

Because the current upstream `herdr` tool exposes pane close (`stop`) but not an
explicit tab close action, v1 should prefer split panes for ephemeral lanes and
reserve tabs primarily for sticky or manual lanes.

### Workflow profiles

SF Herdr stores **Herdr Workflow Profiles** as SF Pi-managed preferences under
`<globalAgentDir>/sf-pi/herdr/preferences.json`, using the shared
`lib/common/state-store.ts` helper. Profiles are edited through `/sf-herdr` and
its config panel, not positioned as hand-edited Pi settings.

The shared profile store lives under `lib/common/herdr-profile/` so both
`sf-herdr` and `sf-brain` can read it without cross-extension imports.

Profiles have global defaults plus per-workflow overrides for workflow families
such as:

- `generic`
- `apex`
- `agentscript`
- `data360`
- `browser`
- `uiBundle`

Opinionated v1 defaults are allowed because they only shape guidance/plans and
do not create panes by themselves.

### Workflow signals

SF Herdr maintains a branch-scoped in-memory index of **Herdr Workflow Signals**
inferred from recent activity. Signals are reconstructed from the active session
branch on `session_start` and `session_tree`, and updated live from tool
execution/result events.

Examples:

- `agentscript_*` tool calls signal Agent Script work;
- `d360*` tool calls signal Data 360 work;
- `sf_browser_*` tool calls signal browser/UI work;
- writes/edits to `.agent` files signal Agent Script work;
- writes/edits to Apex files signal Apex work;
- `herdr.run` commands such as Apex tests, deploy validation, or local test
  runners contribute relevant workflow signals.

Signals are session/branch context. They are not stored in the global Herdr
preferences file and do not trigger pane mutations by themselves.

### Non-mutating planner tool

SF Herdr registers one non-mutating planning tool, `sf_herdr_plan`. The tool
returns a **Herdr Lane Plan** but does not create, run, watch, read, or close
panes.

A plan maps the requested intent and inferred workflow context to:

- inferred primary workflow and related workflows, with confidence/reason;
- lane id, alias, label, and lifecycle;
- placement recommendation: reuse, split, or tab;
- split direction and focus policy;
- phased guidance: discover/reuse, just-in-time create, run, observe, cleanup;
- cleanup rule: close successful ephemeral panes, preserve failures/timeouts;
- orchestrator-preservation guidance that discourages stacked splits from the
  main pane.

The planner does not generate Salesforce shell commands. The caller supplies the
actual command to `herdr.run`, preserving ownership by the relevant SF Pi
extension or Salesforce skill and keeping `sf-guardrail` in the command path.

## Consequences

- SF Herdr becomes a configurable extension without duplicating the Herdr runtime
  or replacing the upstream `herdr` tool.
- Dynamic auto-split and auto-close behavior is agentic and transparent: the
  plan guides the agent, and every pane mutation remains a visible Herdr tool
  call.
- Mixed Salesforce workflows are supported through activity-derived signals
  rather than a brittle session-wide mode.
- The prompt footprint stays bounded: detailed profiles and lane plans are
  loaded through `sf_herdr_plan` only when needed.
- Ephemeral lane cleanup is safe by default: successful panes close, failures
  remain available for inspection.
- v1 cannot explicitly close tabs unless the upstream Herdr tool adds a
  `tab_close`-style action; therefore ephemeral lanes should prefer split panes.

## Alternatives considered

### Extension-driven automatic pane mutation

Rejected. Automatically splitting or closing panes from extension hooks would be
surprising and hard to review. It could mutate the user's terminal layout based
on inferred intent without visible model tool calls.

### A compound mutating `sf_herdr_workflow` tool

Rejected for v1. A compound tool that performs split/run/watch/read/close would
hide individual pane operations and blur responsibility with the upstream Herdr
tool. It would also complicate guardrail mediation and failure recovery.

### Session-wide workflow mode

Rejected. Salesforce work often mixes Agent Script, Apex, Flow, browser, and
data workflows in one session. Planning must be activity-scoped and signal-aware.

### Command-generating planner

Rejected. SF Herdr should not invent Salesforce commands. Existing SF Pi
extensions, Salesforce skills, and the agent's local reasoning remain
responsible for choosing commands; SF Herdr only plans where and how to run,
observe, and clean up the lane.
