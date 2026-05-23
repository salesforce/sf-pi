# SF Pi

SF Pi is a bundled set of Salesforce-focused extensions for pi. It exists to make Salesforce development safer, more discoverable, and more agent-friendly inside pi.

## Language

**SF Pi**:
The package-level product that bundles Salesforce-oriented pi extensions.
_Avoid_: sf-pi repo, plugin collection

**Git-Installed SF Pi Package**:
The current distribution posture for **SF Pi**: users install the public GitHub repository through pi's package installer rather than consuming a published npm package.
_Avoid_: npm-published package, local-only checkout, private package

**Documentation Site**:
The GitHub Pages-hosted, VitePress-powered public documentation surface for **SF Pi**, sourced from Markdown and generated inventories in the same repository.
_Avoid_: wiki, external docs portal, marketing site

**User-First Documentation**:
The documentation posture where installation, extension value, onboarding tasks, and operator workflows are primary, while contributor, generated, and agent-navigation docs are de-emphasized from the public journey.
_Avoid_: engineering handbook as homepage, generated metadata as primary nav, agent-only docs, equal-audience landing page

**Curated Documentation Layer**:
The small set of hand-authored and generated **Documentation Site** pages that organize existing repo docs for users without moving or duplicating every source Markdown file.
_Avoid_: mirror of every README, docs fork, generated-doc rewrite, metadata-only page list

**Extension Catalog**:
The user-friendly, intent-grouped card catalog that makes the bundled-extension nature of **SF Pi** obvious and lets users browse, compare, and open dedicated pages for each **Bundled Extension**.
_Avoid_: flat generated table only, category-first plugin dump, contributor inventory

**Outcome-First Extension Page**:
A dedicated **Documentation Site** page for a **Bundled Extension** that leads with the user's problem, benefits, first action, and common use cases before reference details.
_Avoid_: metadata-first extension page, source-file-first page, duplicated runtime surface lists

**Docs Navigation Set**:
The first-version **Documentation Site** navigation: Home, Install, Quickstart, Extensions, Commands, Privacy & telemetry, Troubleshooting, and Contributing.
_Avoid_: full README table of contents, one page per extension by default, site-minimal placeholder

**Light Generated Docs**:
The docs-maintenance pattern where factual inventory and extension pages are generated from reviewed public-safe metadata, while narrative guide pages remain hand-authored.
_Avoid_: fully generated site, hand-maintained extension inventory, duplicated command reference, raw README scraping as product copy

**Reference-Inspired Documentation**:
A documentation style choice that borrows proven structure from a public reference site while using SF Pi-specific wording, navigation, examples, and brand treatment.
_Avoid_: cloned docs, copied theme, source-attributed design dependency

**GitHub Pages Publication**:
The deployment path where the **Documentation Site** is built in GitHub Actions and published to the repository's default GitHub Pages URL.
_Avoid_: wiki publishing, manual gh-pages commits, custom domain prerequisite

**SF Pi Docs Theme**:
The **Documentation Site** visual treatment: a friendly, light-first Salesforce developer-console style with crisp text, accessible blue/indigo accents, subtle cloud-like gradients, and restrained code styling.
_Avoid_: copied reference-site colors, washed-out cyan links, terminal-first docs theme, heavy custom component system, logo-dependent theme

**Docs Build Contract**:
The validation expectation that the **Documentation Site** has local npm scripts and is built in CI before public publication.
_Avoid_: Pages-only validation, ad hoc npx builds, unchecked markdown site

**README Quickstart Role**:
The root README remains a complete GitHub-facing quickstart and generated inventory while adding a prominent link to the **Documentation Site** for deeper navigation.
_Avoid_: README replacement, aggressive README migration, contributor-only README

**Source Deep Link**:
An absolute GitHub URL from the **Documentation Site** to detailed repository documentation that lives outside the VitePress source root.
_Avoid_: broken relative Pages link, copied extension README, symlinked docs mirror

**Bundled Extension**:
A first-party extension shipped as part of SF Pi and managed through the shared extension catalog.
_Avoid_: plugin, add-on, module

**Manager Surface**:
The user-facing control surface for discovering, enabling, disabling, and configuring bundled extensions.
_Avoid_: admin screen, settings page

**Runtime Surface**:
A way an extension participates in pi during a session, such as a command, tool, provider, event hook, or UI element.
_Avoid_: integration point, hook thing

