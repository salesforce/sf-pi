# SF Pi

SF Pi is the bundled Salesforce-focused extension suite for pi. It gives agents workflow-oriented tools, command surfaces, safety mediation, and compact evidence artifacts for Salesforce development and operations.

## Language

**Pi Runtime Floor**:
The minimum Pi Runtime version that SF Pi intentionally supports for loaded bundled extensions. It is a product support boundary, not a per-feature compatibility shim.
_Avoid_: soft minimum, optional runtime, best-effort compatibility version

**Pi Runtime Support Window**:
The audited Pi `0.x` releases from the inclusive **Pi Runtime Floor** through the **Pi Runtime Audit Edge**, represented by an exclusive next-minor ceiling. Required CI and runtime classification enforce the audited claim; package metadata separately enforces the wider hard loadable range for forward-compatible stable `0.x` releases.
_Avoid_: hard loadable range, open-ended minimum, latest-is-compatible assumption, nightly-only compatibility claim, silent next-minor adoption

**Pi Runtime Audit Edge**:
The newest exact Pi Runtime release that required CI proves and SF Pi uses for normal development and repair guidance. Newer stable `0.x` releases inside the hard loadable range may run in forward-compatibility mode without becoming audited automatically.
_Avoid_: Pi Runtime Floor, latest available release, hard maximum, forward-compatible release

**Node Runtime Floor**:
The minimum Node.js runtime version that SF Pi intentionally supports for installation and loaded bundled extensions. It should be defined once and reused by package metadata, preinstall checks, doctor diagnostics, and startup status surfaces.
_Avoid_: Node prerequisite, local Node check, doctor-only Node warning, splash-only Node status

**Runtime Floor Adoption Slice**:
A narrow SF Pi change that raises the **Pi Runtime Floor** and updates package metadata, runtime checks, documentation, tests, and the **Pi Runtime Adoption Ledger** together. It should not bundle unrelated product behavior into the same change.
_Avoid_: release-note migration, compatibility patch, opportunistic upgrade

**Human-Only Transcript Row**:
An SF Pi status or evidence row shown to the human during a session without becoming agent context. It is for awareness and auditability, not agent steering.
_Avoid_: custom message, hidden prompt, diagnostic injection, model feedback row

**Agent Workflow Visibility Contract**:
The SF Pi rule that agent-chosen steps and mutations are visible tool calls, automatic lifecycle work uses meaningful **Human-Only Transcript Rows**, and only actionable findings become agent-visible follow-ups. Full evidence stays in bounded artifacts, and durable mutations are never hidden.
_Avoid_: centralized activity timeline, status noise in model context, hidden extension mutation, transcript dump

**Active-Branch Context Projection**:
The SF Pi model-context view that follows the active compaction-aware session branch, retains immutable guidance only while it remains live, and exposes only the latest value of each mutable hidden context type. The append-only session remains intact for audit and reconstruction.
_Avoid_: all-entry injection scan, sibling-branch context, historical mutable-state pileup, audit-entry filtering

**Salesforce Instruction Surface**:
All SF Pi-owned model-visible context present before task execution: the **Salesforce Engineering Constitution**, the **SF Pi Routing Summary**, active tool definitions and guidance, and other compact hidden runtime context. It excludes external Salesforce skills, user/project instructions, conversation history, and tool results.
_Avoid_: Salesforce kernel, reference map, system prompt, total context window, provider payload, external skill catalog

**Salesforce-First Interpretation**:
The SF Pi posture that ambiguous development requests in Salesforce contexts are interpreted through Salesforce concepts and owning SF Pi workflows first, while explicit general engineering requests remain fully supported. It is a domain bias, not a refusal boundary and not a reason to force Salesforce tools into unrelated work.
_Avoid_: Salesforce-only scope, generic-first routing, unrelated Salesforce tool use, off-topic refusal

**Salesforce Engineering Constitution**:
The compact bundled baseline in the **Salesforce Instruction Surface** that states universal Salesforce-first, grounding, behavior-proof, safety, minimal-change, evidence, and context principles without operational recipes. It is always present; user guidance may extend it but cannot replace it.
_Avoid_: CLI cookbook, replaceable kernel, per-tool manual, user-only baseline

**External Salesforce Skill Surface**:
The model-visible names and descriptions of independently owned Salesforce skills loaded through Pi. SF Pi measures this surface alongside its own context footprint but treats its content as an external fixed cost and does not use it as bundled-extension operating documentation.
_Avoid_: SF Pi reference documentation, bundled-extension skill, Salesforce Instruction Surface

**Progressive SF Pi Documentation**:
The SF Pi operating-guidance pattern that keeps a compact topic-to-document map in the **Salesforce Instruction Surface** and lets the model read extension-owned agent reference documentation when it judges the task requires deeper guidance. External Salesforce skills remain a separate discovery system, and no workflow is required to load a guide before proceeding.
_Avoid_: extension-owned skill, mandatory guide load, full README injection, duplicated tool workflow, external skill as SF Pi manual

**Salesforce Change Authority**:
The source whose current state governs a requested Salesforce change: repository source for repository outcomes, org metadata or schema for live-org outcomes, and owning SF Pi tool evidence when it already proves the needed fact. SF Pi asks only when the requested outcome leaves authority materially ambiguous.
_Avoid_: org-always-authoritative, local-always-authoritative, unconditional retrieve, duplicate verification

**Salesforce Connection Module**:
The single shared `lib/common` module through which SF Pi resolves target orgs, creates Salesforce Core connections, selects request API versions, performs bounded instance REST/query work, refreshes authentication, and caches connection state. It uses the target org's highest advertised API version by default, uses explicit `org-api-version` only when discovery fails, and otherwise fails before a business request. Status projections can reuse last-known orientation facts but never authorize requests.
_Avoid_: per-extension connection helper, direct API-version construction, project source API fallback, JSforce default version, cross-version business retry

**SF Pi Routing Summary**:
The tiny always-visible runtime statement that active SF Pi tools take priority over external skills and raw CLI, plus any disabled **Capability Owners** and their enablement path. It does not repeat the enabled extension catalog, tool descriptions, commands, or UI-only extensions.
_Avoid_: extension map, active tool catalog, command inventory, enabled-status dump

**Instruction Surface Report**:
An advisory measurement of the **Salesforce Instruction Surface**, the **External Salesforce Skill Surface**, and their largest contributors and changes from baseline. It informs review without imposing a CI size failure.
_Avoid_: prompt size gate, token billing claim, hidden telemetry, content dump

**Instruction Behavior Eval**:
An opt-in live-model regression report for representative Salesforce and explicit general-engineering tasks that measures routing, grounding, behavior-proof posture, unnecessary CLI use, release ordering, and evidence reporting. Deterministic composition and lifecycle tests remain required; model variance keeps this report non-blocking initially.
_Avoid_: mandatory live CI, prompt score, hidden reviewer, deterministic unit test replacement

**Agent-Settled Quality Gate**:
A post-agent SF Pi check that runs only after Pi has no automatic retry, compaction retry, or queued follow-up left. It is for workflow completion evidence, not per-run streaming feedback.
_Avoid_: agent_end hook, background scan, immediate lint pass, always-on watcher

**Canonical Gateway Identity**:
The single `sf-llm-gateway` id shared by the extension, Pi Provider, command, status, configuration, and documentation. Prior credentials and cache entries are not copied across identities; users reconnect explicitly through Pi.
_Avoid_: internal suffix, provider alias, duplicate login row, silent credential migration

