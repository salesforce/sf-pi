# SF Flow

## What It Does

SF Flow is a lean lifecycle extension for Salesforce Flow metadata. It helps agents choose a general-purpose Flow family, inspect and diagnose local source, validate one exact Flow without saving it, explicitly activate or deactivate one Flow with resulting-state verification, run targeted Flow tests, and present graph structure as Mermaid-backed terminal diagrams.

Normal Pi `read`, `write`, and `edit` tools own source changes. SF Flow owns only the explicit one-Flow lifecycle operations below; it is not a general metadata deployment surface.

## Core Flow Families

V1 provides authoring blueprints for:

1. Screen Flow
2. Autolaunched Flow
3. Record-Triggered Flow, including before-save, after-save, and before-delete timing
4. Schedule-Triggered Flow
5. Platform Event-Triggered Flow

Other Metadata API process and trigger values are reported as specialized. SF Flow can inspect their common graph shape but does not claim type-specific authoring proficiency for them.

## Lifecycle

Use the `sf_flow` family tool:

```text
status, org.preflight
project.scan, flow.inspect, author.plan, diagnose.file, quality.rules
fix.apply
validate.check
lifecycle.status, deploy.activate, lifecycle.activate, lifecycle.deactivate
test.discover, test.plan, test.run, test.result, test.rerun
```

The intended loop is:

1. Run `author.plan` or `flow.inspect` to establish the Flow family and structure.
2. Edit `.flow-meta.xml` with normal Pi file tools.
3. Run `diagnose.file` until deterministic local findings are resolved. It returns the exact source version and any safe source-bound quick fixes.
4. Apply only a current `fix.apply` result when API version, Auto-Layout, or unused-variable cleanup is appropriate. Business logic remains with normal Pi edits.
5. Run `validate.check` against the intended org. This is a one-file Metadata API check-only operation and saves no metadata.
6. Use `lifecycle.status` for read-only REST state. When explicitly requested, use `deploy.activate` for one local Flow, `lifecycle.activate` for one exact existing version, or `lifecycle.deactivate` for deterministic cleanup.
7. Run the smallest relevant targeted Flow test when an eligible Flow test exists in the org.

A successful local diagnosis does not establish deployment readiness. Salesforce check-only validation is the platform evidence boundary.

