# SF Pi

SF Pi is the bundled Salesforce-focused extension suite for pi. It gives agents workflow-oriented tools, command surfaces, safety mediation, and compact evidence artifacts for Salesforce development and operations.

## Language

**Docs Query Distillation**:
The SF Docs behavior of turning locator-like documentation input, such as a Salesforce Help article URL or article ID, into compact meaningful search language before documentation lookup. It keeps the user's intent anchored to official documentation while avoiding brittle literal URL search when the locator already contains better search terms.
_Avoid_: URL canonicalization system, docs crawler, local documentation index, cached search corpus

**Seasonal Release Hint**:
A high-confidence cue extracted during **Docs Query Distillation** from phrases such as `Spring '26`, `Spring 2026`, or a Salesforce Help release parameter. It helps SF Docs prefer the matching Salesforce seasonal release note family without adding a separate release-notes subsystem or changing the public tool API.
_Avoid_: release filter API, release resolver, release notes crawler, docs version

**Release-Note Intent**:
A lightweight cue that the user is looking for Salesforce release-note documentation, such as `release notes`, `what's new`, or a Help article ID under `release-notes.`. It can shape documentation lookup only when paired with stronger context, such as a **Seasonal Release Hint**, a Salesforce Help locator, or explicit release-note wording; plain product release-note queries should remain normal documentation searches.
_Avoid_: release-note mode, release-note resolver, product release override

**Release-Note Evidence**:
Official documentation evidence that satisfies a release-note lookup by matching the requested Salesforce seasonal release and carrying release-note markers such as release-note URL paths, article IDs, filenames, titles, or collection metadata. It prevents current product docs with matching release metadata from being treated as release-note grounding by themselves.
_Avoid_: release-note-shaped result, release-note mode, release page guess, current-doc fallback

**MCP-Native Query Compilation**:
The SF Docs behavior of turning a user's documentation intent into the smallest useful query that uses documented Salesforce Docs MCP retrieval language, such as collection filters, guide boosts, or seasonal release filters, before requesting documents. It improves use of the backing docs service without creating a separate docs search product.
_Avoid_: custom search engine, release-note resolver, local release index, web fallback

**Docs Evidence Gate**:
A lightweight SF Docs check that official documentation results satisfy the user's explicit constraints, such as requested product, locale, or seasonal release, before treating them as sufficient grounding evidence. It should report an evidence gap when the docs service returns only unrelated or wrong-slice documents; for release-note lookups, it distinguishes unavailable collection coverage from documents that merely share current-release metadata but are not **Release-Note Evidence**.
_Avoid_: answer grader, semantic verifier, hidden fallback search, confidence score product

**Docs Capability Summary**:
A balanced SF Docs presentation of the backing documentation service's collection capabilities, showing enough retrieval filters, landmarks, extra fields, and fetch hints for humans and agents to understand why a lookup path was chosen without dumping the full service catalog every time.
_Avoid_: raw MCP catalog dump, hidden retrieval hints, static cheatsheet substitute, verbose schema browser

**Docs Collection Profile**:
A small SF Docs description of one backing documentation collection's ownership, URL traits, coverage boundaries, and preferred retrieval hints. It helps SF Docs route and validate documentation lookup without creating a local documentation index or exposing upstream ingestion details.
_Avoid_: upstream ingestion profile, source crawler, local docs index, ingestion manifest

**Docs Query Plan**:
A compact, visible explanation of a compiled SF Docs lookup, including the original user wording, the MCP-native query sent to the docs service, the collection slice, the retrieval filters or boosts used, and the resulting evidence status.
_Avoid_: hidden query rewrite, raw request dump, prompt-only reasoning, verbose trace

**Last-Known Usable Status**:
The most recent successful status snapshot that is still useful for human orientation, even when the **Current Probe Status** is failed or stale. It must be scoped to the same logical target, such as the same Salesforce project and target org or the same gateway usage account.
_Avoid_: stale failure, optimistic status, cached truth

