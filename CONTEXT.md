# SF Pi

SF Pi is the bundled Salesforce-focused extension suite for pi. It gives agents workflow-oriented tools, command surfaces, safety mediation, and compact evidence artifacts for Salesforce development and operations.

## Language

**Apex Lifecycle Extension**:
A bundled SF Pi extension that owns the Apex author → diagnose → trace/log → run/probe → test → fix loop while leaving source edits to normal Pi file tools.
_Avoid_: Apex IDE, code generator, debugger suite

**Apex Lifecycle Loop**:
The agentic Apex development cycle coordinated by an **Apex Lifecycle Extension**: plan the change, edit files, diagnose locally, observe runtime behavior, run targeted tests, and repeat until verified.
_Avoid_: test runner only, log viewer only

**Diagnostics Handoff**:
A temporary ownership transition where a lifecycle-specific extension takes over diagnostics for its domain while the older shared diagnostics extension yields that domain when both are enabled.
_Avoid_: duplicate diagnostics, immediate deprecation

**Apex Run**:
One API-native `sf_apex` tool action in the Apex lifecycle, such as diagnosing a file, starting trace, fetching a log, running Anonymous Apex, or running targeted tests.
_Avoid_: Apex CLI wrapper, shell command

**Apex Discovery Action**:
A bounded API-native `sf_apex` action that finds Apex lifecycle targets, such as active classes, test classes, candidate test methods, coverage records, or org Apex readiness. It exists to keep agents inside the **Apex Lifecycle Loop** instead of dropping to generic Salesforce CLI discovery.
_Avoid_: SOQL explorer, metadata browser, CLI pre-step

**Managed Apex LSP**:
A lazy, reused Apex language-server process owned by an **Apex Lifecycle Extension** for local Apex diagnostics; it is not a per-action Salesforce CLI subprocess.
_Avoid_: CLI fallback, startup LSP probe

**Apex Trace Session**:
A temporary, SF Pi-managed Tooling API trace setup for one user, one log type, and a bounded expiration window used to capture Apex runtime evidence.
_Avoid_: permanent trace flag, all-org tracing

**Apex Log Watch**:
A bounded, API-native observation window that waits for new Apex logs under an **Apex Trace Session**, persists them as **Apex Artifacts**, and analyzes their high-signal evidence.
_Avoid_: CLI tail wrapper, unbounded log stream

**Apex Log Timeline**:
A human-readable sequence of high-signal events extracted from an Apex debug log, such as start, debug markers, exceptions, fatal errors, and completion. It explains what happened inside the execution; it is different from an **Apex Trace Session**, which only controls log capture.
_Avoid_: trace flag summary, raw log dump

**Anonymous Apex Probe**:
An explicit **Apex Run** that executes a bounded Anonymous Apex snippet to verify behavior, capture runtime evidence, and preserve the result as **Apex Artifacts** while respecting mutation guardrails.
_Avoid_: unguarded script execution, CLI exec wrapper, permanent org change

**Apex Artifact**:
Persisted evidence from an **Apex Run**, such as a raw debug log, parsed log digest, Anonymous Apex body/result, or native test result.
_Avoid_: terminal output, scratch dump

**Apex Run Digest**:
A normalized structured summary of an **Apex Run** that carries status, action, org, scope, evidence, signals, and next-step guidance for both LLM context and **Apex Result Card** rendering.
_Avoid_: action-specific JSON blob, renderer-only text, fallback state machine

**Apex Result Card**:
The human-facing structured render of an **Apex Run**, optimized for quick diagnosis with clear status, scope, signals, and a compact **Apex API Call Rail** while pointing to **Apex Artifacts** for full evidence.
_Avoid_: raw JSON, full log in chat, plain text summary

**Apex API Call Rail**:
A compact, human-facing rail directly under an **Apex Result Card** title that lists the native API endpoints and high-signal payload parameters used by an **Apex Run**. It shows enough of composite operations to explain what happened, usually capped around five or six lines, while full raw payloads stay in structured details/artifacts.
_Avoid_: generic transport label, full request dump, hidden native calls

