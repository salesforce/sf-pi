# Recipe lifecycle hardening — findings log

> Continuously regress sf-agentscript against the
> [trailheadapps/agent-script-recipes](https://github.com/trailheadapps/agent-script-recipes)
> corpus. Every issue surfaced here lands either as an upstream PR (recipe bug),
> a sf-agentscript hardening fix, or a documented expected limitation.

The harness is at [`scripts/recipes/harness.mjs`](../../../scripts/recipes/harness.mjs).
Run it locally with:

```bash
# clone the recipes repo once
git clone https://github.com/trailheadapps/agent-script-recipes \
  /tmp/pi-github-repos/trailheadapps/agent-script-recipes

# static sweep across all 31 recipes — ~200ms total
node scripts/recipes/harness.mjs

# full lifecycle on the curated subset — needs an Agentforce org
node scripts/recipes/harness.mjs --with-org <alias>

# filter to a single recipe by name substring
node scripts/recipes/harness.mjs --with-org <alias> --filter HelloWorld
```

Reports land in `.pi/state/recipe-harness/report-<ts>.md`.

---

## Latest run summary

> AgentforceSTDM · 2026-05-11

### Static sweep (all 31 recipes)

| Metric                   | Value                                   |
| ------------------------ | --------------------------------------- |
| Compile-clean            | **30 / 31**                             |
| With sev-2 warnings only | 6 / 31                                  |
| With sev-1 errors        | 1 / 31 (`ContextHandling` — see below)  |
| Inspect ok               | 31 / 31                                 |
| Total wall time          | ~200 ms (compile + inspect, in-process) |

### Live lifecycle (curated subset of 10)

| Recipe                     | Compile | Publish | Activate | Preview start | Preview send | Deactivate |
| -------------------------- | :-----: | :-----: | :------: | :-----------: | :----------: | :--------: |
| HelloWorld                 |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| SimpleQA                   |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| LanguageSettings           |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| SystemInstructionOverrides |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| VariableManagement         |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| TemplateExpressions        |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| ReasoningInstructions      |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| PromptTemplateActions      |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| MultiSubagentNavigation    |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |
| BidirectionalNavigation    |    ✓    |    ✓    |    ✓     |       ✓       |      ✓       |     ✓      |

**10 / 10 passed every stage.**

---

## Hardening fixes shipped

### Pre-flight: action targets resolve in the org

**Symptom**: An agent that references `flow://X` or `apex://Y` in a `target:`
field publishes successfully via SFAP — right up until the server's late
validation step rejects with `Invocation Target: bad value for restricted
picklist field: <name>`. Or worse, publish + activate succeed and the
failure surfaces only at preview-start runtime as `Precondition Failed:
Unable to load agent config: Invalid Config`. Either way, the user has
already paid the publish + (sometimes) activate round-trip before learning
that backing metadata is missing.

**Fix**: `lib/preflight.ts::checkActionTargets()` runs **before** server
compile / publish. For every `target:` URI on every action declaration
(top-level OR inline under subagent / topic), it queries the target org:

- `flow://X` → `SELECT ApiName FROM FlowDefinitionView WHERE ApiName = X`
- `apex://X` → `SELECT Name FROM ApexClass WHERE Name = X` (Tooling API)
- `generatePromptResponse://X` and other schemes are reported as
  `unverifiable` (we don't pre-flight prompt templates today).

When any target is missing the publish raises `PreflightFailureError` with
the full list of missing names, the deploy command to fix them, and a
`recover_via` envelope pointing the LLM at `agentscript_authoring inspect
action='check_targets'` for a per-target breakdown. Pass `skipPreflight:
true` to bypass the network check (the local `bundleType` check still
runs).

**Surface**: same module is callable standalone via the new
`agentscript_authoring inspect action='check_targets'` action, which returns the
same breakdown without invoking publish. Useful when authoring an agent
before the org is ready.

**Tests**: `tests/preflight.test.ts` (12 cases covering bundle XML
parsing, target extraction, status classification, dedup), plus
`tests/inspect-inline-actions.test.ts` (the inline-subagent-action walk
that feeds the pre-flight) and live exercise in the recipe harness.

### Pre-flight: bundleType in bundle-meta.xml

**Symptom**: hand-rolled `<AiAuthoringBundle>` XML lacking
`<bundleType>AGENT</bundleType>` fails the SDR deploy step with the
cryptic `Required fields are missing: [BundleType]` error AFTER the
zip + upload round-trip.

**Fix**: `lib/preflight.ts::checkBundleType()` reads the bundle XML
before SDR ever sees it. Missing-field / wrong-root / unparseable cases
each return a distinct `reason` code so the LLM error envelope can carry
a clear suggestion ("Add `<bundleType>AGENT</bundleType>` inside
`<AiAuthoringBundle>` and retry"). Scaffolds produced by
`agentscript_authoring create` already include the field; this only fires on
user-authored XML.

### `ensureSdrFriendlyLayout` — bundle deploy works regardless of caller path

**Symptom**: `ComponentSet.fromSource(bundleDir).deploy()` failed with
`Could not infer a metadata type` when `bundleDir`'s parent wasn't named
`aiAuthoringBundles`. Ad-hoc bundle paths under `.pi/state/recipe-harness/`,
`/tmp/` scratch dirs, and similar locations all hit this.

**Root cause**: SDR's path-based metadata resolver maps directory names to
metadata types via the registry (`aiAuthoringBundles` → `AiAuthoringBundle`).
When the bundle is in a non-conforming layout, the resolver can't classify
the contents and bails before any network call.

**Fix**: `lib/lifecycle.ts` now detects the layout pre-deploy. If the bundle
dir's parent isn't `aiAuthoringBundles`, we synthesize a minimal mirror at
`os.tmpdir()/sf-agentscript-bundle-XXXX/aiAuthoringBundles/<agent>/`, copy the
bundle files there, deploy from the synthesized path, and rm the temp tree
in `finally`. Original source location is untouched.

Test: `tests/lifecycle-sdr-layout.test.ts` — 3 cases (correct layout passes
through; wrong layout produces synthesized mirror; copy preserves UTF-8 +
target injection).

---

## Hardening insights filed but not yet shipped

_(none currently — the two earlier insights graduated to shipped fixes
in the section above.)_

---

## Upstream recipe issues to file

### `ContextHandling` — lowercase `@messagingSession` namespace

The recipe binds linked variables to `source: @messagingSession.sessionID`,
`@messagingSession.userID`, and `@messagingSession.channelType`. The
agentforce dialect requires PascalCase: `@MessagingSession`. Local compile
correctly flags 3× `constraint-allowed-namespaces` errors with the
synthesized fix `Did you mean '@MessagingSession'?`.

To file as a PR against trailheadapps/agent-script-recipes:
update lines 14, 18, 22 in
`force-app/future_recipes/contextHandling/aiAuthoringBundles/ContextHandling/ContextHandling.agent`
from `@messagingSession.X` → `@MessagingSession.X`.

### Misc — `unused-variable` cleanup diagnostics (sev-3, non-blocking)

5 recipes declare variables that are never read:

| Recipe                       | Variable             |
| ---------------------------- | -------------------- |
| `ComplexStateManagement`     | (1 unused)           |
| `ContextHandling`            | `session_start_time` |
| `CustomerServiceAgent`       | (2 unused)           |
| `ActionDescriptionOverrides` | (2 unused)           |
| `BidirectionalNavigation`    | (1 unused)           |
| `ExternalAPIIntegration`     | (1 unused)           |

These don't break runtime; the upstream PR should either reference each
variable in `instructions` or remove it.

---

## Recipes that need backing metadata before they can lifecycle

Recipes in this list reference flows / Apex / custom objects from their
sibling directories. To run them through the live lifecycle, deploy the
recipe's full `force-app/.../<recipe>/` tree to the org first, assign the
`Agent_Script_Recipes_Data` and `Agent_Script_Recipes_App` permission sets,
and `sf data import tree --plan data/data-plan.json`.

| Recipe                        | Backing dependencies                                                   |
| ----------------------------- | ---------------------------------------------------------------------- |
| `AfterReasoning`              | flows: GetCurrentTimestamp, LogEvent                                   |
| `ActionChaining`              | flows: SearchProducts, FetchInventory, …                               |
| `ActionDefinitions`           | flows: multiple action definitions                                     |
| `ActionDescriptionOverrides`  | flows                                                                  |
| `AdvancedInputBindings`       | flows                                                                  |
| `AdvancedReasoningPatterns`   | flows + custom objects                                                 |
| `AvailableWhenFiltering`      | flows                                                                  |
| `ComplexStateManagement`      | ASR_Task\_\_c custom object + flows                                    |
| `ConditionalLogicPatterns`    | (review per-case)                                                      |
| `ContextHandling`             | ASR_Interaction_Log\_\_c + flows + lowercase namespace bug             |
| `CustomerServiceAgent`        | Survey_Log\_\_c, Apex IssueClassifier, multiple flows                  |
| `CustomLightningTypes`        | custom Lightning types                                                 |
| `ErrorHandling`               | flows                                                                  |
| `EscalationPatterns`          | (review per-case)                                                      |
| `ExternalAPIIntegration`      | external service / Named Credential                                    |
| `InstructionActionReferences` | flows                                                                  |
| `MultiStepWorkflows`          | flows                                                                  |
| `MultiSubagentOrchestration`  | ASR_Hotel_Booking**c, ASR_Flight_Booking**c, ASR_Itinerary\_\_c, flows |
| `OpenGateRouter`              | (review per-case)                                                      |
| `SafetyAndGuardrails`         | (review per-case)                                                      |
| `SubagentDelegation`          | (review per-case)                                                      |

Future work: ship a `harness --bootstrap-org <alias>` mode that deploys
the entire recipes repo to a scratch org once and then runs the full
lifecycle on every single recipe.