**Current Probe Status**:
The latest attempt to refresh a status surface from a live or configured source. It can fail independently of whether a **Last-Known Usable Status** exists.
_Avoid_: source of truth, cached status, displayed status

**Stale Status Indicator**:
A compact human-facing suffix marker, rendered as `⚠ stale`, that says the displayed **Last-Known Usable Status** is not freshly confirmed. It belongs in compact status surfaces while detailed commands or panels show the **Current Probe Status** failure.
_Avoid_: error badge, unavailable state, hidden failure

**Org Status Fallback Boundary**:
The identity boundary for reusing a Salesforce org **Last-Known Usable Status**. The fallback is valid only when the Salesforce project root and configured target org string match, and the reusable snapshot came from a successful org detection with an org ID. When the current org probe fails, compact status surfaces should prefer the current successful status, then the last successful status on the current session branch, then the successful disk cache, and only then the failed current status.
_Avoid_: alias-only fallback, cross-project org cache, silent healthy org state

**Gateway Usage Fallback Boundary**:
The identity boundary for reusing a gateway usage **Last-Known Usable Status**. The fallback is valid for the existing gateway usage cache window and is treated as orientation-only spend, not a fresh billing assertion.
_Avoid_: billing truth, key identity guarantee, unavailable-first footer

**Status Presentation Fallback**:
A presentation-layer decision that chooses a **Last-Known Usable Status** plus **Stale Status Indicator** for compact surfaces while preserving the raw **Current Probe Status** for diagnostics. It should be centralized in helper functions rather than embedded ad hoc in renderers.
_Avoid_: store rewrite, hidden probe failure, duplicated fallback logic

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

**Apex Suite Test Run**:
A native Apex test execution scoped to an existing Apex test suite, used as lifecycle evidence without creating or managing suites.
_Avoid_: suite manager, suite editor, test explorer

**Org Apex Source Evidence**:
Read-only Apex class or trigger source fetched from the org through Tooling API when local source is missing, stale, or needs comparison. It is stored as an **Apex Artifact** and does not replace metadata retrieve or source editing.
_Avoid_: retrieve replacement, metadata browser, source edit

**Apex Test Report Artifact**:
Optional reporter-format output, such as markdown, JUnit, TAP, text, or JSON, generated from a **Targeted Apex Test Run** or **Apex Suite Test Run** and stored as an **Apex Artifact** without replacing the **Apex Result Card**.
_Avoid_: chat report, output-channel table, CI product

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

**LWC Lifecycle Extension**:
A bundled SF Pi extension that owns the local Lightning Web Component loop: scan project bundles, inspect component shape, diagnose LWC files, run targeted Jest tests, summarize evidence, and iterate. It does not own source deployment, org source synchronization, visual building, broad static analysis, Apex/server verification, or background LSP feedback.
_Avoid_: LWC IDE, UI builder, frontend app generator, Jest wrapper, CLI wrapper

**LWC Lifecycle Loop**:
The agentic Lightning Web Component workflow coordinated by an **LWC Lifecycle Extension**: scan bundles, inspect one component, diagnose focused files, run the smallest useful local Jest test, persist artifacts, and repeat until verified.
_Avoid_: test runner only, visual preview, deploy loop, org retrieve loop

**LWC Run**:
One local-native `sf_lwc` tool action in the **LWC Lifecycle Loop**, such as scanning the project, listing bundles, inspecting a component, diagnosing a file, discovering tests, planning a test, or running a bounded local Jest test.
_Avoid_: Salesforce CLI command, deploy action, browser preview, generic npm script

**Local LWC Test Run**:
A bounded **LWC Run** that executes the local project's LWC Jest runner for an explicit file, component, or test name and stores full Jest output as **LWC Artifacts**. It is local component evidence, not a Salesforce CLI fallback, org-backed Apex test, dependency install, arbitrary package script, or unbounded watch session.
_Avoid_: Apex test run, Jest watch, CI job, package install, npm script wrapper