**Targeted Apex Test Run**:
A native Apex test execution scoped to explicitly named test classes or methods, with polling, failure digestion, rerun support, and **Apex Artifacts**.
_Avoid_: test explorer, org-wide dashboard, suite manager

**Apex Coverage Evidence**:
Read-only coverage data gathered by an **Apex Lifecycle Extension** to explain target and org-wide Apex coverage after tests or during planning. It is summarized in an **Apex Result Card** and persisted as **Apex Artifacts**; it is not a CI gate, dashboard, or deployment policy engine.
_Avoid_: coverage dashboard, deployment gate, CI policy engine

**SOQL Lifecycle Extension**:
A bundled SF Pi extension that owns the schema-aware SOQL query lifecycle: discover object shape, validate fields and relationships, explain selectivity, run bounded read-only queries, summarize results, persist artifacts, and help agents iterate. It does not own record CRUD, bulk data operations, report building, or Data Cloud SQL.
_Avoid_: SOQL explorer, record browser, data export tool, report builder, CLI wrapper

**SOQL Query Loop**:
The agentic SOQL workflow coordinated by a **SOQL Lifecycle Extension**: describe schema, validate query shape, explain selectivity when useful, run bounded samples or counts, summarize readable results, persist evidence, and iterate.
_Avoid_: raw data query, ad hoc CLI query, data browsing session

**SOQL Run**:
One API-native `sf_soql` tool action in the **SOQL Query Loop**, such as describing schema, validating a query, retrieving a query plan, running a bounded sample, counting rows, or executing an explicit query.
_Avoid_: SOQL CLI wrapper, data export job, record operation

**SOQL Run Digest**:
A normalized structured summary of a **SOQL Run** that carries status, org, query shape, validation findings, query plan signals, bounded result samples, API calls, and artifacts for both LLM context and **SOQL Result Card** rendering.
_Avoid_: raw query response, action-specific JSON blob, table-only output

**SOQL Result Card**:
The human-facing structured render of a **SOQL Run**, optimized for safe query iteration with clear status, scope, validation findings, selectivity signals, compact sample rows, and a **SOQL API Call Rail** while pointing to **SOQL Artifacts** for full evidence.
_Avoid_: raw JSON, full result dump in chat, output-channel table

**SOQL API Call Rail**:
A compact, human-facing rail directly under a **SOQL Result Card** title that lists the native REST or Tooling API endpoints and high-signal request parameters used by a **SOQL Run**.
_Avoid_: generic transport label, hidden query endpoint, full request dump

**SOQL Artifact**:
Persisted evidence from a **SOQL Run**, such as the normalized query, raw result JSON, flattened result JSON, flattened CSV, query plan, schema describe response, or summary digest.
_Avoid_: context dump, temporary table output, bulk export product

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
A command-scoped **Dynamic Herdr Lane** created as a split pane from the current agent/orchestrator pane for one job and discarded after successful completion. Ephemeral lanes are always fresh: they are not reused for later jobs; failures and timeouts are summarized, left open for inspection, and closed only after a user cleanup decision.
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
A suffixed Herdr pane alias for a **Fresh Ephemeral Lane**, chosen from a **Base Lane Alias** plus a short unique suffix that has not already been used in the session. For example, `apex_tests_k7f3` is a fresh alias derived from `apex_tests`.
_Avoid_: stable ephemeral alias, reused alias, recycled numeric suffix, persisted counter

## Example dialogue

Dev: "Run `data360_observe stdm.find_sessions` and show me what happened."
Agent: "That created a **Data 360 Run**. I will return a **Data 360 Run Digest** in context, render a **Data 360 Result Card** for the human, and save the raw SQL/JSON as **Data 360 Artifacts**."

Dev: "Run the tests in Herdr, but don't reuse an old pane."
Agent: "I will plan a **Fresh Ephemeral Lane** for this command-scoped job. If it succeeds, I will clean up the lane; if it fails or times out, I will leave it available for inspection."