**Welcome Splash**:
The SF Pi startup visual surface that introduces the session and summarizes relevant SF Pi runtime status without replacing the normal command or manager surfaces.
_Avoid_: boot logo, decorative header, startup dashboard

**SF Skills HUD**:
The passive floating indicator owned by the SF Skills Bundled Extension that shows skills currently active in the LLM context. Historical skill usage belongs in the command and summary surfaces, not in the persistent HUD.
_Avoid_: skill history panel, permanent session badge, skills manager

**Pi Runtime**:
The upstream pi coding-agent process that hosts SF Pi and provides package loading, settings, skills, extensions, and the terminal UI.
_Avoid_: SF Pi, bundled extension, Salesforce runtime

**Release Freshness**:
The user-visible posture that compares an installed package or runtime version with the latest known release and reports it as current, update-available, or unknown.
_Avoid_: health check, deployment status, security support guarantee

**Policy-Visible Latest**:
The newest release that the user's configured package-manager policy would currently allow SF Pi or the Pi Runtime to install.
_Avoid_: absolute latest, registry latest, upstream latest

**Package-Manager Release-Age Policy**:
A user-configured package-manager rule that delays newly published package versions from being installable until they are old enough.
_Avoid_: update failure, stale install, registry outage

**Cooldown Active**:
The user-facing label for a **Package-Manager Release-Age Policy** that is currently limiting which Pi Runtime release is installable.
_Avoid_: outdated, failed update, blocked registry

**SF Brain**:
The Bundled Extension that gives agents compact Salesforce operator guidance and a reference map to the deeper SF Pi and Salesforce resources they should load only when needed.
_Avoid_: Salesforce encyclopedia, all-purpose memory dump

**SF Pi Extension Context**:
The session-visible summary that tells agents which **Bundled Extensions** are available, which are disabled, and which extension-owned workflow should be considered before generic Salesforce guidance.
_Avoid_: extension catalog replacement, full documentation dump, skill list, plugin memory

**Extension-First Routing**:
The agent behavior where a matching enabled **Bundled Extension** is the primary path for a user's request, while broader skills and raw Salesforce commands are fallback paths.
_Avoid_: disabling skills, tool-only routing, ignoring disabled extensions

**SF Data 360**:
The Bundled Extension that gives agents a compact, safe Data Cloud / Data 360 workflow surface with discovery, direct REST access, metadata helpers, and readiness checks.
_Avoid_: plugin, MCP wrapper, endpoint dump

**SF Data Explorer**:
An experimental UI Bundled Extension for keyboard-first, read-only human exploration of Salesforce data through SOQL, SOSL, and Data 360 SQL. It is a TUI explorer, not an LLM tool and not a replacement for **SF Data 360** capabilities.
_Avoid_: Data 360 capability, agent query tool, write-capable data manager, replacement for SF Data 360

**SF Browser**:
The Bundled Extension that gives agents a compact Salesforce-aware affordance layer for `agent-browser` in last-mile UI work that Salesforce APIs cannot cover.
_Avoid_: generic browser wrapper, Playwright replacement, UI testing framework, browser primitive clone

**Upstream Reference Fallback**:
A public-source fallback posture where agents consult an upstream project for missing reference context, while SF Pi remains responsible for its own runtime surface and user experience.
_Avoid_: runtime fallback, embedded server, hidden dependency

**First-Class Data 360 Parity**:
The product goal that major Data 360 operation families should be represented with clear SF Pi workflows, examples, tests, documentation, and skill guidance rather than only a generic REST escape hatch.
_Avoid_: endpoint dump, hand-written clone of upstream internals, hidden MCP dependency

**Data 360 Skill Pack**:
Extension-owned, phase-first skills that guide agents through Data 360 work while preserving generated family and operation mappings behind the workflow language.
_Avoid_: endpoint-centric skill sprawl, custom skill router, forced prompt injection, disabling unrelated skills

**Data 360 Phase**:
One of the canonical workflow slices for the **Data 360 Skill Pack**: Connect, Prepare, Harmonize, Segment, Act, Retrieve, Observe, or Orchestrate.
_Avoid_: treating endpoint families as the primary user-facing workflow language

**Generated Data 360 Parity**:
A delivery style for **First-Class Data 360 Parity** where repeated family coverage is produced from reviewed source data, while hand-written code stays focused on shared behavior and genuinely distinct workflows.
_Avoid_: hand-written endpoint sprawl, unreviewed mirror, ad hoc family drift