**Gateway Model Catalog**:
The callable SF LLM Gateway models returned by authenticated discovery, with Pi's provider-scoped cache preserving the last successful result. SF Pi does not bundle a static gateway model inventory.
_Avoid_: preset catalog, bootstrap model list, presumed model availability, source-controlled model inventory

**Gateway Thinking Capability**:
A model-specific SF LLM Gateway fact that says whether reasoning is available. SF Pi accepts neutral authenticated metadata or portable metadata inherited by exact ID from Pi's public catalog, but does not maintain its own exact-model capability policy.
_Avoid_: global thinking level, default reasoning level, exact-ID capability, universal max support, silent remap

**Gateway Default Model**:
An available model chosen from the **Gateway Model Catalog** when gateway routing becomes the user's default model path. SF Pi preserves a still-available gateway choice and otherwise uses the catalog's stable first model; it does not bundle a default or fallback model ID.
_Avoid_: bundled default, static fallback, direct-provider default, undiscovered model

**Gateway Spend Authority**:
The SF LLM Gateway source that SF Pi treats as authoritative for gateway usage and cost presentation. Pi model pricing metadata can supplement it only when gateway-provided pricing data is explicit and trustworthy.
_Avoid_: local pricing estimate, synthesized tier pricing, direct-provider cost copy, billing truth from presets

**Native Resource Delegation**:
The SF Pi practice of letting Pi own generic global and project-local resource mechanics while SF Pi keeps curated Salesforce workflow guidance. It is a deprecation path for duplicate mechanics, not a reason to remove Salesforce-specific UX.
_Avoid_: custom project config, duplicate package manager, raw Pi config replacement, safety weakening

**Resource Resolution Parity Proof**:
A read-only behavior comparison between an SF Pi resource policy and Pi's real resolver across global/project overrides, package deltas, exact path filters, conflicts, trust, stale sources, and rescoping. It determines capability-by-capability whether native delegation is equivalent before code is deleted.
_Avoid_: release-note parity assumption, mock-only resolver test, wholesale feature retirement, production-setting experiment

**Pi-Native Credential Ownership**:
The SF Pi rule that Pi provider authentication owns user-global login orchestration, persistence, refresh, and removal, while SF Pi owns one shared fixed-mask TUI input boundary plus status, diagnostics, source reporting, and visible `/login` or `/logout` handoff. Environment variables remain the automation fallback; project configuration is non-secret, and SF Pi never writes `auth.json` or imports private credential storage.
_Avoid_: panel-owned persistence, project-scoped secret, direct auth.json mutation, private AuthStorage adapter, duplicate secret store, provider-specific prompt copy

**Secure Credential Prompt Proof**:
Observable evidence that a provider login prompt masks the value while editing, never echoes the submitted value in the TUI or transcript, clears cancellation/history state, and returns the credential only to Pi persistence. SF Pi treats this proof—not a `type: "secret"` declaration—as the prerequisite for interactive credential entry.
_Avoid_: type-only secret support, ordinary Input, submitted-value echo, manual screenshot confidence, extension-owned storage

**MCP Governance Extension**:
An SF Pi extension that allows general MCP server connections while adding Salesforce-specific discovery, setup, safety posture, and conflict handling around Salesforce Pi-native tools and Salesforce MCP servers.
_Avoid_: generic MCP client, MCP in core, Salesforce-only MCP adapter, raw MCP bridge

**Managed Capability**:
An SF Pi workflow area that needs one direct active owner for agent use, such as documentation lookup, SOQL lifecycle work, Slack research, or Data 360 operations.
_Avoid_: tool namespace, extension category, MCP server group, feature bucket

**Managed Capability Registry**:
The explicit SF Pi map from known Salesforce or bundled-extension workflow areas to their Pi-native extension owners and known MCP alternatives. It is the only source of hard MCP conflict decisions; unknown MCP tool similarities do not disable extensions by heuristic.
_Avoid_: heuristic conflict detector, semantic duplicate scan, tool-name matcher, inferred capability graph

**Capability Owner**:
The Pi-native extension or MCP tool surface that directly owns a **Managed Capability** for agent use in the current configuration.
_Avoid_: preferred tool, default route, provider, extension status

**Governed Direct Exposure**:
The SF Pi MCP exposure mode where MCP tools are direct Pi tools by default only after **Managed Capability** ownership and safety checks. Known overlaps with Pi-native Salesforce tools require an explicit user choice before both surfaces can be directly active.
_Avoid_: proxy-first MCP, raw direct bridge, tool dump, namespace-only conflict handling

**Direct Tool Preview**:
The `sf-mcp` review step that shows the MCP tools about to become direct Pi tools before an adopted MCP server exposes them to the agent. For unknown servers with no **Managed Capability Registry** conflict, users can expose all previewed tools or choose a subset.
_Avoid_: silent direct registration, proxy promotion, heuristic conflict review, post-enable summary

**Direct Tool Load Warning**:
A non-blocking `sf-mcp` warning shown when direct MCP exposure would add a large number of active tools. It informs the user about model-selection and context risks without preventing power users from exposing every tool.
_Avoid_: hard tool cap, silent tool flood, hidden context budget, proxy-only fallback

**MCP Execution Mediation**:
The runtime safety posture where directly exposed MCP tools can be visible to the agent, but risky MCP calls are evaluated at execution time before they affect Salesforce, external systems, or local machine state.
_Avoid_: setup-only approval, hidden allow, blanket server trust, direct-tool blocklist

**MCP Guardrail Handoff**:
The SF Pi boundary where `sf-mcp` owns MCP metadata, risk classification, and call normalization while SF Guardrail makes the final allow, ask, or block decision for risky MCP executions.
_Avoid_: sf-mcp approval layer, duplicate approval ledger, setup-only safety, raw MCP trust

**MCP Risk Classification**:
The `sf-mcp` process that combines MCP tool annotations with SF Pi-owned classifiers for known servers, Salesforce presets, and **Managed Capabilities** before execution mediation. MCP annotations are useful evidence but are not the sole authority for Salesforce or other high-value durable operations.
_Avoid_: annotation-only trust, heuristic hard block, all-unknown confirmation, setup-only risk review

**Extension-Level Capability Handoff**:
The v1 SF Pi policy that when MCP becomes the **Capability Owner** for a conflicting **Managed Capability**, SF Pi disables the conflicting bundled extension through package filtering instead of suppressing only selected LLM tools.
_Avoid_: tool-level suppression, soft warning only, hidden deactivation, partial extension ownership

**Capability Handoff Ledger**:
The SF Pi-owned record of **Extension-Level Capability Handoffs**, including the **Managed Capability**, previous Pi-native owner, MCP server instance or preset, user choice, handoff scope, org binding when relevant, and restore path.
_Avoid_: transient disable notice, hidden package filter, audit trail for every MCP call, separate extension manager

**Capability Handoff Scope**:
The settings scope where an **Extension-Level Capability Handoff** is applied. `sf-mcp` defaults handoffs to global scope for consistency across Pi sessions, while offering project scope when a user wants one repository or workspace to keep a different **Capability Owner**.
_Avoid_: implicit project default, hidden global disable, per-session handoff, unscoped package filter

**MCP Surface Boundary**:
The SF Pi rule that `sf-mcp` is the only supported user-facing MCP command, tool, and configuration surface in the bundled Salesforce extension suite, even when its implementation reuses generic MCP adapter code.
_Avoid_: separate MCP extension requirement, dual MCP panels, unmanaged adapter install, hidden parallel MCP surface

