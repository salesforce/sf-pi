# SF Flow Agent Guide

Use `sf_flow` for the Flow-specific lifecycle. Normal Pi file tools own `.flow-meta.xml` edits. SF Flow owns explicit one-Flow status, activation, and deactivation actions; it does not provide general metadata deployment or arbitrary Flow execution.

## Behavior-proof-first loop

1. Use `project.scan` to locate checked-in Flows or `author.plan` to select a supported Flow family. Pass `target_org` only when object fields, action contracts, subflow inputs/outputs, or Omni-Channel routing choices must be grounded in that org. When `workspace` is supplied, file actions resolve paths relative to that explicit SFDX project instead of Pi's current directory.
2. Use `flow.inspect` to understand an existing Flow’s family, trigger, elements, connectors, and Mermaid topology.
3. Reproduce the intended behavior with a Flow test when one already exists and the defect is testable before editing.
4. Edit source with normal Pi file tools. Fast local diagnostics run automatically after successful Flow writes/edits.
5. Run `diagnose.file` explicitly with the `generation` profile during authoring and resolve High findings first. Use `review` for the broader implemented set. Treat skipped coverage as unknown, not clean.
6. Use `quality.rules` when rule status, profile membership, provenance, or planned coverage matters.
7. When diagnosis returns a safe quick fix, pass its exact `fix_id` and `source_version` to `fix.apply`. Re-diagnose after any normal business-logic edit instead of reusing a stale fix.
8. Run `validate.check` against the intended org. It validates one exact Flow with Metadata API `checkOnly=true` and saves nothing.
9. Use `lifecycle.status` for canonical REST state. Use `deploy.activate` to stage, check, deploy, and verify one local Flow without changing its checked-in status; use `lifecycle.activate` only with an exact existing version number; use `lifecycle.deactivate` for deterministic `activeVersionNumber=0` cleanup. Never invent `sf flow activate` or delegate lifecycle verification to generic Tooling SOQL.
10. Use `test.plan` and `test.run` for the smallest relevant Flow or Flow test. Poll queued runs with `test.result`; use `test.rerun` only for the prior session-scoped target. Discovery is bounded and reads each selected FlowTest's Tooling API `Metadata` field in a separate single-row query. Runs submit asynchronously even when a wait is requested; SF Flow polls before fetching results. A skipped, aborted, failed, or zero-test terminal result is failed evidence, never a pass.

## Core Flow Family selection

- **Screen**: the process collects or displays information to a user. Validate input, avoid database writes before the first screen, and prevent backward navigation across irreversible actions.
- **Autolaunched**: another automation, API, or application invokes reusable background logic. Define explicit input/output variables and design retries to be idempotent.
- **Record-Triggered**: a record operation starts the Flow. Use before-save for same-record field updates; use after-save for related records or actions that require a committed record; use before-delete only for pre-deletion behavior.
- **Schedule-Triggered**: a global date/time schedule starts batches of matching records. Use selective criteria and idempotent processing.
- **Platform Event-Triggered**: an event message starts the Flow. Filter carefully, handle duplicate delivery, prevent self-publishing loops, and do not plan a Subflow element.

## Supported specialized family selection

- **Omni-Channel**: a service channel launches a `RoutingFlow` to route one work item. Define `recordId` as a scalar Text input, ground the service channel and destination in the target org, and use Omni action version 2.0.0 for new metadata. Supported destinations are queue, direct agent with a required fallback queue, and target-org skills-based routing rules. `omni_check_availability=true` adds a matching availability check, guarded fault/no-capacity path, and `reasonForNotRouting`; `omni_no_route=true` adds a caller-controlled intentional no-route branch. Generated source uses caller-supplied IDs so it remains public-safe and portable; bind them through the owning channel configuration rather than committing org-specific IDs.

If intent does not establish a supported Flow family or record transaction timing, call `author.plan` without guessing and use its clarification choices. “Route a record to a queue” alone is ambiguous; choose Omni-Channel only when a service channel or Route Work owns the launch.

## Org-grounding boundary

With `target_org`, `author.plan` reads only bounded object/event describe data, matching invocable action details, matching autolaunched subflow variable contracts, or destination-relevant Omni-Channel service-channel, queue, routing-configuration, skill, and active-agent choices. Missing permissions or endpoint failures become explicit grounding gaps. Grounding never mutates the org and never runs automatically after file edits.

Do not treat an unmatched action or subflow as proof that it is unavailable when coverage reports a gap or bounded truncation. Use the returned field/action/subflow contracts instead of inventing API names or inputs.

## Cross-family authoring patterns

