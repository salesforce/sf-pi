# SF Pi

SF Pi is a bundled set of Salesforce-focused extensions for pi. It exists to make Salesforce development safer, more discoverable, and more agent-friendly inside pi.

## Language

**SF Pi**:
The package-level product that bundles Salesforce-oriented pi extensions.
_Avoid_: sf-pi repo, plugin collection

**Bundled Extension**:
A first-party extension shipped as part of SF Pi and managed through the shared extension catalog.
_Avoid_: plugin, add-on, module

**Manager Surface**:
The user-facing control surface for discovering, enabling, disabling, and configuring bundled extensions.
_Avoid_: admin screen, settings page

**Runtime Surface**:
A way an extension participates in pi during a session, such as a command, tool, provider, event hook, or UI element.
_Avoid_: integration point, hook thing

**SF Brain**:
The Bundled Extension that gives agents compact Salesforce operator guidance and a reference map to the deeper SF Pi and Salesforce resources they should load only when needed.
_Avoid_: Salesforce encyclopedia, all-purpose memory dump

**SF Data 360**:
The Bundled Extension that gives agents a compact, safe Data Cloud / Data 360 workflow surface with discovery, direct REST access, metadata helpers, and readiness checks.
_Avoid_: plugin, MCP wrapper, endpoint dump

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

**SF Pi Reference Map**:
A compact guide that points agents from SF Brain to repo-local sources of truth such as the extension catalog, command reference, extension READMEs, and bundled progressive skills. It may mention active SF skills as a runtime signal, but must not assume user-global skill-library paths.
_Avoid_: duplicated docs, hardcoded personal skill paths, Salesforce encyclopedia

## Relationships

- **SF Pi** contains one or more **Bundled Extensions**.
- A **Bundled Extension** exposes zero or more **Runtime Surfaces**.
- The **Manager Surface** controls the enabled state and configuration entry points for **Bundled Extensions**.
- **SF Brain** is a **Bundled Extension** that provides the **Salesforce Operator Kernel**.
- **SF Brain** routes Data 360 work to **SF Data 360** without embedding Data 360 operation details.
- **SF Data 360** is a **Bundled Extension** with Data Cloud / Data 360 **Runtime Surfaces**.
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
