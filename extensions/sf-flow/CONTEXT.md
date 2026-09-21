# SF Flow

SF Flow provides a lifecycle vocabulary for designing and proving Salesforce Flow automation without conflating local quality, platform validation, deployment, or activation.

## Language

**Flow Family**:
A user-facing category determined by the Flow’s interaction model and trigger, rather than by `processType` alone.
_Avoid_: process type, Flow kind

**Core Flow Family**:
One of the five general-purpose families SF Flow authors: Screen, Autolaunched, Record-Triggered, Schedule-Triggered, or Platform Event-Triggered.
_Avoid_: every Metadata API process type, universal Flow support

**Specialized Flow Family**:
A product-, industry-, orchestration-, approval-, routing-, login-, survey-, marketing-, or Data 360-specific Flow family that SF Flow can identify without claiming general authoring support.
_Avoid_: unsupported Flow, invalid Flow

**Flow Transaction Timing**:
The point at which a Record-Triggered Flow runs relative to the triggering record operation: before save, after save, or before delete.
_Avoid_: trigger mode, optimization mode

**Flow Authoring Blueprint**:
A non-mutating, type-specific design that states the selected **Flow Family**, trigger, inputs and outputs, element sequence, failure strategy, and proof scenarios before source is written.
_Avoid_: generated Flow, deployment plan

**Local Flow Diagnosis**:
Source-located deterministic findings that can be established from one local Flow file without contacting Salesforce.
_Avoid_: compile, deployment validation, deployability

**Flow Topology**:
The directed graph of Flow elements and their normal, decision, loop, and fault connectors.
_Avoid_: canvas coordinates, screenshot

**Check-Only Validation**:
An org-backed Metadata API validation that reports what an exact Flow deployment would accept or reject without saving components.
_Avoid_: dry-run analysis, deployment, activation

**Deployment Readiness**:
The evidence state established only after successful org-backed validation; local diagnosis alone never establishes it.
_Avoid_: locally clean, lint passed

**Targeted Flow Test**:
One explicitly named Flow test or the tests belonging to explicitly named Flows, run without defaulting to every Flow test in the org.
_Avoid_: test suite, all local tests

**Flow Artifact**:
Persisted complete evidence from a Flow lifecycle action, such as diagnostics, topology, validation results, or test reports.
_Avoid_: chat output, source file

**Preventive Flow Quality**:
Type-aware constraints applied before and immediately after initial authoring so common safety, correctness, and performance defects are avoided rather than deferred to review.
_Avoid_: post-deploy lint, quality score

**Rule Behavioral Oracle**:
An independently executed upstream analyzer used only to compare observable rule outcomes; it is not the production owner of a local finding.
_Avoid_: source-code donor, runtime dependency

**Rule Parity**:
Evidence that two independently implemented rules agree on applicability, occurrence, affected element, and meaning across a committed fixture corpus.
_Avoid_: matching rule name, copied message

**Planned Rule Coverage**:
A published rule contract that has no local evaluator yet and is reported as skipped rather than clean.
_Avoid_: disabled rule, passing rule

**Flow Quick Fix**:
A deterministic source transformation bound to an exact diagnosis and source version, limited to changes that don’t invent business behavior.
_Avoid_: autofix everything, generated repair

**Repair Signature**:
A stable identity for the current High and Moderate findings in one Flow file, used to prove that a repair round changed the actionable state.
_Avoid_: finding count, source hash

**Bounded Flow Repair Loop**:
An agent-driven sequence of diagnosis and normal source edits that stops when clean, unchanged, repeated, or at its round limit.
_Avoid_: hidden mutation, retry forever

**Authoring Grounding**:
Bounded read-only evidence from one explicitly selected org that confirms object fields, invocable action contracts, and callable subflow input/output contracts before source is written.
_Avoid_: full org snapshot, inferred schema

**Flow Test Fixture**:
A dedicated public-safe draft Flow and associated Flow test used to prove discovery, queued execution, result polling, and cleanup in a non-production org.
_Avoid_: customer Flow, production test

## Example dialogue

> **Developer:** This Record-Triggered Flow only changes a field on the triggering record.
>
> **Flow expert:** Use before-save **Flow Transaction Timing**. Start with a **Flow Authoring Blueprint**, then write the source and run **Local Flow Diagnosis**.
>
> **Developer:** The local findings are clean. Is it ready to deploy?
>
> **Flow expert:** Not yet. Local cleanliness doesn’t establish **Deployment Readiness**. Run **Check-Only Validation**, then the smallest relevant **Targeted Flow Test**.
>
> **Developer:** How do I review the branching behavior?
>
> **Flow expert:** Inspect the **Flow Topology** and use the complete **Flow Artifact** if the displayed graph is bounded.