- Plan the business process before writing metadata.
- Use descriptive labels, API names, and descriptions.
- Never hard-code Salesforce record IDs.
- Collect database changes in loops and perform one database operation afterward.
- Add fault paths to database and action elements that can fail.
- Keep reusable subflows small with explicit inputs and outputs; confirm that the caller supports Subflow and that the referenced version is appropriate. A child intended for a Subflow element must be a true no-trigger autolaunched Flow: omit `<triggerType>` rather than writing `<triggerType>None</triggerType>`, which can validate and deploy but fails at runtime as a triggered Flow.
- Treat running context and data access as part of the design, especially for screen/autolaunched flows and scheduled paths.
- Test branches, negative criteria, bulk behavior, retries, and failure paths.
- For an `AsyncAfterCommit` scheduled path, omit label and time-offset fields and configure the record trigger to run only when the record changes to meet the entry criteria (or use an applicable Is Changed condition). Draft check-only validation can accept a definition that active deployment rejects without this transition guard.
- Apex tests do not execute asynchronous-after-commit paths. Prove that path with a bounded real record transaction and resulting-state poll in a dedicated non-production org, then remove the evidence records. A 200-record committed update can fan out to 200 asynchronous interviews; assert one unique outcome per source record, not a guessed batch size.
- A schedule-triggered Flow with no `maxBatchSize` uses the platform default, whose maximum is 200. A 201-record proof must show each record once and must not assert partition sizes or globally unique batch indexes. Release 262 can set `maxBatchSize` from 1 to 200 on a schedule-triggered start when the Flow runtime is API 63.0 or later; that field remains illegal on an `AsyncAfterCommit` path.
- Explicit `triggerOrder` is deterministic within before-save and within after-save. Equal or omitted `triggerOrder` must be treated as unspecified: assert that every Flow ran, not that one sequence won.
- API 67 metadata rejects `faultConnector` on a Subflow element. Handle a failing element inside the child Flow. An unhandled nested fault fails the parent interview and rolls back that interview's records; a handled inner fault commits and must not be treated as the success output.
- A child with `<triggerType>None</triggerType>` can validate and still fail when a Subflow element launches it. Omit `triggerType` for a callable autolaunched child. Do not add a generation rule that requires a Subflow fault connector until the target API accepts that metadata.
- A Create Records element cannot combine `assignRecordIdToReference` with `storeOutputAutomatically`; choose the exact output contract needed by downstream elements.
- API 67 Create Records upsert uses `doesUpsert`, `doesUpsertAllOrNone`, `inputReference`, and `upsertExternalIdField`. When collection upsert allows partial success, valid members persist but any failed member still sends the element through its fault connector; a fault outcome does not imply complete rollback.
- Transform Count and Sum actions use `aggregationValues`; Sum also uses `aggregationField`. A Transform `InnerJoin` stores relative join keys and selected fields in a `JoinDefinition`, then maps joined fields through `LeftTable` and `RightTable` transform-value references. Related-record traversal isn't a substitute for nested data: preserve equal collection depth with supported Apex-defined nested values.
- A committed `WaitDuration` interview can be invoked through the Flow Action REST surface, observed through `FlowInterview`, and verified after automatic resume. Prove both the Paused state and the absence of the interview after its resumed path completes, then remove any evidence records.
- Roll Back Records is accepted in a Screen Flow but rejected in an Autolaunched Flow at API 67. `Flow.Interview.start()` also refuses Screen Flows, so prove rollback runtime through an explicit browser/UI path and verify the rolled-back records through an API read. Metadata validation or activation alone does not prove rollback behavior.

### Action authoring contracts

- Ground actions against the target org before authoring. Standard and custom action indexes can be hierarchical; Quick Actions and Email Alerts are grouped by object, while External Services, Apex actions, and Run Agent actions expose their own categories.
- For a caller-launched autolaunched Flow, omit `<triggerType>` entirely. An explicit `<triggerType>None</triggerType>` is unnecessary and can cause external Flow scanners to misclassify callout actions as synchronous record-trigger callouts.
- Use `actionType=quickAction` with the object-qualified Quick Action name. For object-specific create actions, pass the parent record through the grounded `contextId` input; Draft check-only validation can miss a missing parent context that Active validation rejects.
- Use `actionType=emailAlert` with the object-qualified Workflow Alert name and pass its grounded `SObjectRowId` input.
- Use `actionType=externalService` with `<registration API name>.<operationId>`. Capture `responseCode` and model any generated Apex response class only when downstream logic needs the response body.
- A Named Credential-backed Apex action should use a `callout:` endpoint and `@InvocableMethod(callout=true)`, preserve one output per request, and return per-item errors. Production integrations should prefer modern secured Named Credentials with explicit principal access; a no-authentication public probe can use an anonymous legacy Named Credential when the target org rejects a no-authentication External Credential.
- Run Agent actions use `actionType=generateAiAgentResponse`, require `userMessage`, optionally accept `sessionId`, and return `agentResponse` plus `sessionId`. Ground and bind the org-specific action name at execution time rather than committing it to public source.
- Complex Invocable Apex contracts can expose scalar, sObject, and collection inputs and outputs. Verify the live action describe (`type`, `required`, and `maxOccurs`) and prove bulk cardinality independently from the calling Flow.

## Preventive quality

