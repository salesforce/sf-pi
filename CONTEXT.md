# SF Pi

SF Pi is the bundled Salesforce-focused extension suite for pi. It gives agents workflow-oriented tools, command surfaces, safety mediation, and compact evidence artifacts for Salesforce development and operations.

## Language

**Data 360 Run**:
One invocation of a `data360_*` tool action, including local catalog actions, dry runs, readiness probes, runbooks, journeys, raw REST calls, and OTel exports.
_Avoid_: Data 360 trace, Data 360 action

**Data 360 Run Digest**:
A compact typed record of a **Data 360 Run**, optimized for LLM context and human traceability while pointing to full artifacts for deep inspection.
_Avoid_: execution trace, action report, raw response summary

**Data 360 Result Card**:
The human-facing render target derived from a **Data 360 Run Digest**.
_Avoid_: generic JSON summary

**Data 360 Artifact**:
Persisted raw or expanded evidence produced by a **Data 360 Run**, such as raw JSON, SQL, Markdown, CSV, or trace export files.
_Avoid_: dump, temp output

**Dynamic Herdr Lane**:
A Salesforce workflow lane planned by SF Pi for Herdr-backed work such as tests, logs, previews, evals, deploy checks, servers, or reviewers. A lane has an explicit lifecycle: **Fresh Ephemeral Lane**, sticky lane, or manual lane.
_Avoid_: generic pane, terminal slot

**Fresh Ephemeral Lane**:
A command-scoped **Dynamic Herdr Lane** created as a split pane for one job and discarded after successful completion. Ephemeral lanes are always fresh: they are not reused for later jobs; failures and timeouts are summarized, left open for inspection, and closed only after a user cleanup decision.
_Avoid_: reused lane, permanent pane, sticky lane, ephemeral tab

**Sticky Lane**:
A **Dynamic Herdr Lane** kept open for a long-running job that is expected to be reused, such as a development server. It is still created only when the job is ready to start.
_Avoid_: pre-opened lane, background default

**Manual Lane**:
A **Dynamic Herdr Lane** that stays open until the user explicitly closes it, such as a reviewer or agent pane.
_Avoid_: auto-cleaned pane, ephemeral lane

**Workflow Success Condition**:
The explicit signal that a workflow completed successfully, such as passing tests, a successful validation result, an observed log marker, or a completed eval. It is stronger than merely starting a command or seeing generic output.
_Avoid_: command started, generic done message

**Herdr Action Hint**:
A non-executable recommendation in a **Herdr Lane Plan** that names an upstream Herdr action and safe parameter guidance. It guides the agent without generating shell commands or mutating panes by itself.
_Avoid_: generated command, hidden automation, workflow executor

**Herdr Workflow Handoff**:
A cross-extension hint that points an agent to a Herdr lane plan for a workflow. It carries plan intent and workflow context, but not shell commands or pane mutations.
_Avoid_: suggested command, pane handoff, workflow executor

**Proactive Herdr Guidance**:
SF Brain prompt guidance that nudges agents to use Herdr lanes when the upstream Herdr tool is active. It is separate from explicit SF Herdr lane planning, which remains available when requested.
_Avoid_: planner mode, Herdr workflow mode

**Base Lane Alias**:
The stable alias name stored in SF Herdr preferences and used as the root for lane naming. For sticky and manual lanes it can be the actual pane alias; for **Fresh Ephemeral Lanes** it is only the root used to choose a **Fresh Lane Alias**.
_Avoid_: resolved alias, target pane alias

**Fresh Lane Alias**:
A suffixed Herdr pane alias for a **Fresh Ephemeral Lane**, chosen from a **Base Lane Alias** and the lowest unused numeric suffix after inspecting current panes. For example, `apex_tests_1` and `apex_tests_2` are fresh aliases derived from `apex_tests`.
_Avoid_: stable ephemeral alias, reused alias, persisted counter

## Example dialogue

Dev: "Run `data360_observe stdm.find_sessions` and show me what happened."
Agent: "That created a **Data 360 Run**. I will return a **Data 360 Run Digest** in context, render a **Data 360 Result Card** for the human, and save the raw SQL/JSON as **Data 360 Artifacts**."

Dev: "Run the tests in Herdr, but don't reuse an old pane."
Agent: "I will plan a **Fresh Ephemeral Lane** for this command-scoped job. If it succeeds, I will clean up the lane; if it fails or times out, I will leave it available for inspection."