**Runtime Code Budget**:
A maintainability constraint applied to hand-written runtime TypeScript, not to generated or reference artifacts that are reviewed, reproducible, and safe to publish.
_Avoid_: counting generated registry data as feature complexity, LOC reduction by deleting source-of-truth data

**D360 Capability**:
A Data 360 thing SF Pi can help a user do, backed by a registry operation, a local helper, or a deterministic runbook, and executed through one capability execution path. Skills route users and agents to capabilities; they do not execute capabilities themselves.
_Avoid_: capability as a new pi tool by default, capability as a hand-written skill, endpoint-only thinking, separate public execution paths per implementation kind

**D360 Runbook**:
An executable, deterministic, multi-step **D360 Capability** that performs bounded Data 360 calls, joins or summarizes the results, and returns a structured explanation.
_Avoid_: markdown-only orchestration, ad hoc SQL in a skill, untestable workflow recipe

**D360 Example**:
A machine-readable, public-safe input fixture that shows the expected parameter or payload shape for a **D360 Capability**.
_Avoid_: long tutorial prose, customer-specific sample data, replacing executable validation

**D360 Reference Pattern**:
A documented Data 360 query or workflow pattern that guides agents but is not itself an executable, guaranteed **D360 Capability**.
_Avoid_: treating every useful query as TypeScript code, hiding repeated workflows in prose forever

**D360 Execution Explanation**:
A human-visible explanation of a Data 360 capability that shows the endpoint or workflow, parameters, sanitized body, orchestration steps, safety decision, result summary, and raw-output pointer while keeping the LLM-visible result bounded.
_Avoid_: raw response dump, hidden API path, context-heavy transcript

**D360 TDD Contract**:
The expectation that Data 360 behavior changes, generator changes, and refactors start from a failing or protective test/check before production code changes are made.
_Avoid_: implementation-first parity expansion, refactor without characterization, untested generator drift

**D360 Capability Sweep**:
A repeatable validation harness for **D360 Capabilities** that layers local contract tests, dry-run request checks, read-only live checks, and isolated mutation lifecycles against an explicitly targeted Data 360 org.
_Avoid_: one-time exploratory testing, unrecorded destructive probing, treating live org availability as the only correctness signal

**Sweep-Owned Resource**:
A Data 360 asset created by a **D360 Capability Sweep** with a unique run identifier so the sweep can safely update, delete, and verify cleanup without mutating pre-existing org fixtures.
_Avoid_: deleting arbitrary existing assets, relying on shared mutable fixtures, cleanup without ownership proof

**Sweep Coverage Outcome**:
A structured result from a **D360 Capability Sweep** that distinguishes SF Pi regressions from expected org-state conditions such as empty data, feature gating, missing dependencies, or payloads that require a fixture.
_Avoid_: treating every unavailable optional feature as a tool failure, losing skipped/empty context in prose logs

**Family Lifecycle Scenario**:
A sweep-owned live validation path that proves a Data 360 family can perform its representative create, update, run, publish, deactivate, delete, or cleanup behavior without requiring every mutation variant to have a bespoke fixture.
_Avoid_: one-off mutation probes, per-operation fixture sprawl, claiming full live mutation proof from dry-run-only checks

**Sweep-Only Destructive Gate**:
A narrow opt-in that lets a headless **D360 Capability Sweep** execute destructive operations against sweep-owned resources in a disposable target org without weakening the normal interactive guard for user-facing `d360` calls.
_Avoid_: broad headless destructive bypass, deleting resources without ownership checks, making destructive execution the default

**D360 Domain Boundary**:
The boundary that keeps Data 360-specific language, registry behavior, safety interpretation, and workflow explanations inside **SF Data 360**, while shared SF Pi primitives remain generic.
_Avoid_: generic utility sprawl, cross-extension Data 360 coupling, shared modules with extension-specific knowledge

**D360 Performance Budget**:
The expectation that **SF Data 360** pays expensive costs only after user intent is clear: startup and prompt footprint stay strict, while rich Data 360 UX appears through commands, skills, or tool results.
_Avoid_: live startup probes, always-loaded catalogs, verbose always-on skill descriptions, broad inline result dumps

