---
id: "0114"
status: accepted
date: 2026-09-18
---

# ADR 0114: SF Flow is a lean Flow Lifecycle Extension

## Context

SF Pi needs a first-party Salesforce Flow workflow that helps agents select the correct Flow family, inspect and diagnose local metadata, establish org-backed validation evidence, run targeted Flow tests, and explain graph structure without becoming a second Flow Builder, a broad static-analysis engine, or a deployment manager. The Metadata API exposes many specialized process and trigger values, but claiming equal authoring proficiency across all of them would conflict with a lean, evidence-backed first release.

## Decision

`sf-flow` is a lean **Flow Lifecycle Extension** with one `/sf-flow` command and one `sf_flow` family tool. Normal Pi file tools own `.flow-meta.xml` source changes. V1 owns `status`, `org.preflight`, `project.scan`, `flow.inspect`, `author.plan`, `diagnose.file`, `validate.check`, `test.discover`, `test.plan`, `test.run`, `test.result`, and `test.rerun`.

V1 authors five general-purpose **Core Flow Families**: Screen, Autolaunched, Record-Triggered, Schedule-Triggered, and Platform Event-Triggered. It can identify other process and trigger values but does not claim authoring support for specialized orchestration, approval, login, routing, survey, marketing, Data 360, or industry families. `author.plan` returns a non-mutating, type-specific **Flow Authoring Blueprint** and a minimal metadata skeleton; it infers a family only when the intent is unambiguous.

`diagnose.file` uses a small extension-local, position-aware correctness analyzer rather than importing a complete external analyzer or generated Metadata API schema. The local checks cover core metadata, core family consistency, names, connectors, reachability, local references, record context, database operations in loops, fault paths, and the officially documented before-save element restriction. Unknown or specialized semantics are disclosed as coverage gaps rather than guessed. Salesforce Code Analyzer remains the owner of broad Flow static analysis.

`validate.check` stages one exact local Flow and runs API-native Metadata API check-only validation through the shared Salesforce connection and Salesforce Source Deploy Retrieve libraries. It never saves or activates metadata. Flow tests use the public Salesforce test service with the Flow category and are limited to explicit Flow names or test names; V1 does not default to all-org tests or expose Flow test suites.

Every action returns a normalized **Flow Run Digest** rendered as a compact **Flow Result Card**. Flow structure is stored as Mermaid source and rendered as terminal Unicode with the same small renderer library used by Pi. Narrow or unsupported diagrams fall back to a bounded outline, and complete `.mmd` source is persisted as a **Flow Artifact**. Model-facing text remains compact.

## Consequences

- Module load and session startup perform no project scan, org probe, network call, or subprocess.
- Successful Flow file edits receive fast local diagnostics only; org validation and tests remain explicit.
- Local cleanliness and check-only validation are separate evidence states; local analysis never implies deployment readiness.
- Deployment, activation, Flow execution, a full-screen editor, LSP/VS Code packaging, broad rule configuration, and AI-backed generation services are outside V1.
- Runtime dependencies for XML validation and Mermaid rendering are explicit, small, public, and independently versioned rather than imported through Pi’s private module paths.