**MCP Config Delegation**:
The SF Pi rule that `sf-mcp` can read standard MCP server configuration for interoperability but keeps Salesforce-specific governance state in SF Pi-owned settings. Shared MCP files are written only after an explicit user-approved create or import target is chosen.
_Avoid_: SF Pi-only MCP config, hidden shared-config mutation, governance metadata in `.mcp.json`, config fork

**Unmanaged MCP Surface**:
Any MCP command, tool, or configuration path exposed by a non-`sf-mcp` Pi extension in the same runtime. SF Pi can detect and warn about it, but it is outside **MCP Governance Extension** ownership until the user adopts the server configuration into `sf-mcp` or disables the other surface.
_Avoid_: governed MCP, compatible MCP, hidden duplicate tools, assumed conflict coverage

**MCP Server Adoption**:
The explicit user decision to bring a discovered MCP server configuration under `sf-mcp` governance so SF Pi may start it, classify its tools, and expose approved direct tools.
_Avoid_: auto-import, passive discovery, config read, silent enablement

**Salesforce MCP Preset**:
A curated SF Pi setup path for an official or Salesforce-oriented MCP server that gives users easy configuration, clear prerequisites, default governance choices, and a separate **MCP Server Adoption** confirmation before tools become active.
_Avoid_: MCP catalog dump, hardcoded server shortcut, unmanaged MCP config, direct-tool auto-enable, preset-implies-adoption

**Salesforce MCP Preset Registry**:
The bundled SF Pi catalog of known Salesforce MCP server families and governance templates. It explains what SF Pi understands, including setup copy, auth style, org-scoped versus org-agnostic posture, **Managed Capability Registry** mapping, and default governance choices; it is not proof that a concrete server is available.
_Avoid_: live MCP catalog, org availability cache, tool list source, static enabled-state claim

**MCP Server Instance Discovery**:
The runtime process that determines concrete MCP server availability, server URL, authentication state, org identity when relevant, enabled state, and actual tool list. It is the source of truth for active server instances, including Salesforce Hosted MCP servers and arbitrary MCP config entries.
_Avoid_: preset registry, static docs lookup, assumed server availability, cached tool truth

**Org-Scoped MCP Adoption**:
An **MCP Server Adoption** for a Salesforce MCP server instance that is pinned to a resolved Salesforce org identity, including org alias, org ID when available, instance URL, and org type when known. If the current org identity changes, the adopted server requires revalidation before `sf-mcp` uses it as the active server instance.
_Avoid_: follow-default-org MCP, alias-only binding, silent org retargeting, cross-org reuse

**Salesforce MCP Setup Wizard**:
The guided `sf-mcp` flow for Salesforce Hosted MCP prerequisites, read-only preflight, supported API or metadata setup with explicit approval, and Setup/browser handoff when no supported API path exists.
_Avoid_: one-click admin automation, browser-first setup bot, undocumented setup mutation, prerequisites-only help text

**Native Auto Update**:
An opt-in SF Pi update flow that delegates to supported first-party updater commands instead of reimplementing package-manager-specific update logic. It is coordinated only after the agent settles, stays inside the **Pi Runtime Support Window**, and leaves durable human-visible step results.
_Avoid_: custom updater framework, installer matrix, one-shot idle timer, unaudited runtime update, hidden restart

**Agent-Settled Update Coordinator**:
The Native Auto Update lifecycle that records due work as pending, waits for Pi to settle, runs eligible first-party update targets independently, and emits a **Human-Only Transcript Row** with success, failure, skip, and restart evidence.
_Avoid_: startup race, abandon-if-busy check, coupled all-or-nothing targets, transient-only result

**Complete Gateway Provider**:
The single Pi Provider that owns Gateway authentication, last-known models, refresh persistence, filtering, and mixed API streaming through provider-neutral protocol adapters. It does not encode deployment routing, traffic tiers, or exact-model payload policy.
_Avoid_: legacy ProviderConfig coordinator, dual provider path, transitional refresh layer, ID-based API dispatcher

**Model Resolution Delegation**:
The SF Pi practice of using Pi's native model and scoped-model resolution when behavior parity is proven for SF LLM Gateway. It is allowed to be a riskier simplification slice, but only when tests prove gateway defaults, discovered models, diagnostics, and thinking shorthand still work.
_Avoid_: custom model parser, gateway-only selector, untested resolver swap, duplicate model resolution

**Runtime Delegation Program**:
A coordinated SF Pi effort to delete duplicate runtime mechanics when Pi provides a proven native extension surface. It should produce simpler SF Pi code and behavior tests, not broad new product features.
_Avoid_: feature expansion, compatibility layer, local runtime framework, release-note implementation project

**Deletion-Gated Adoption Milestone**:
A serial runtime-adoption slice that begins with a failing public-seam behavior proof, implements one approved change, deletes the superseded path, and ends with focused plus full validation green before the next milestone begins.
_Avoid_: broad migration branch, old/new production paths, compile-only adoption, cleanup deferred to later

**Behavior Proof**:
A test or verified workflow that exercises an SF Pi capability through the same public seam an agent or human uses. It should prove the observable contract before risky runtime delegation or deletion lands.
_Avoid_: compile-only check, private helper assertion, implementation-detail test, hopeful migration

**Behavior-Proof-First Development**:
The SF Pi posture that a behavioral change begins with a failing or baseline **Behavior Proof** when feasible, proceeds through the smallest relevant change, and ends with passing evidence through the same public seam. Artifact-specific proof replaces a universal unit-test requirement, and infeasible pre-change proof requires an explicit rationale and the strongest available substitute.
_Avoid_: test-after default, unit test for every artifact, verification-only development, unexplained no-test change

**Behavior Proof Ladder**:
The ordered evidence required before a superseded path is deleted: pure behavior tests, exact-Pi integration, support-window and full validation, scoped live proof where fixtures are insufficient, and manual TUI QA only for visual changes. Each rung is used only when the risk requires it.
_Avoid_: coverage-only confidence, mock-shaped runtime, source-string behavior proof, unobserved live command, exhaustive live matrix

**Progressive Tool Activation**:
The Pi-native pattern where SF Pi registers a workflow's tools but initially exposes only its entry tools, then additively activates eligible specialist tools during a visible workflow call for the next model request. Activation changes model visibility, never authorization or safety mediation.
_Avoid_: hidden intent router, tool re-registration, exclusion bypass, provider-specific serialization, package-wide loader without proof

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

**Last-Known Status Indicator**:
A compact, non-alarming human-facing suffix marker that says the displayed **Last-Known Usable Status** is orientation-only and not freshly confirmed. It should render calmly, for example `↺ last known`, while detailed commands or panels show the **Current Probe Status** failure.
_Avoid_: warning badge, stale error, unavailable state, hidden probe failure

**Org Status Fallback Boundary**:
The identity boundary for reusing a Salesforce org **Last-Known Usable Status**. The fallback is valid only when the Salesforce project root and configured target org string match, and the reusable snapshot came from a successful org detection with an org ID. When the current org probe fails, compact status surfaces should prefer the current successful status, then the last successful status on the current session branch, then the successful disk cache, and only then the failed current status.
_Avoid_: alias-only fallback, cross-project org cache, silent healthy org state

**Gateway Usage Fallback Boundary**:
The identity boundary for reusing a gateway usage **Last-Known Usable Status**. The fallback is valid for the existing gateway usage cache window and is treated as orientation-only spend, not a fresh billing assertion.
_Avoid_: billing truth, key identity guarantee, unavailable-first footer