**D360 Fallback Ladder**:
The order for uncovered Data 360 work: use a **D360 Capability**, then `d360_api` with local references, then broader sf-skills or official guidance, and promote repeated fallback paths later.
_Avoid_: hidden automatic retry router, treating sf-skills as a second execution layer, skipping local SF Data 360 references

**Salesforce Operator Kernel**:
The dense, always-available operating rules for safe Salesforce work, including how to choose APIs, verify org state, and avoid guessing live-org details.
_Avoid_: documentation index, Salesforce knowledge base

**SF Browser Guidance**:
Just-in-time guidance that teaches agents how to use `agent-browser` safely and efficiently for Salesforce UI last-mile work without adding an always-on prompt tax.
_Avoid_: always-injected browser kernel, duplicated agent-browser manual, generic browser tutorial

**Browser Evidence**:
A session-scoped private screenshot artifact captured from `agent-browser` that can optionally return a bounded image result for model vision while keeping the full-resolution original on disk.
_Avoid_: trace, recording, visual assertion, unbounded image transcript, screenshot dump

**Targeted Browser Evidence**:
**Browser Evidence** captured after optionally scrolling a known ref into view so screenshots prove the relevant UI section instead of only the page top.
_Avoid_: automatic visual search, screenshot spam, page-top evidence for lower-page assertions

**Browser Evidence Index**:
The lightweight per-session manifest that assigns monotonically increasing IDs to **Browser Evidence** artifacts.
_Avoid_: screenshot database, trace store, media library

**Browser Evidence Latest Pointer**:
A compatibility reference from the legacy latest evidence location to the current session's **Browser Evidence** directory.
_Avoid_: duplicate screenshot store, canonical evidence location, cross-session audit log

**Lazy Browser Runtime**:
An external browser automation dependency that **SF Browser** detects and invokes only after explicit command or tool intent, never during SF Pi startup.
_Avoid_: bundled browser engine, startup probe, auto-installed dependency

**SF Browser Session**:
The default named `agent-browser` session used by **SF Browser** to keep browser state stable across turns.
_Avoid_: per-tool browser launch, per-org browser profile, hidden browser pool

**Frictionless Browser Operation**:
The v1 **SF Browser** posture that adds Salesforce-aware browser tools and passive redaction/storage hygiene without permission gates or semantic action mediation.
_Avoid_: permission gate, click guardrail, production browser blocker, semantic browser guardrail

**Hot-Path Browser Tool Set**:
The small typed **SF Browser** tool surface that covers the common `agent-browser` loop without pursuing feature parity with `agent-browser`.
_Avoid_: browser primitive clone, workflow DSL, full CDP surface, Selenium-style driver API

**Salesforce Browser Contract**:
The tool and guidance rules that teach agents Salesforce UI behavior while keeping **SF Browser** mechanically thin.
_Avoid_: browser framework, DOM abstraction, workflow automation layer

**Ambient Overlay Dismissal**:
A best-effort **SF Browser** behavior that closes known non-workflow Salesforce overlays before evidence capture or explicit cleanup without dismissing task-relevant modals.
_Avoid_: modal auto-confirmation, workflow cancellation, popup blocker, destructive dialog handling

**Setup Destination**:
A curated public-safe shortcut from a stable name to a Salesforce Setup path used by **SF Browser** to avoid brittle search-and-click navigation.
_Avoid_: full Setup sitemap, live menu scraper, arbitrary natural-language setup search, org-specific shortcut

**Salesforce Path Resolver**:
A deterministic **SF Browser** helper that turns structured Salesforce route intent into a Lightning or Setup path without using UI search.
_Avoid_: arbitrary natural-language navigator, Setup sitemap, live menu scraper, hidden click path

**Path Resolution Clarification**:
A human choice requested only when bounded fuzzy matching finds multiple plausible **Setup Destinations**.
_Avoid_: mutation approval, safety gate, hidden best-guess navigation, generic setup search

**Pi-Native Browser Snapshot**:
An **SF Browser** snapshot result that stores the full `agent-browser` output as an artifact while sending only a compact decision-oriented summary to the LLM by default.
_Avoid_: context dump, raw accessibility tree by default, screenshot replacement, lossy-only snapshot

**Smart Snapshot Summary**:
A structured **Pi-Native Browser Snapshot** that classifies Salesforce UI state into page, Lightning state, surface, alert, action, navigation, and table sections while suppressing global browser/setup chrome by default.
_Avoid_: raw line filter, full accessibility dump, screenshot-only reasoning