`author.plan` compiles family-applicable generation constraints from the data-first quality catalog. The post-edit hook runs the same generation profile locally. High and Moderate findings are repair guidance; no rule silently mutates source.

Lightning Flow Scanner-inspired rules are independent SF Pi implementations. The pinned upstream package runs only in dev parity tests. Use `QUALITY_RULES.md` and `THIRD_PARTY_NOTICES.md` for provenance and coverage.

## Repair-loop boundary

Automatic edit feedback is progress-gated and bounded to three actionable rounds per file. It stops on clean source, a repeated finding signature, or the round limit. High and Moderate findings can steer; Low and Info findings remain available through explicit diagnosis.

The only mutating lifecycle action is `fix.apply`, and it owns exactly three deterministic transformations: project API version, Auto-Layout metadata, and exact unused-variable removal. Every fix is bound to a SHA-256 source version and participates in Pi's per-file mutation queue. All other repairs use normal Pi file tools.

## Activation and deactivation

`lifecycle.status` reads `FlowDefinitionView` and `FlowVersionView` through the standard REST query surface. It does not use Tooling API queries. `deploy.activate` stages an isolated Active copy of one local Flow, runs generation diagnostics and Active check-only validation, performs the guarded deployment, and verifies the resulting active version. The checked-in source is unchanged. `lifecycle.activate` requires an exact positive version and never guesses latest.

Mutating lifecycle actions require explicit `target_org` plus `allow_mutation=true`, remain Guardrail-mediated, and refuse production or unknown orgs. The execution-intent flag is not approval.

Deploying the same Flow source with `<status>Draft</status>` creates or updates a Draft version but does **not** clear the already active version. `lifecycle.deactivate` deterministically deploys a `FlowDefinition` component equivalent to:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">
    <activeVersionNumber>0</activeVersionNumber>
</FlowDefinition>
```

The lifecycle action performs this cleanup loop:

1. Read the exact Flow definition through REST.
2. Run Metadata API check-only validation for the one `FlowDefinition` component.
3. Deploy the component after Guardrail approval.
4. Query `FlowDefinitionView` and require `IsActive=false` plus `ActiveVersionId=null`.
5. For schedule-triggered Flows, query `CronTrigger` by Flow job name and require zero remaining rows.

Verify fixture records, logs, trace flags, and other temporary runtime state separately. Never report cleanup complete from a successful Draft Flow deployment alone.

## Evidence boundaries

- `diagnose.file` proves only the small local deterministic rule set.
- `validate.check` proves how the selected org validates the exact staged Flow at that time; it does not save the Flow.
- `deploy.activate` and `lifecycle.activate` prove activation only after successful check-only, deployment, and REST resulting-state verification; they do not prove business behavior.
- `lifecycle.deactivate` proves inactive Flow definition state and scheduled-job cleanup, not cleanup of business records or external side effects.
- `test.run` proves only the explicitly selected org Flow tests. Do not assume a Flow test can reproduce service-channel routing context.
- Omni-Channel check-only validation proves metadata acceptance, not creation of `PendingServiceRouting` or `AgentWork`. A controlled non-production routing scenario is required for runtime proof. Assert PSR preferred-user/fallback behavior for direct routing and assert both a non-empty `reasonForNotRouting` and zero PSRs for an unavailable path. `AgentWork` requires an eligible online presence and must not be expected from an offline test user. Skills runtime is not green evidence when the target has no skills-based routing rules. Agentforce STDM is supplementary evidence only when an Agentforce session participates.
- A Mermaid topology is a graph projection, not proof that Flow Builder accepts the metadata.
- Use `code_analyzer` for broad Flow static analysis. Use `sf_apex` when Flow invokes Apex and Apex behavior needs proof. Use `sf_soql` for schema evidence not established by validation.

## Mermaid topology

SF Flow keeps the Result Card compact and appends bounded topology as a top-level Mermaid block on the next final assistant message. Pi’s native Markdown renderer displays the diagram outside the tool tile and respects the user’s Mermaid rendering setting. Nodes lead with architectural verbs such as START, GET, DECISION, FOR EACH, SET, CREATE, UPDATE, SCREEN, ACTION, and SUBFLOW; relevant object, filter, collection, or assignment detail is folded into the node instead of rendering raw resources as boxes. Normal edges are solid, edges entering durable Create/Update/Delete operations are thick, decision outcomes and loop phases are labeled, and fault edges are dotted. Pi’s terminal renderer supplies theme colors by semantic class: muted borders, normal node text, accent edges and arrowheads, and muted edge labels. Browser-only Mermaid `classDef`, `style`, fill colors, per-node text colors, and Markdown bold in labels are intentionally not emitted because Pi’s terminal renderer ignores them. Uppercase verbs and node shapes carry the visual hierarchy instead. The displayed graph includes up to 100 executable elements, staying below Pi’s native 128-node Mermaid parser ceiling. The persisted `.mmd` Flow Artifact contains the complete executable topology when the display is bounded; use it when the graph is too wide, unsupported, or native Mermaid rendering is disabled.