**Status Presentation Fallback**:
A presentation-layer decision that chooses a **Last-Known Usable Status** plus **Last-Known Status Indicator** for compact surfaces while preserving the raw **Current Probe Status** for diagnostics. It should be centralized in helper functions rather than embedded ad hoc in renderers.
_Avoid_: store rewrite, hidden probe failure, duplicated fallback logic

**Layered Extension Readiness Row**:
An SF Welcome status row that reports a bundled extension's lifecycle state first and, when enabled, reports its extension-owned runtime readiness. Enablement never implies runtime readiness.
_Avoid_: installed status, enabled means ready, hidden disabled integration

**On-Demand Capability Availability**:
The state where an enabled SF Pi capability can be invoked even though its optional external runtime is idle or absent. Availability is a healthy baseline and is weaker than runtime readiness.
_Avoid_: installed, runtime ready, external process running, setup incomplete

**Runtime Readiness Fault**:
An enabled extension state that proves corrective action is required, such as broken configuration, failed authentication, or incompatible runtime behavior. Ordinary absence, including an optional runtime not running or having no open document, is not a fault.
_Avoid_: every non-ready state, optional runtime absent, no open document

**Browser Runtime Readiness**:
The SF Browser status of the external browser automation runtime based on cached or explicit checks. It describes whether the runtime appears installed and usable enough to attempt browser work; it is not proof that a browser session has launched or that a Salesforce page is reachable.
_Avoid_: browser ready, Salesforce UI ready, CDP proof, startup browser launch

**Review Tool Readiness**:
The startup status of an optional local diff-review tool such as Hunk. It is a setup and adoption nudge only; it does not imply SF Pi opens the review UI, posts annotations, or owns review workflow integration.
_Avoid_: code-review integration, Hunk extension, automatic review session, agent annotation bridge

**Apex Lifecycle Extension**:
A bundled SF Pi extension that owns the Apex author → diagnose → trace/log → run/probe → test → fix loop while leaving source edits to normal Pi file tools.
_Avoid_: Apex IDE, code generator, debugger suite

**Apex Lifecycle Loop**:
The agentic Apex development cycle coordinated by an **Apex Lifecycle Extension**: plan the change, edit files, diagnose locally, observe runtime behavior, run targeted tests, and repeat until verified.
_Avoid_: test runner only, log viewer only

**Agent Script Quality Rule**:
A static-analysis rule over compiler-valid Agent Script that identifies a deterministic defect, configured policy breach, maintainability problem, or advisory risk without redefining **Agent Script Compile Validity**. An **Agent Script Hardening Diagnostic** is the narrow proven-failure subset. When an official Agent Script diagnostic reaches strict semantic parity, SF Pi deletes the duplicate local evaluator and may retain only a thin policy projection that maps the upstream evidence into existing quality presentation, repair, suppression, or publication behavior.
_Avoid_: duplicate upstream evaluator, compiler diagnostic presented as a second local finding, compile error, behavioral test result

**Agent Script Quality Pass**:
A source-versioned, single-agent-file evaluation of **Agent Script Quality Rules** after the agent settles or during explicit review. Edit-time feedback remains limited to compilation and **Agent Script Hardening Diagnostics**; multiple changed files are evaluated independently rather than becoming a project-wide quality claim.
_Avoid_: compile-on-save lint dump, per-keystroke graph scan, project-wide quality claim, behavioral evaluation, hidden background scan

**Agent Script Universal Quality Rule**:
An **Agent Script Quality Rule** whose meaning does not depend on organization-specific action names, sensitive-resource policy, target allowlists, or threshold choices. The first quality release contains only these rules plus report-only metrics; configurable organization policy is a later boundary.
_Avoid_: inferred security policy, customer convention, target-name heuristic, configurable v1 rule

**Setting Scope Policy**:
The declared authority model for one user-facing SF Pi preference. A Global-Only setting can be changed only for the user as a whole; a Project-Inheritable setting can specialize its global value for one project and otherwise inherits it. Scope belongs to each setting rather than implicitly to an entire extension.
_Avoid_: extension-section scope, accidental project override, implicit scope from file presence, universal project override

**Agent Script Quality Rule Setting**:
A global-only On/Off preference for one canonical **Agent Script Quality Rule**, stored sparsely under `sfPi.agentScript.quality.rules`. Disabled rules do not report, repair, compute metrics, or gate publication; every **Agent Script Quality Result** discloses effective coverage, and project settings cannot override the preference.
_Avoid_: project rule override, master quality switch, hidden disabled rule, duplicate rule config store

**Agent Script Quality Result**:
The outcome of an **Agent Script Quality Pass**, containing `clean`, `findings`, `partial`, or `failed` status plus severity counts, source findings, and metrics. It has no numeric quality score and does not redefine **Agent Script Compile Validity**.
_Avoid_: quality score, compile status, deployment readiness, raw diagnostic list

**Agent Script Quality Repair Loop**:
A progress-gated agent follow-up for High and Moderate findings from an agent-settled **Agent Script Quality Pass**. It stops when the relevant source is not edited, the finding signature repeats, quality becomes clean, analysis fails, or the user interrupts; Low, Info, and metrics remain human-only evidence.
_Avoid_: unbounded retry, clean-result follow-up, metric-driven rewrite, hidden repair

**Agent Script Quality Suppression**:
A `# sf-agentscript-ignore-next-line <rule-id>: <reason>` source annotation that suppresses one next-line Moderate, Low, or Info **Agent Script Quality Rule** finding. It cannot suppress High hardening findings or metrics, and malformed or unused suppressions remain visible evidence.
_Avoid_: blanket disable, High-rule bypass, project ignore file, reasonless suppression

**Agent Script Quality Publication Gate**:
The local-file lifecycle boundary that pauses publication when an **Agent Script Quality Result** contains a High deterministic finding while preserving **Agent Script Compile Validity**. It can proceed through an explicit **Agent Script Quality Publication Override**, and it does not reanalyze an already published version whose source identity is not proven by the local file.
_Avoid_: compiler error, every-warning blocker, activation gate, org compiler rejection, silent bypass

**Agent Script Quality Publication Override**:
A user-approved, session-scoped exception for one agent bundle and the specific High **Agent Script Quality Rule** IDs already reviewed, or for the separately disclosed `quality-analysis-failed` condition. Repeated publication within that envelope can proceed during the session; a newly appearing High rule requires another approval, and no override persists to project or global settings.
_Avoid_: blanket session bypass, persistent ignore setting, agent-selected first-attempt override, hidden approval, failed-means-clean

**Agent Script Eval Activation Gate**:
The lifecycle boundary that requires complete passing eval evidence for the exact target-org BotVersion before activation. It is separate from compile validity and the **Agent Script Quality Publication Gate**, and it can proceed without matching evidence only through an explicit human-approved emergency override.
_Avoid_: publication quality gate, any-version eval, compile-means-tested, silent activation bypass

**Agent Script Generated Baseline Suite**:
A read-only **Agent Script Eval Suite** generated from the current Agent Script source to provide minimum release evidence. It is regenerated rather than edited and forms one part of the **Agent Script Release Eval Contract**.
_Avoid_: designated release suite, editable regression suite, hidden release check, stable hand-authored baseline