**Browser Operation Duration**:
A user-visible elapsed-time signal included in **SF Browser** results so humans can understand browser automation cost and compare optimized workflows.
_Avoid_: performance benchmark, SLA, profiling trace

**Setup Runbook**:
A documented, stable, repeatable **SF Pi** workflow for a common Salesforce setup or admin task that defines the preferred API or extension path, the **SF Browser** evidence path, and the **UI Fallback Path**.
_Avoid_: raw click script, browser-only admin automation, arbitrary UI macro, full Setup automation framework

**API-First Browser-Ready**:
The **SF Pi** setup posture where stable APIs or owning extensions are preferred for mutation and verification, while **SF Browser** maintains reliable UI evidence and fallback paths for the same task.
_Avoid_: browser-only setup, API-only optimism, click-first automation

**UI Fallback Path**:
The **SF Browser** portion of a **Setup Runbook** that describes how to complete or verify the task through stable Salesforce UI navigation when the primary API or extension path fails or is unavailable.
_Avoid_: primary path, arbitrary click script, unsupported workaround

**UI Mutation Fallback**:
A browser-driven Salesforce setup or configuration change performed only when a stable API, metadata, or data path is unavailable, unverified, or insufficient for the requested task.
_Avoid_: default mutation path, arbitrary click script, browser-first setup, hidden UI change

**Mutation Evidence**:
Session-scoped before-and-after browser state plus optional Setup Audit Trail context captured around a **UI Mutation Fallback**.
_Avoid_: human approval, permission gate, full audit system, hidden mutation log

**Classic Setup Surface**:
A Salesforce Setup page rendered inside the Lightning Setup shell with classic-style iframe behavior, form posts, dual-list controls, and validation messages that require **SF Browser** fallback patterns different from standard Lightning UI.
_Avoid_: legacy page, iframe hack, old UI, unsupported surface

**UI Fallback Recovery**:
The part of a **UI Fallback Path** that returns the browser to a known safe page after a validation error, stale form, timeout, or ambiguous **Classic Setup Surface** state.
_Avoid_: blind retry, Cancel-only recovery, keep clicking, ignore validation

**Ambiguous Wait**:
A browser wait result whose elapsed duration or output suggests the expected condition may not have matched, even though the underlying runtime did not return a hard failure.
_Avoid_: success, completed, reliable wait, hidden timeout

**Lightning-Aware Wait**:
A named **SF Browser** wait for Salesforce Lightning semantic state such as app readiness, record view, modal state, toast visibility, spinner completion, or save outcome.
_Avoid_: bare sleep, DOMContentLoaded-only readiness, generic network idle, hidden compound step

**SF Pi Reference Map**:
A compact guide that points agents from SF Brain to repo-local sources of truth such as the extension catalog, command reference, extension READMEs, and bundled progressive skills. It may mention active SF skills as a runtime signal, but must not assume user-global skill-library paths.
_Avoid_: duplicated docs, hardcoded personal skill paths, Salesforce encyclopedia

**Critical-Path Gateway Model**:
A model served through the SF LLM Gateway whose usage and regression risk justify targeted live confidence checks in addition to unit and type checks when gateway routing or transport behavior changes.
_Avoid_: every available gateway model, benchmark target, broad live-test suite

## Relationships