Lifecycle mutations require an explicit target org and `allow_mutation=true`, remain Guardrail-mediated, and refuse production or unknown orgs. `deploy.activate` leaves the checked-in file unchanged by staging a temporary Active copy. `lifecycle.activate` never guesses latest. `lifecycle.deactivate` deploys `FlowDefinition` metadata with `<activeVersionNumber>0</activeVersionNumber>`, then verifies `FlowDefinitionView.IsActive=false` and `ActiveVersionId=null`; schedule-triggered Flows also require no matching `CronTrigger`. See [`AGENT_GUIDE.md`](./AGENT_GUIDE.md#activation-and-deactivation).

## Org-Grounded Authoring

`author.plan` remains local when `target_org` is omitted. With an explicit target, it performs bounded read-only grounding for:

- the requested object or platform event and intent-relevant fields;
- matching standard, Apex, Flow, external-service, and quick actions with input/output contracts;
- matching active or latest autolaunched subflows with input/output variables.

Each plan discloses API calls and grounding gaps. Results are bounded to prevent full-schema or full-action dumps, and no grounding occurs at startup or after ordinary file edits.

## Local Diagnostics

The small V1 analyzer reports source-located findings for:

- malformed XML or a non-Flow root;
- missing core metadata and inconsistent core family/trigger configuration;
- duplicate element or resource names;
- missing or dangling connector targets and unreachable elements;
- unresolved local references and invalid record context;
- database operations inside loops;
- missing fault paths, with Get Records treated as lower severity than mutation/action elements;
- elements that Salesforce documents as unavailable in before-save record-triggered flows;
- conflicting Create Records output-storage modes;
- invalid asynchronous-after-commit fields, trigger timing, and update-entry guards;
- malformed custom Start filter logic, missing condition indexes, unsupported record-filter operators, and locally provable value-type incompatibilities.

Every analysis discloses skipped coverage. Broad formula, org-action, and project-wide analysis remains with Salesforce Code Analyzer.

The data-first rule catalog includes independent evaluators for all 30 published Lightning Flow Scanner rule concepts plus SF Pi-native correctness checks. Generation, review, and audit profiles keep policy-specific or noisy findings out of the automatic edit path. Use `quality.rules` to inspect the registry and [`QUALITY_RULES.md`](./QUALITY_RULES.md) for the full contract.

## Bounded Repair Loop

After a successful Flow file write or edit, SF Flow runs the low-noise generation profile. High and Moderate findings can steer at most three agent repair rounds. The loop stops when source is clean, the finding signature repeats, or the round limit is reached. It never performs hidden business-logic mutations.

`diagnose.file` can offer three deterministic fixes:

- set `apiVersion` to the SFDX project source version;
- add or correct `AUTO_LAYOUT_CANVAS` metadata;
- remove an exact unused local variable.

`fix.apply` requires the `fix_id` and SHA-256 `source_version` from the current diagnosis. It refuses stale source and re-diagnoses after writing.

## Flow Result Cards

Human-facing results use a normalized Flow Run Digest. Cards show:

- action outcome and target;
- Flow family, trigger, and object or event;
- local and API evidence rails;
- source-located findings or test failures;
- Mermaid-backed Flow topology;
- artifact paths and a next step.

The Result Card stays compact. SF Flow appends bounded topology as a top-level Mermaid block on the next final assistant message, so Pi renders it natively outside the tool tile and respects the user’s Mermaid setting. The displayed architecture uses verb-first nodes, labeled decision and loop edges, solid normal paths, thick paths into durable writes, and dotted fault paths for up to 100 executable elements, below Pi’s native 128-node Mermaid parser ceiling. Pi themes borders, node text, edges, arrowheads, and edge labels by semantic class. SF Flow intentionally avoids browser-only Mermaid `classDef`, `style`, per-node colors, and Markdown bold in labels because Pi’s terminal renderer ignores them. Relevant resource details are folded into their operation node; raw resources are not separate boxes. Asynchronous-after-commit paths appear as explicit ASYNC nodes between Start and their first element in both inspection artifacts and Mermaid topology. When the displayed graph is bounded, the `.mmd` Flow Artifact contains the complete executable topology.

## Commands

```text
/sf-flow          Open SF Flow in the SF Pi Manager
/sf-flow status   Print status
/sf-flow help     Print lifecycle actions
```

## Safety and Data Boundaries

- No startup org probes, project scans, subprocesses, or network calls.
- Automatic post-edit feedback is local-only, bounded to three actionable rounds, and stays silent for clean files.
- `fix.apply` is limited to source-bound API-version, Auto-Layout, and unused-variable fixes and participates in Pi's file mutation queue.
- `validate.check` stages one Flow in a temporary directory with `checkOnly=true`; it never deploys or activates.
- `deploy.activate`, `lifecycle.activate`, and `lifecycle.deactivate` are exact, one-Flow, check-first operations with Guardrail mediation and resulting-state verification.
- Test runs require explicit Flow API names or Flow test names and never default to all tests.
- Complete evidence is persisted under `<globalAgentDir>/sf-pi/sf-flow/`; model-facing output stays compact.
- No arbitrary Flow execution, broad metadata deployment, bulk lifecycle mutation, full-screen editor, LSP, VS Code package, or AI-backed generation service is included in V1.

## Live E2E Evidence

The E2E harness has passed against a connected non-production org at API 67.0: org preflight, clean local diagnosis, one-file Metadata API check-only validation, FlowTest metadata discovery, queued targeted `test.run`, and polled `test.result` completion.

A dedicated public-safe draft autolaunched Flow and FlowTest fixture is available under `scripts/e2e/fixtures/sf-flow/`. Provisioning always performs check-only first and requires an explicit `--deploy` flag. The fixture creates no data records and requires no activation.

The same project also contains public-safe Screen, schedule-triggered, platform-event-triggered, before-delete, and after-save fixtures plus one non-committing after-save FlowTest. Run `npm run e2e:sf-flow-families -- --org <non-production-alias>` for local diagnosis and combined check-only validation. Add `--deploy` to deploy Draft fixtures, deactivate any fixture left active through `FlowDefinition.activeVersionNumber=0`, run and rerun the after-save FlowTest, and verify inactive state, scheduled-job cleanup, and zero Account/Task residue.

Advanced public-safe fixtures live under `scripts/e2e/fixtures/sf-flow-advanced/`. Run `npm run e2e:sf-flow-advanced -- --org <dedicated-non-production-alias>` for local diagnosis and combined check-only validation, `--deploy` to retain inactive Draft Flow and Apex fixtures, or `--runtime` to check-only validate the exact staged Active package, temporarily activate the Flow fixtures, and run targeted Apex integration tests. The runtime sweep covers Create, Update, Create or Update, and Delete trigger configurations; AND, OR, custom, and formula entry criteria; every `FlowRecordFilter` operator, collectively spanning string, currency, date, picklist, boolean, and reference fields; before-save, immediate after-save, related-record, and asynchronous-after-commit paths; and 1- and 200-record transactions. Element proofs include Assignment, Decision, Loop, Custom Error, real action and database fault connectors, Apex and standard Send Email actions, Subflow, Collection Filter, three-field Collection Sort with nulls first and last, related-record deletion, record-collection Create/Update/Delete operations, filter-based Get/Create/Update/Delete Records, and Create Records upsert. Upsert proofs cover create-then-update identity, complete rollback with `doesUpsertAllOrNone=true`, and partial persistence with `doesUpsertAllOrNone=false`; partial mode still enters the fault connector when any member fails. Transform proofs cover direct mapping, Count and Sum including empty input, a real `InnerJoin` with matched and unmatched keys, and two-level Apex-defined nested collections. It also proves `$Record__Prior`, invocable Apex cardinality/order, primitive and record-collection Subflow contracts, schedule-triggered batches, 200-event platform-event execution, and a committed one-minute `WaitDuration` interview that is observed as Paused, automatically resumes, creates one evidence record, and leaves no `FlowInterview`. An isolated private custom object plus a temporarily assigned fixture permission set keeps the new data-operation proofs independent from standard-object automation. Runtime paths cover no-trigger autolaunched, before-save, after-save, before-delete, schedule-triggered, and platform-event Flows. A Roll Back Records Screen Flow is locally diagnosed, API 67 check-only validated, activated, and deterministically deactivated; interactive Screen runtime remains outside the headless sweep because `Flow.Interview` refuses Screen Flows. The harness uses real committed transactions and bounded polls for asynchronous-after-commit and Wait evidence because Apex tests do not establish those paths. Cleanup runs in `finally`, deactivates every Flow with `activeVersionNumber=0`, removes bounded fixture data, paused interviews, schedules, and temporary permission assignments, and verifies zero Account, Contact, Opportunity, Task, custom probe, `FlowInterview`, and CronTrigger residue.

Action-specific fixtures live under `scripts/e2e/fixtures/sf-flow-actions/`. Run `npm run e2e:sf-flow-actions -- --org <dedicated-non-production-alias>` for local diagnosis and combined check-only validation or add `--runtime` for targeted Apex tests plus real Flow invocations. The sweep proves a complex bulk-safe Invocable Apex contract, a Named Credential-backed Apex callout, an OpenAPI External Service callout, an object-specific Quick Action, a workflow Email Alert, and a dynamically grounded Run Agent action. The committed Run Agent template contains no org-specific action name; the harness discovers or accepts one through `--agent-action`, validates the `userMessage`/`agentResponse`/`sessionId` contract, stages it only in a temporary directory, and removes that directory afterward. Cleanup deactivates all action Flows and verifies zero fixture Account and Task residue.

Run `npm run e2e:sf-flow-lifecycle -- --org <dedicated-non-production-alias>` after installing the action and advanced fixtures to exercise the production lifecycle module. The sweep proves read-only REST status, local Draft-source activation without source mutation, exact existing-version activation, deterministic deactivation, scheduled Flow activation with CronTrigger evidence, and scheduled cleanup with zero CronTrigger residue. Cleanup runs in `finally`, and production or unknown orgs are refused.

The actual wide and 48-column Result Cards were rendered through the production component. Both remain bounded without embedding topology; long metadata and artifact paths use compact headers and hanging indentation. Hook tests prove the Mermaid block is appended once to the next final assistant message for Pi-native rendering.

To remove the dedicated fixture later, delete `FlowTest:SfPi_Flow_Test_Fixture_Happy_Path` followed by `Flow:SfPi_Flow_Test_Fixture` from the chosen non-production org.

## Acknowledgements

SF Flow's quality-rule design is informed by the public rule documentation and black-box behavior of [Lightning Flow Scanner](https://lightningflowscanner.org/), an [MIT-licensed open-source project](https://github.com/Flow-Scanner/lightning-flow-scanner). SF Flow is an independent white-room implementation and does not include Lightning Flow Scanner production source code.

The exact upstream core package is pinned as a dev-only parity oracle. Fresh SF Pi fixtures compare rule occurrence and applicability without copying implementation, messages, regexes, or upstream example flows. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Official References

- [Metadata API Flow reference](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm)
- [Quick Action metadata](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_quickaction.htm)
- [External Service Registration metadata](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_externalserviceregistration.htm)
- [Named Credential metadata](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_namedcredential.htm)
- [Workflow Alert Tooling API](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_workflowalert.htm)
- [Flow Builder best practices](https://help.salesforce.com/s/articleView?id=platform.flow_prep_bestpractices.htm&type=5)
- [Before-save record-triggered flows](https://help.salesforce.com/s/articleView?id=platform.flow_concepts_trigger_record.htm&type=5)
- [Scheduled paths](https://help.salesforce.com/s/articleView?id=platform.flow_concepts_trigger_scheduled_path.htm&type=5)
- [Run Flow tests](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_flow_run_test.html)
- [Get Flow test results](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_flow_get_test.html)

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-flow/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