**Agent Script Release Eval Contract**:
The regression evidence required by the **Agent Script Eval Activation Gate** for a pending latest non-Active BotVersion: an **Agent Script Generated Baseline Suite** plus a project-designated release suite when one is configured. Both target the exact org and BotVersion, and every expected result must return effectively true without step error or incomplete evidence.
_Avoid_: any passing eval, trivial activation test, active-version proxy, partial green run

**Agent Script Release Sequence**:
The Agent Script lifecycle in which publication creates an inactive BotVersion, the exact version satisfies the **Agent Script Release Eval Contract**, and activation occurs only as a separate final action. Immediate publish-and-activate is not part of the normal release path.
_Avoid_: publish and activate, activate during publish, test after activation, active-first release

**Agent Script Procedure**:
One executable logic region whose paths can be analyzed independently, such as reasoning instructions, before/after reasoning, connected-agent after-response logic, or custom subagent lifecycle logic. Prompt text, action declarations, and an entire subagent are not procedures.
_Avoid_: subagent, prompt block, whole Agent Script file, action definition

**Agent Script Cyclomatic Complexity**:
The per-**Agent Script Procedure** count of one entry path plus each `IfStatement`, `TernaryExpression`, and short-circuit `and`/`or` expression. Subagent/file aggregates are orientation-only, and thresholds remain advisory until a representative corpus establishes a baseline.
_Avoid_: cyclometric complexity, whole-file complexity gate, prompt complexity, tool count, transition count

**Agent Script Hardening Diagnostic**:
An SF Pi-owned deterministic diagnostic for a proven Salesforce publish or runtime failure that the official Agent Script toolchain does not cover. It is removed or narrowed when upstream owns or contradicts the behavior.
_Avoid_: generic language rule, duplicate upstream diagnostic, competing compiler policy, speculative warning

**Agent Script Compile Validity**:
An Agent Script source is compile-valid when it has no severity-1 diagnostics. Warnings, information, and hints remain visible evidence but do not make valid source fail compilation.
_Avoid_: diagnostic-free validity, clean-with-notices status, hidden warning, hidden information

**Agent Script Structural Projection**:
A compact, stable, agent-facing summary of workflow topology and review/preflight facts derived from the official Agent Script AST. It excludes compiler-internal nodes, CST wrappers, cycles, and parser-specific implementation detail.
_Avoid_: raw AST, CST dump, compiler mirror, universal feature inventory

**Agent Script Flow Projection**:
An SF Pi-owned, source-versioned graph derived only from the official Agent Script AST that distinguishes one-way transitions, returning subagent delegations, and connected-agent invocations with their conditions and source ranges. **Agent Script Quality Rules** consume it for graph facts without introducing another parser or language model. The public AgentFabric graph extractor may provide test-time parity insight over Agentforce fixtures, but it is not a production dependency, user-facing output, or replacement authority until it proves equivalent Agentforce edge semantics.
_Avoid_: raw reference graph, runtime AgentFabric supplement, copied upstream extractor, inferred runtime trace

**Agent Script Cycle Finding**:
An **Agent Script Quality Rule** result whose confidence follows edge semantics: an unconditional one-way transition cycle is a deterministic defect, while conditional transition and returning-delegation cycles are advisory risks. A connected-agent cycle with unavailable source remains unverifiable rather than inferred broken.
_Avoid_: every graph cycle is an error, infinite-loop claim, connected-agent guess

**Agent Script Target Preflight**:
A read-only org existence check for a compiler-valid target using one authoritative product-specific lookup. Targets without a proven lookup remain explicitly unverifiable rather than being guessed present or missing.
_Avoid_: scheme validation, always-valid assumption, generic metadata framework, guessed resolver

**Connected Agent Runtime Readiness**:
A read-only fact, separate from target existence, that says whether a connected agent has an Active version available for runtime invocation. A not-ready result warns and provides an activation path without redefining the target as missing or blocking parent-agent publication.
_Avoid_: target existence, missing agent, publish blocker, inferred callability

**Connected Agent Readiness Graph**:
A cycle-safe graph, bounded to five levels, built from Agent Script sources present in the same local Salesforce project, with each discovered node checked for org existence and Active-version readiness. An active target whose source is not local has unverifiable descendants rather than inferred topology. Direct readiness keeps existing blocker/warning semantics; transitive gaps warn without blocking root publication.
_Avoid_: remote source retrieval, BotVersion topology inference, unbounded recursion, active means transitively ready, transitive publish blocker

**Agent User Readiness Scope**:
SF Pi authoritatively checks Service Agent user wiring, treats the known Employee Agent path as not applicable, and reports other compiler-valid agent types as not evaluated. Compiler-valid type does not imply SF Pi-verified setup readiness.
_Avoid_: guessed type policy, every non-Service type is ready, unsupported-type blocker

**Agent Script Package Coherence**:
The official Agent Script parser, compiler, dialect, language, LSP, and types packages resolve as one compatible toolchain without missing or duplicate foundational versions. It is a read-only health claim, not an update mechanism.
_Avoid_: latest-only check, generic dependency health, automatic package update, version-count dashboard

**Agent Script Dual Upstream Analysis**:
The local analysis contract that retains both the official compiler-document result and the official language-server document result for one Agent Script source identity. Their diagnostics form one deterministic deduplicated result, any severity-1 diagnostic blocks compile validity, and each result's distinct document, range, symbol, and language-service facts remain available to downstream workflows. SF Pi does not turn differences between the two official results into a separate user-facing status or report.
_Avoid_: winner pipeline, duplicated diagnostic display, upstream divergence report, independent local parser, compile-only analysis

**Agent Script Scaffold Routing**:
The routing contract for generated Agent Script bundles: a single generated subagent is entered deterministically, while a multi-subagent scaffold exposes one planner-selectable transition per subagent with descriptions derived from the requested responsibilities.
_Avoid_: deprecated topic scaffold, empty behavioral node, unconditional first-subagent routing, hidden router

**Agent Script Integration Contract Test**:
A deterministic test of the boundary SF Pi owns: official package loading, diagnostic preservation, stable structural projection, target-preflight routing, or package coherence. Upstream compiler internals and live Salesforce execution are separate evidence tiers.
_Avoid_: upstream test mirror, internal AST assertion, release-note checklist, local proof of runtime behavior

**Agent Script Eval Agent Identity**:
The canonical Agent API name associated with local bundle configuration, Suite filename, or Run evidence. A local bundle is optional, and conflicting identities remain explicit rather than being merged or reassigned.
_Avoid_: basename-only identity, latest-run inference, silent identity merge, local-bundle requirement

**Agent Script Eval Suite Identity**:
The current project-relative Suite path, with historical continuity across a rename only when the source digest and **Agent Script Eval Agent Identity** both match exactly. Similar names, approximate content, and ambiguous digest matches never establish continuity.
_Avoid_: filename similarity, latest-run ownership, fuzzy content match, silent rename inference

**Agent Script Eval Suite**:
One executable EvalSpec JSON file containing one or more **Agent Script Eval Scenarios** for one **Agent Script Eval Agent Identity**. It is the only source-controlled eval format and has one **Agent Script Eval Suite Identity**; an **Agent Script Release Eval Contract** can compose multiple suites without becoming a suite itself.
_Avoid_: test class, run, multi-file collection, authoring sidecar, higher-level source format, release contract