- **SF Pi** is currently distributed as a **Git-Installed SF Pi Package**.
- **SF Pi** publishes a **Documentation Site** from the same repository as its source code and hand-authored docs.
- The **Documentation Site** follows **User-First Documentation**.
- The **Documentation Site** uses a **Curated Documentation Layer** over the existing Markdown and generated inventory sources.
- The **Curated Documentation Layer** is expressed through the **Docs Navigation Set**.
- The **Documentation Site** has an **Extension Catalog** with one **Outcome-First Extension Page** per **Bundled Extension**.
- The **Documentation Site** uses **Light Generated Docs** for extension and command inventory.
- The **Documentation Site** follows **Reference-Inspired Documentation** rather than cloning another project's content or visual identity.
- The **Documentation Site** is published through **GitHub Pages Publication**.
- The **Documentation Site** uses the **SF Pi Docs Theme**.
- The root README keeps the **README Quickstart Role** after the **Documentation Site** is introduced.
- The **Documentation Site** uses **Source Deep Links** for detailed docs outside `docs/`.
- The **Documentation Site** follows the **Docs Build Contract**.
- **SF Pi** contains one or more **Bundled Extensions**.
- A **Bundled Extension** exposes zero or more **Runtime Surfaces**.
- The **Welcome Splash** is a **Runtime Surface** owned by a **Bundled Extension**.
- The **Welcome Splash** may summarize **Release Freshness** for **SF Pi** and the **Pi Runtime** without becoming an update manager.
- **Pi Runtime** **Release Freshness** should compare against the **Policy-Visible Latest** release when a **Package-Manager Release-Age Policy** is configured.
- A **Package-Manager Release-Age Policy** is detected through the effective package-manager cutoff, preferring `before` when available and falling back to release-age settings when necessary.
- A **Package-Manager Release-Age Policy** applies to **Pi Runtime** update reporting and runtime diagnostics, not to Git-based **SF Pi** update nudges.
- **Cooldown Active** explains why **Pi Runtime** may be current against the **Policy-Visible Latest** while a newer absolute release exists; it should not appear when no newer absolute release is being filtered.
- If a **Package-Manager Release-Age Policy** is detected but **Policy-Visible Latest** cannot be computed, **Pi Runtime** **Release Freshness** should degrade to unknown instead of reporting update-available from the absolute latest.
- The **SF Skills HUD** is a **Runtime Surface** owned by the SF Skills Bundled Extension.
- The **Manager Surface** controls the enabled state and configuration entry points for **Bundled Extensions**.
- **SF Brain** is a **Bundled Extension** that provides the **Salesforce Operator Kernel**.
- **Critical-Path Gateway Models** use small, gated live confidence checks only when gateway transport behavior changes; this does not make every gateway model part of a broad live-test suite.
- **SF Brain** routes Data 360 work to **SF Data 360** without embedding Data 360 operation details.
- **SF Data 360** is a **Bundled Extension** with Data Cloud / Data 360 **Runtime Surfaces**.
- **SF Browser** is a **Bundled Extension** with browser **Runtime Surfaces** backed by `agent-browser`.
- **SF Browser** owns Salesforce context, safe org opening, artifact handling, and guidance; `agent-browser` owns generic browser execution.
- **SF Browser** exposes a small v1 **Runtime Surface**: one cache-first `/sf-browser` command panel and a **Hot-Path Browser Tool Set**.
- **SF Browser Guidance** is surfaced through SF Brain routing, SF Browser command/tool results, and optional progressive skills rather than an always-injected context block.
- **Browser Evidence** is session-scoped and artifact-first: repeated captures reference stored files for the current session, while model-visible images are explicit and size-bounded.
- **Browser Evidence** uses a **Browser Evidence Index** for the session and no automatic cleanup.
- A **Browser Evidence Latest Pointer** may preserve quick access to the current session's evidence without duplicating screenshots.
- **Targeted Browser Evidence** uses explicit refs for scroll targeting; focus-to-scroll remains a future design choice.
- `agent-browser` is a **Lazy Browser Runtime** for **SF Browser**.
- **SF Browser** v1 uses one default **SF Browser Session** instead of per-org or per-conversation browser sessions.
- **Frictionless Browser Operation** keeps v1 free of browser-action permission prompts while preserving passive hygiene for URLs and artifacts.
- The **Hot-Path Browser Tool Set** wraps only `open`, `snapshot`, `click`, `fill`, `select`, `press`, `wait`, and Browser Evidence capture; advanced browser work remains direct `agent-browser` usage.
- **Salesforce Browser Contracts** cover stale refs, Lightning rerenders, Setup navigation, lookup and combobox flows, iframe surfaces, and API-first verification through tool descriptions, tool results, help, and optional progressive skills.
- **Ambient Overlay Dismissal** is scoped to known non-workflow overlays and is appropriate for Browser Evidence cleanup before it is used around general click/fill flows.
- A **Setup Destination** is intentionally curated and small; direct Salesforce Setup paths are preferred over UI search when the destination is known.
- A **Salesforce Path Resolver** may support bounded fuzzy matching only within curated **Setup Destinations**, using **Path Resolution Clarification** instead of guessing when multiple destinations are plausible.
- A **Pi-Native Browser Snapshot** separates model context from raw browser state: summary by default, artifact for full fidelity, and explicit full output only when requested.
- A **Smart Snapshot Summary** includes human-readable sections, lightweight icons, the current page URL, and structured Lightning state so agents and humans can quickly understand where they are and what matters.
- **Browser Operation Duration** is reported in SF Browser tool results for user confidence; it is not treated as a formal performance benchmark.
- A **Setup Runbook** records primary execution, evidence, and fallback paths so **SF Pi** stays **API-First Browser-Ready** instead of API-only or browser-only.
- A **UI Fallback Path** should be hardened through repeated navigation, evidence capture, and documented edge cases, but it should not replace a stable primary API or owning extension path.
- A **UI Mutation Fallback** stays frictionless in the browser tool layer; **Mutation Evidence** provides transparency without human-in-the-loop confirmation.
- **Mutation Evidence** is captured through normal **Browser Evidence** with clear before/after labels, should be auditable by session, and should surface Setup Audit Trail context when requested and available.
- A **Classic Setup Surface** often needs `select` plus Add/Remove controls, API verification after save, and direct navigation recovery after validation failures.
- **UI Fallback Recovery** captures the failure, verifies state through APIs when possible, then navigates to a known safe destination before retrying.
- An **Ambiguous Wait** should prompt snapshot/API verification instead of being reported as an unconditional success.
- A **Lightning-Aware Wait** keeps browser operations composable while avoiding repeated ad hoc Lightning readiness heuristics.
- **First-Class Data 360 Parity** guides how **SF Data 360** expands its workflow coverage.
- **Generated Data 360 Parity** is the preferred delivery style for broad **First-Class Data 360 Parity**.
- A **Runtime Code Budget** constrains hand-written **Runtime Surfaces**, not generated parity data.
- A **D360 Capability** is discovered and executed through SF Data 360 **Runtime Surfaces**.
- A **D360 Runbook** backs deterministic multi-step **D360 Capabilities**.
- A **D360 Example** documents the input shape for a **D360 Capability**.
- A **D360 Reference Pattern** can be promoted into a tested **D360 Runbook** when it becomes repeated and high-value.
- A **D360 Execution Explanation** makes **SF Data 360** transparent to humans without expanding the LLM transcript unnecessarily.
- The **D360 TDD Contract** governs changes to **SF Data 360**.
- A **D360 Capability Sweep** operationalizes the **D360 TDD Contract** for broad **First-Class Data 360 Parity**.
- A **D360 Capability Sweep** may mutate **Sweep-Owned Resources** while preserving pre-existing org fixtures.
- A **D360 Capability Sweep** reports **Sweep Coverage Outcomes** so true SF Pi regressions are separated from org-state limitations.
- **Family Lifecycle Scenarios** provide representative live mutation proof for broad **D360 Capability** families.
- A **Sweep-Only Destructive Gate** enables repeatable lifecycle cleanup without weakening normal user-facing destructive safeguards.
- The **D360 Domain Boundary** protects **SF Data 360** from leaking domain-specific behavior into generic shared code.
- The **D360 Performance Budget** keeps **SF Data 360** strict at startup and rich after intent.
- The **D360 Fallback Ladder** governs uncovered Data 360 work.
- A **Data 360 Skill Pack** supports **First-Class Data 360 Parity** through progressive disclosure.
- A **Data 360 Skill Pack** is organized by **Data 360 Phase**.
- An **Upstream Reference Fallback** can inform a **Bundled Extension** without becoming one of its **Runtime Surfaces**.
- The **Salesforce Operator Kernel** points to the **SF Pi Reference Map** when deeper routing context is needed.

## Example dialogue

> **Dev:** "Should this new Salesforce helper be another **Bundled Extension**?"
> **Domain expert:** "Only if it has a clear **Runtime Surface** and users should be able to manage it through the **Manager Surface**."

## Flagged ambiguities

- "plugin" is ambiguous because pi calls them extensions; resolved: use **Bundled Extension** for SF Pi-owned extensions.
- "brain" could mean an all-purpose knowledge base; resolved: **SF Brain** stays compact and routes to the **SF Pi Reference Map** instead of loading broad Salesforce content eagerly.
- "GitHub documentation link" could mean a wiki, README-only docs, or a static site; resolved: use **Documentation Site** for the VitePress/GitHub Pages surface.
- "like Peekaboo" could mean copied content/theme or structural inspiration; resolved: use **Reference-Inspired Documentation** with SF Pi-specific branding.
