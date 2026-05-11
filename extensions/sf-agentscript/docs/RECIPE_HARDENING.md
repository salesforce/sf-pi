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

### `bundleType` pre-flight in publish

**Symptom**: hand-rolled `bundle-meta.xml` files lacking `<bundleType>AGENT</bundleType>`
fail SDR deploy with the cryptic `Required fields are missing: [BundleType]`.

**Proposed fix**: in `lifecycle.ts`, read the bundle XML before invoking SDR
and emit a clear `MISSING_BUNDLE_TYPE` error with a `recover_via` pointing
at `agentscript_create` or a docs link.

**Workaround today**: scaffolds produced by `agentscript_create` already
include the field; this only bites when developers hand-roll XML.

### Pre-flight unresolved action references

**Symptom**: recipes whose `.agent` file references undeployed actions
(e.g. `flow://GetCurrentTimestamp`) fail at preview start with HTTP 500
`Precondition Failed: Unable to load agent config: Invalid Config`.
Local compile + inspect both pass cleanly. Server compile + publish + activate
succeed. The runtime config-load is where the resolution happens.

**Proposed fix**: extend `agentscript_inspect` (or add a new
`agentscript_doctor` style action) that walks `action_refs` and reports any
that look like `flow://...` / `apex://...` / `function://...` symbols whose
backing metadata can't be resolved in the target org. Save users a publish +
activate round-trip.

**Workaround today**: the harness's `LIVE_LIFECYCLE_RECIPES` list curates
out recipes with backing-metadata dependencies (`AfterReasoning`,
`ComplexStateManagement`, `CustomerServiceAgent`, etc.).

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

### Misc — `unused-variable` warnings (sev-2, non-blocking)

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