**Agent Script Eval Seed Profile**:
A source-only declaration inside one **Agent Script Eval Suite** that resolves exactly one row from one bounded read-only SOQL query against the **Agent Script Eval Run Target** org and maps scalar fields or constants into ordinary Scenario context variables. Reused profiles execute once per Run; unsafe, empty, ambiguous, null, or mistyped results fail before Run creation.
_Avoid_: fixture registry, sidecar, data picker, multi-row fan-out, mutation, fallback ID, cross-org seed

**Agent Script Ad Hoc Eval Run**:
An **Agent Script Eval Run** created without an **Agent Script Eval Suite Identity**, such as from an inline spec or missing source path. It remains inspectable evidence but never creates a synthetic Suite or satisfies a release contract.
_Avoid_: synthetic suite, hidden run, inferred source path, release evidence

**Agent Script Eval Run Scope**:
The execution breadth of an **Agent Script Eval Run**: Suite scope executes every Scenario in one Suite, while Scenario scope executes one selected Scenario for diagnosis. Only complete Suite-scope evidence can satisfy an **Agent Script Release Eval Contract**.
_Avoid_: partial suite presented as release evidence, hidden scenario subset, run filter

**Agent Script Eval Run Target**:
The explicit per-run combination of Salesforce org, Agent API name, and version policy. It can default from current configuration but never changes the Salesforce CLI default org or silently inherits a different Run’s target.
_Avoid_: implicit org, persistent Studio org, alias-only evidence, cross-run target reuse

**Agent Script Eval Run**:
One execution attempt of one validated **Agent Script Eval Suite** against an **Agent Script Eval Run Target**, with immutable source and executed-suite evidence. It begins only after local suite preflight and target resolution succeed, continues independently when **Agent Script Eval Studio** closes, and ends early only through explicit cancellation or execution failure.
_Avoid_: draft snapshot, validation attempt, modal lifetime, implicit cancellation, release contract, generic tool run

**Agent Script Eval Run Execution State**:
The lifecycle state of an **Agent Script Eval Run**: Running, Completed, Cancelled, Interrupted, or Infrastructure Failed. It is separate from the evidence verdict and never turns cancellation or process loss into a behavioral failure.
_Avoid_: behavioral verdict, orphaned-running state, cancelled-means-failed, age-based interruption

**Agent Script Eval Run Verdict**:
The evidence outcome of an **Agent Script Eval Run**: Passed when every expected result returns effectively true, Failed for explicit behavioral failures, Incomplete for missing or errored evidence, or Unverified for unresolved evidence. Historical Runs preserve both their recorded verdict and the current evidence interpretation without rewriting artifacts; source freshness remains separate.
_Avoid_: execution state, aggregate green count, null-as-pass, unavailable-as-failed, overwritten historical verdict, stale-source verdict

**Agent Script Eval Studio**:
A local-first human review and execution workspace for source-controlled **Agent Script Eval Suites**, **Agent Script Release Eval Contracts**, and locally persisted run evidence. It consults Salesforce only for explicit version resolution or runtime execution.
_Avoid_: Testing Center clone, Agent Script Test Studio, org-first test inventory, startup org scan, trace viewer only

**Agent Script Eval Scenario**:
A transport-independent regression definition with one shared agent session, one or more ordered user turns, and at least one Turn- or Scenario-scoped evaluator, with explicit state checkpoints and evidence provenance. It models real stateful conversation rather than injecting synthetic conversation history.
_Avoid_: raw Evaluation API steps, unrelated one-turn test bundle, synthetic history presented as state progression, free-form prompt script

**Agent Script Eval Studio Projectability**:
The ability to map one raw EvalSpec test entry unambiguously into one shared-session **Agent Script Eval Scenario**, its Turns, and evaluator scopes. An unprojectable entry remains source-visible but blocks Studio execution rather than being silently coerced.
_Avoid_: raw-step guess, multiple sessions presented as one conversation, silent scenario split, misleading partial projection

**Agent Script Eval Scenario Compiler**:
The deterministic translation from an **Agent Script Eval Scenario** to the current Salesforce Evaluation API step graph. It centralizes session reuse, step IDs, references, state checkpoints, and evaluator wiring so generation does not depend directly on transport details.
_Avoid_: second eval backend, per-generator step assembly, transport-specific scenario model, hidden evaluator inference

**Agent Script Eval Evaluator Capability**:
The support posture of an evaluator type: Live-Proven through the current direct Evaluation API, Client-Recognized without equivalent runtime proof, or Candidate/Unverified. Default guidance exposes Live-Proven evaluators; Advanced guidance labels the others explicitly and requires per-run acknowledgement without making their results release-ready.
_Avoid_: client recognition means supported, flat evaluator catalog, hidden capability gap, universal target-org support, acknowledgement means proof

**Agent Script Eval Evaluator Scope**:
The evidence boundary of an evaluator: Turn scope when it clearly references one turn, or Scenario scope when it spans turns or cannot be attributed safely. Ambiguous evaluators remain Scenario-scoped rather than being assigned to a nearby turn.
_Avoid_: nearest-turn guess, flat evaluator list, conversation-level means every evaluator

**Agent Script Eval Expected Behavior**:
A per-turn semantic expectation shown before execution and compared with the actual Agent response after execution. It describes acceptable behavior rather than scripting an expected Agent utterance.
_Avoid_: expected bot message, golden response, synthetic Agent turn, exact dialogue

**Agent Script Eval Authoring Brief**:
A compact human intent summary used to hand off **Agent Script Eval Suite** or Scenario creation to the conversational agent. It captures purpose, turn examples, proof goals, and seed assumptions without becoming an executable spec or transport-schema editor.
_Avoid_: Testing Center wizard, EvalSpec form, hidden generation prompt, executable sidecar

**Agent Script Eval Input Seed**:
An explicit Scenario-owned context-variable value, optionally expanded from a Suite authoring default or replaced by a Run override, with effective value and provenance recorded as Run evidence. Sensitive seed values remain masked by default.
_Avoid_: hidden context, inferred default, unproven runtime value, raw secret display

**Agent Script Eval State Timeline**:
The ordered view of effective seeds, expected checkpoints, observed after-turn state, and previous-to-current deltas for one **Agent Script Eval Scenario**. Missing state remains unavailable rather than being inferred unchanged, false, or empty.
_Avoid_: raw state dump, missing-means-false, prose-derived state, timeless variable value

**Agent Script Eval State Checkpoint**:
A per-turn assertion derived from a statically provable Agent Script state update, such as a literal assignment or simple arithmetic over a known default. Dynamic updates without an exact expected value are reported as skipped rather than guessed.
_Avoid_: inferred state, LLM-generated expected value, expression interpreter, response-only continuity claim

**Agent Script Eval Branch Expectation**:
A second-turn behavioral expectation derived from a simple source branch whose condition is provably activated by an **Agent Script Eval State Checkpoint**. When no such branch can be proven, automatic generation omits the behavioral turn and reports the gap.
_Avoid_: generic continue prompt, guessed branch, LLM-authored expected behavior, condition interpreter

**Agent Script Eval Evidence Availability**:
An explicit statement of whether the Evaluation API directly exposes a requested runtime fact. Unavailable evidence is represented as unknown with a reason, never as zero and never inferred from ambiguous LLM event ordering.
_Avoid_: inferred connected call, zero-as-unknown, synthetic trace presented as direct telemetry, missing-field guess

**Agent Script Diagnostic Presentation**:
Explicit compile/check returns every upstream diagnostic severity, while automatic compile-on-save feedback surfaces errors and warnings only. Information and hints remain available on demand without becoming repeated edit-loop noise.
_Avoid_: hidden explicit diagnostic, all-hints-on-save, automatic context flood, fixability-as-visibility