**LWC Artifact**:
Persisted evidence from an **LWC Run**, such as a project scan, component inspection, diagnostics JSON, Jest result JSON, stdout/stderr capture, or compact summary.
_Avoid_: chat dump, terminal scrollback, source deployment bundle

**LWC Run Digest**:
A normalized structured summary of an **LWC Run** that carries status, workspace, scope, bundle signals, diagnostics, test outcomes, local execution rail entries, artifacts, and next-step guidance for both LLM context and **LWC Result Card** rendering.
_Avoid_: raw Jest response, action-specific JSON blob, renderer-only text

**LWC Result Card**:
The human-facing structured render of an **LWC Run**, optimized for quick local component diagnosis with clear scope, bundle signals, diagnostics, test results, root-cause hints, and artifact pointers.
_Avoid_: raw Jest JSON, plain terminal output, full source dump

**LWC Local Rail**:
A compact, human-facing rail directly under an **LWC Result Card** title that lists the local package, file, compiler, test runner, or bounded execution parameters used by an **LWC Run**.
_Avoid_: generic native-mode label, hidden test command, full stdout dump

**LWC Component Inspection**:
An **LWC Run** that summarizes one component bundle's local shape, including files, metadata exposure, public API surface, template usage, Salesforce module imports, child component references, style signals, and tests. It extracts cross-extension and skill handoff hints but does not deeply validate Apex methods, schema fields, SLDS rules, or security rules itself.
_Avoid_: Apex validation, schema validation, SLDS2 uplift product, security scan, dependency product

**LWC Project Scan**:
An **LWC Run** that inventories Lightning Web Component bundles only inside package directories registered by an SFDX project. It is not a workspace-wide glob, stale retrieve scan, or generic frontend project scan.
_Avoid_: whole-repo scan, generated-output scan, non-SFDX scan

**LWC Bundle Health Warning**:
A structural or diagnostic signal that a Lightning Web Component bundle is likely incomplete or locally invalid, such as missing required bundle files, missing template markup for a likely UI component, or file diagnostics with errors. It should affect **LWC Result Card** status for scan, list, inspect, or diagnose actions. Missing tests are not bundle health warnings by themselves.
_Avoid_: test coverage gap, style advisory, deployment result

**LWC Advisory Signal**:
A helpful follow-up signal from an **LWC Run** that does not make the bundle locally invalid by itself, such as missing colocated Jest tests, style uplift hints, exposure state, or cross-extension handoff hints.
_Avoid_: error, health failure, validation blocker

**Compact LWC Tool Text**:
The short LLM-facing summary of an **LWC Run**, optimized for low prompt footprint. It should preserve concise status while including the primary warning or failure reason when one exists; detailed evidence belongs in the **LWC Run Digest**, **LWC Result Card**, and **LWC Artifacts**.
_Avoid_: full card render, raw artifact dump, hidden failure reason

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

Dev: "Inspect this Lightning Web Component before I change it."
Agent: "I will run an **LWC Component Inspection** as part of the **LWC Lifecycle Loop**. The **LWC Result Card** will summarize the bundle, imports, public API, and tests, while full evidence is saved as **LWC Artifacts**."

Dev: "Run the related LWC test, but don't start a watcher."
Agent: "I will run a bounded **Local LWC Test Run** for the smallest useful test scope. It can execute the local LWC Jest runner, but it will not call Salesforce CLI, install dependencies, or start watch mode."

Dev: "Run `data360_observe stdm.find_sessions` and show me what happened."
Agent: "That created a **Data 360 Run**. I will return a **Data 360 Run Digest** in context, render a **Data 360 Result Card** for the human, and save the raw SQL/JSON as **Data 360 Artifacts**."

Dev: "Run the tests in Herdr, but don't reuse an old pane."
Agent: "I will plan a **Fresh Ephemeral Lane** for this command-scoped job. If it succeeds, I will clean up the lane; if it fails or times out, I will leave it available for inspection."