**Connected Agent Invocation**:
A successful Agent Script planner handoff to another agent, represented by a `RelatedAgentStep`. It is successful tool activity with its own count and evidence, not a function call.
_Avoid_: function call, ordinary action call, topic transition, enabled-but-unused tool

**Agent Script Org Compiler Compatibility Risk**:
A non-blocking source-based warning that a locally compile-valid Agent Script feature may not yet be accepted by the target org's server compiler. Only a server compile proves org acceptance; the risk does not make local compilation invalid.
_Avoid_: local compile error, entitlement failure, cached org capability, universal unsupported-feature claim

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

**SOQL Artifact Export**:
A SOQL lifecycle action that copies an existing **SOQL Artifact** to a user-visible workspace export location. It does not query Salesforce, but it can disclose previously queried data or write outside the intended project area if the output path is not confined.
_Avoid_: query run, data mutation, bulk export product, arbitrary file copy

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

**Code Analyzer Result Card**:
The human-facing structured render of a Salesforce Code Analyzer report, optimized for quick quality triage with clear status, severity, hotspots, fixability, lineage, and artifact pointers. It is a presentation over the existing Code Analyzer report summary, not a separate run digest or rule configuration model.
_Avoid_: Code Analyzer Run Digest, shadow scan model, rule dashboard, raw report dump

**Code Analyzer Facts**:
A compact derived view of a Salesforce Code Analyzer report that names severity counts, highest-risk findings, top rules, top files, and fixable finding count. It gives agents stable audit handles without replacing the sibling report summary or full report artifact.
_Avoid_: report copy, hidden reasoning, persisted rule config, complete violation table

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

**Tenant Ingest Run**:
A **Data 360 Run** that uses a tenant ingest auth session to create, upload to, or close a Data Cloud ingest job. It can move local file bytes into a tenant, so it is both a **High-Value Durable Mutation** and a data movement surface, not only a REST write.
_Avoid_: ordinary Data 360 write, CSV helper, upload convenience, safe ingest

**Dynamic Herdr Lane**:
A Salesforce workflow pane planned by SF Pi for Herdr-backed tests, logs, previews, evals, deploy checks, servers, or reviews. The plan starts with `herdr_layout.pane_split` and passes its opaque pane ID to current pane or agent actions.
_Avoid_: named pane alias, constructed pane ID, generic terminal slot

**Fresh Ephemeral Lane**:
A **Dynamic Herdr Lane** created for one job and closed with `herdr_pane.close` only after the workflow's success is observed. Failure, timeout, blocked, or ambiguous results stay open for inspection.
_Avoid_: close-on-timeout, reused pane, permanent pane

**Sticky Lane**:
A **Dynamic Herdr Lane** kept open for continued long-running work, such as a development server. It is created only when that work is ready to start.
_Avoid_: pre-opened lane, automatic cleanup

**Manual Lane**:
A **Dynamic Herdr Lane** that stays open until explicit cleanup, such as a review agent pane.
_Avoid_: auto-cleaned pane, ephemeral lane

**Workflow Success Condition**:
An observed successful result, such as passing tests, successful validation, an expected output marker, or a completed eval. Starting a command or reaching a timeout is not success.
_Avoid_: command started, generic output, timeout cleanup

**Herdr Plan Step**:
A non-executable structured recommendation containing a current Herdr tool/action pair, safe arguments, and opaque result references. It guides explicit tool calls without generating shell commands or mutating panes itself.
_Avoid_: monolithic action, generated command, hidden automation

**Herdr Workflow Handoff**:
A cross-extension hint containing explicit plan intent and primary workflow, but no shell command or pane mutation. The receiving agent may call `sf_herdr_plan` when the current runtime is ready.
_Avoid_: inferred workflow, suggested command, pane alias

**Herdr Runtime Readiness**:
The state in which `HERDR_ENV=1`, `HERDR_PANE_ID` is set, and all three current tools—`herdr_layout`, `herdr_pane`, and `herdr_agent`—are active. SF Herdr registers its planner only at session startup in this state.
_Avoid_: partial tool activation, extension enabled, legacy fallback

**Herdr Runtime Identity**:
The independently versioned Herdr binary and channel, Pi control package, CLI protocol, and Pi bridge schema installed for the current user. These values describe different contracts and are never compared as if they shared one release number.
_Avoid_: Herdr version, Pi state version, matching-version requirement, unverified latest claim

**tldraw Runtime Floor**:
The minimum tldraw offline release contract that SF tldraw intentionally supports. Runtimes below the floor are incompatible rather than partially supported through legacy fallbacks.
_Avoid_: best-effort compatibility, optional create support, legacy runtime mode

**tldraw Runtime Contract Proof**:
Evidence that the local tldraw runtime satisfies the **tldraw Runtime Floor**. Machine-readable capability metadata is preferred; an app-owned contract description is an explicit temporary proof source when capability metadata is unavailable.
_Avoid_: assumed latest version, OS-specific install check, failed-route guess

**Upstream tldraw Skill Ownership**:
The tldraw offline app is the canonical publisher and updater of the `tldraw-offline` Pi skill. SF Pi verifies the app-managed installation and provides recovery guidance but never bundles, copies, or overwrites a competing skill.
_Avoid_: vendored skill copy, SF Pi skill fork, startup skill rewrite, same-name collision

**tldraw Skill Readiness**:
Read-only evidence that the app-managed `tldraw-offline` skill is installed for Pi and aligned with the installed tldraw app. Missing or stale skill wiring is actionable setup guidance, not proof that Salesforce rendering itself is unavailable.
_Avoid_: bundled skill version, render blocker, silent generic-action fallback

**tldraw Document**:
An open tldraw runtime document that can contain one or more pages and serve as a diagram render target.
_Avoid_: board, canvas document, page

**Salesforce Diagram Routing**:
The renderer choice for Salesforce diagram requests. A ready SF tldraw profile is the default, explicit format requests such as Mermaid or text take precedence, and an unavailable canvas is reported before offering a fallback.
_Avoid_: generic diagram hijack, silent format change, always ask renderer

**Salesforce Diagram Family**:
One of the supported semantic views—Data Model, System/Solution Architecture, or Interaction/Sequence—each answering a different question with its own node, layout, and connector grammar.
_Avoid_: template, rendering mode, universal Salesforce diagram

**Diagram Grounding**:
The explicit evidence mode of a Salesforce diagram. Reference grounding uses official Salesforce documentation for a generic model; Org grounding uses a named live org and records its identity and observation time.
_Avoid_: inferred mode, hidden org lookup, generic diagram presented as org truth

**Diagram Evidence Reference**:
A declared source id attached to a semantic diagram element and preserved as inspectable provenance. It records where a claim came from but does not mean the renderer independently verified that claim.
_Avoid_: verified fact, signed evidence, decorative citation, diagram-level source only

**Diagram Render Privacy**:
The rule that every user-visible diagram string excludes authentication material, Salesforce org ids, usernames or email addresses, instance URLs, and authentication URLs. Execution provenance can route a render without becoming canvas text or a persisted render artifact.
_Avoid_: display-label-only filtering, caller-trusted text, redaction after rendering

**Salesforce Diagram Spec**:
A normalized, evidence-bearing description of one Salesforce diagram: its **Salesforce Diagram Family**, **Diagram Grounding**, purpose, nodes, relationships or interactions, and optional observations. It carries meaning and provenance without canvas coordinates or renderer-specific styling.
_Avoid_: tldraw shape JSON, Mermaid source, layout instructions, raw org describe response

**Salesforce Diagram Profile**:
The visual and semantic vocabulary that renders a **Salesforce Diagram Spec** consistently across diagram families. It governs icons, typography, cards, connectors, badges, and annotations without becoming the source of Salesforce facts.
_Avoid_: Salesforce theme, diagram template, Mermaid style, generic whiteboard style

**Salesforce Object Card**:
A Data Model node with a pale object-family fill, a prominent high-contrast **Salesforce Diagram Icon** tile, a logical label, and the physical API name in brackets directly below the label. LDV observations float over the top-right edge and OWD observations float over the bottom-center edge; record types are hidden by default. Field lists appear only when the diagram’s declared scope requires them.
_Avoid_: `API` prefix, inline observation row, default record-type pill, muted icon, field dump, color-only object type

**Salesforce System Card**:
A System/Solution Architecture node with a neutral card, a sourced **Salesforce Diagram Icon**, a clear name, one concise responsibility, and small ownership or boundary badges.
_Avoid_: product-colored tile, capability list, marketing card, unlabeled logo

**Salesforce Relationship Connector**:
A Data Model edge whose integrated vector endpoints express cardinality and optionality and whose center pill names the relationship type. A bar means one, a crow’s foot means many, and full **Cardinality Presentation** can add optionality circles. Endpoint markers sit exactly on the card boundary, mask the underlying line, and share its axis; direct aligned objects use straight connectors while elbow routing is reserved for necessary obstacle avoidance. The field API name appears only when needed to disambiguate otherwise similar relationships.
_Avoid_: detached marker, line through marker, 1/N text, unnecessary elbow, inferred cardinality, unlabeled relationship

**Architecture Connector**:
A labeled System/Solution Architecture edge using one of three meanings: solid directional flow, dashed asynchronous or batch flow, or thin undirected dependency. Separate directional interactions remain separate edges.
_Avoid_: unlabeled arrow, bidirectional shorthand, decorative line, connector catalog

**Profile-Managed Diagram Element**:
A diagram element derived from a **Salesforce Diagram Spec** with stable semantic identity. Profile updates may refresh its content while preserving human placement, and never claim ownership of user-created annotations.
_Avoid_: disposable shape, whole-page ownership, coordinate identity, user annotation

**Cardinality Presentation**:
The Data Model rendering choice between a simplified one/many view and a full physical optionality view. The choice changes visual detail only; it never changes or discards the relationship evidence in the **Salesforce Diagram Spec**.
_Avoid_: schema mode, cardinality inference, logical relationship type

**Diagram Observation**:
A sourced, time-bound fact attached to a diagram element, such as record count, OWD, skew, or query risk. It renders as a compact solid-filled pill above the card layer: LDV at the top-right edge, OWD at the bottom-center edge, and other observations only at profile-defined anchors.
_Avoid_: arbitrary pill position, outline-only pill, buried card text, timeless fact, unsourced warning

**Diagram Evidence Gap**:
A materially relevant Salesforce fact that the current evidence cannot establish. The renderer identifies or omits it according to its significance and never replaces it with a guessed default.
_Avoid_: common default, inferred fact, silent omission, render failure for optional evidence

**Salesforce Diagram Readiness**:
The render is complete only when its spec is valid, it has no structural or layout lints, relationship decorations are anchored to their actual connector terminals within tolerance, and card typography satisfies the profile rhythm. Asset fallbacks and optional evidence gaps remain visible warnings rather than blockers.
_Avoid_: best-effort complete, screenshot-only approval, warning-free claim, assumed edge alignment

**LDV Signal**:
A **Diagram Observation** raised when an observed record count exceeds the diagram’s declared policy threshold, which defaults to two million records. It triggers architectural attention but does not assert that the object or every query is inherently slow.
_Avoid_: Salesforce LDV fact, performance failure, universal platform cutoff

**Salesforce Diagram Icon**:
A redundant visual cue tied to a node’s Salesforce identity and always paired with a visible label. An org-selected object identity takes precedence over a generic category fallback.
_Avoid_: emoji, inferred custom-object icon, icon-only node, decorative product mark

## Example dialogue

Dev: "Open the eval workspace and show me the last result for the billing safety suite."
Agent: "I will open **Agent Script Eval Studio**, locate the **Agent Script Eval Suite** from its local Suite identity, and overlay the newest matching completed **Agent Script Eval Run**. The Scenario list will preserve source order and show the selected Run's recorded and current verdicts."

Dev: "Rerun only the failed cancellation conversation against the same version."
Agent: "I will prepare a Scenario-scope **Agent Script Eval Run**, prefill the historical **Agent Script Eval Run Target** for visible review, and execute the whole **Agent Script Eval Scenario** so its prior-turn state is preserved. This diagnostic Run cannot satisfy the **Agent Script Release Eval Contract**."

Dev: "Add a two-turn scenario that starts verified and proves the confirmation flag changes."
Agent: "I will collect an **Agent Script Eval Authoring Brief** with the user turns, proof goals, and **Agent Script Eval Input Seed**, then hand it to the conversational agent. After you reopen the Studio, the **Agent Script Eval State Timeline** will show the seed, checkpoint, observed state, and delta."

Dev: "Inspect this Lightning Web Component before I change it."
Agent: "I will run an **LWC Component Inspection** as part of the **LWC Lifecycle Loop**. The **LWC Result Card** will summarize the bundle, imports, public API, and tests, while full evidence is saved as **LWC Artifacts**."

Dev: "Run the related LWC test, but don't start a watcher."
Agent: "I will run a bounded **Local LWC Test Run** for the smallest useful test scope. It can execute the local LWC Jest runner, but it will not call Salesforce CLI, install dependencies, or start watch mode."

Dev: "Check this Agent Script before I publish it."
Agent: "I will run an **Agent Script Quality Pass** over the compiler-valid source. The **Agent Script Quality Result** will separate High, Moderate, Low, and Info findings from per-**Agent Script Procedure** metrics such as **Agent Script Cyclomatic Complexity**."

Dev: "The quality pass found a High transition loop, but I need to publish this test version anyway."
Agent: "The **Agent Script Quality Publication Gate** will pause and show the exact rule evidence. If you approve an **Agent Script Quality Publication Override**, it applies only to this bundle and those reviewed High rule IDs for the current session."

Dev: "Run `data360_observe stdm.find_sessions` and show me what happened."
Agent: "That created a **Data 360 Run**. I will return a **Data 360 Run Digest** in context, render a **Data 360 Result Card** for the human, and save the raw SQL/JSON as **Data 360 Artifacts**."

Dev: "Run the tests in Herdr, but don't reuse an old pane."
Agent: "I will plan a **Fresh Ephemeral Lane** for this command-scoped job. If it succeeds, I will clean up the lane; if it fails or times out, I will leave it available for inspection."

Dev: "Draw the Sales Cloud data model."
Agent: "Should the **Diagram Grounding** be Reference, using official Salesforce documentation, or Org, using a named authenticated org? I will build a **Salesforce Diagram Spec** from that evidence and render it with the Data Model **Salesforce Diagram Profile**."

Dev: "Use the org, keep cardinality simple, and flag large objects."
Agent: "I will preserve full relationship evidence in the spec, render simplified **Cardinality Presentation**, and add an **LDV Signal** only when the sourced count crosses the declared threshold. The result is complete only at **Salesforce Diagram Readiness**."
