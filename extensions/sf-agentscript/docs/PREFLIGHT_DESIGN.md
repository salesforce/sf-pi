# Action target pre-flight — design

> Extensible architecture for verifying every `target:` URI in an Agent
> Script `.agent` file resolves in the target org **before** publish.

---

## Problem

The agentscript compiler accepts **any** scheme on a `target:` URI as the
action's `invocation_target_type`. The runtime then resolves the scheme at
publish-time / preview-start / runtime — and surfaces failures with cryptic
errors:

| Surface                                 | Error when target is missing                                                |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `sf agent publish authoring-bundle`     | `Invocation Target: bad value for restricted picklist field: <name>`        |
| `agentscript_lifecycle publish` (today) | same as above, after a 1-2s SFAP round-trip                                 |
| `agentscript_preview start`             | HTTP 500 `Precondition Failed: Unable to load agent config: Invalid Config` |
| Live runtime invocation                 | `MalformedInvocationTargetException` mid-conversation                       |

We already pre-flight `flow://` and `apex://`. The corpus we surveyed
([salesforce/agentscript](https://github.com/salesforce/agentscript))
shows **20+ schemes** used in real-world agents. We need an extensible
shape so adding a new scheme is one file change, not a code-path edit.

---

## What schemes exist (from `salesforce/agentscript` survey)

Counted occurrences across the canonical repo (`compiler/test/fixtures`,
`compiler/src/nodes/*`, agentforce dialect schemas):

| Scheme                                             |  Count | Resolves to                         | Tooling/Data API                                             |
| -------------------------------------------------- | -----: | ----------------------------------- | ------------------------------------------------------------ |
| `flow://`                                          |   1687 | Flow / ProcessBuilder               | data: `FlowDefinitionView.ApiName`                           |
| `apex://`                                          |    231 | ApexClass with `@InvocableMethod`   | tooling: `ApexClass.Name`                                    |
| `standardInvocableAction://`                       |    171 | Built-in Salesforce action          | n/a — always available                                       |
| `agentforce://`                                    |     52 | Connected Agent (sub-agent)         | data: `BotDefinition.DeveloperName`                          |
| `externalService://`                               |     53 | External Service registration       | tooling: `ExternalServiceRegistration.DeveloperName`         |
| `model://`                                         |     46 | Foundation / AI Model               | data: `GenAiFunction` referring to a model                   |
| `ext://`                                           |     37 | (test stub — placeholder)           | not pre-flighted                                             |
| `mcp://`                                           |     18 | MCP server                          | external — not pre-flighted today                            |
| `llm://`                                           |     16 | (test stub)                         | not pre-flighted                                             |
| `generatePromptResponse://`                        |      3 | Prompt Template                     | tooling: `GenAiPromptTemplate.DeveloperName`                 |
| `apexRest://`                                      |      1 | Apex REST class                     | tooling: `ApexClass.Name` (SOQL adds `@RestResource` filter) |
| `integrationProcedureAction://`                    |      1 | OmniStudio IntegrationProcedure     | data: `vlocity_cmt__OmniProcess__c` (industry pkg)           |
| `quickAction://`                                   |      1 | QuickAction                         | tooling: `QuickActionDefinition.DeveloperName`               |
| `retriever://`                                     |      1 | Data Cloud Retriever                | data: Data 360 metadata                                      |
| `slack://`                                         |      1 | Slack action                        | external — not pre-flighted                                  |
| `serviceCatalog://`, `createCatalogItemRequest://` | 1 each | Service Catalog                     | tooling: `CatalogItem.MasterLabel`                           |
| `cdpMlPrediction://`                               |      1 | Customer Data Platform ML           | data: Data 360                                               |
| `byon://`                                          |      2 | Bring-your-own-network              | external — not pre-flighted                                  |
| `placeholder://`                                   |     10 | **stub — compiler emits a warning** | always blocks publish (compiler-level)                       |

### Categorization

1. **Salesforce metadata** (resolvable via SOQL/Tooling) — flow, apex,
   apexRest, externalService, agentforce (connected agent),
   generatePromptResponse, quickAction, model
2. **Always-available platform** (no need to verify) —
   standardInvocableAction
3. **External / off-platform** (no SF query covers them) — mcp, slack,
   byon, http, https
4. **Industry / Data Cloud / OmniStudio** (require feature licenses) —
   retriever, cdpMlPrediction, integrationProcedureAction,
   externalConnector, executeIntegrationProcedure, expressionSet,
   serviceCatalog, createCatalogItemRequest, namedQuery
5. **Test stubs / placeholders** — ext, llm, custom, type, schema,
   placeholder (compiler warns on `placeholder://`)

---

## Proposed architecture

### One-line design

> A **registry of `TargetResolver`s** keyed by scheme. The pre-flight
> dispatches each parsed URI through its resolver, batches by sObject,
> and returns a `TargetCheck` per action.

### Module layout

```
extensions/sf-agentscript/lib/preflight/
├── index.ts                       (public surface)
├── parse.ts                       (URI parsing + extractActionTargets)
├── registry.ts                    (TargetResolver registry + dispatch)
├── resolvers/
│   ├── flow.ts                    flow:// → FlowDefinitionView (data)
│   ├── apex.ts                    apex:// → ApexClass (tooling)
│   ├── apex-rest.ts               apexRest:// → ApexClass + @RestResource
│   ├── agentforce.ts              agentforce:// → BotDefinition (data)
│   ├── external-service.ts        externalService:// → ExternalServiceRegistration (tooling)
│   ├── prompt-template.ts         generatePromptResponse:// → GenAiPromptTemplate (tooling)
│   ├── quick-action.ts            quickAction:// → QuickActionDefinition (tooling)
│   ├── always-available.ts        standardInvocableAction://, http(s)://, mcp:// → "ok" without query
│   ├── unverifiable.ts            schemes we recognize but don't pre-flight
│   └── placeholder.ts             placeholder:// → always "missing" (matches compiler warning)
└── types.ts                       TargetResolver interface, TargetCheck, etc.
```

### Resolver interface

```typescript
export interface TargetResolver {
  /** Schemes this resolver handles (e.g. ['flow']). */
  readonly schemes: string[];

  /** Friendly name shown in error / render output. */
  readonly metadataLabel: string;

  /**
   * Verify a batch of names against the org. Returns a Set of names that
   * exist. Resolvers may also indicate "always available" (return
   * `Set<string>` containing every queried name) or "unverifiable"
   * (return `null`).
   */
  resolve(conn: Connection, refNames: readonly string[]): Promise<Set<string> | null>;

  /**
   * Optional: SF deploy command that fixes a missing reference. Used in
   * the LLM error envelope as a recover_via hint.
   */
  fixHint?(refName: string): string;
}
```

### Registry + dispatch

```typescript
const REGISTRY = new Map<string, TargetResolver>();

export function registerResolver(resolver: TargetResolver): void {
  for (const scheme of resolver.schemes) {
    REGISTRY.set(scheme, resolver);
  }
}

// Boot-time wiring
registerResolver(flowResolver);
registerResolver(apexResolver);
// ... (one line per scheme)
```

`checkActionTargets()` becomes:

1. Parse all URIs into `ActionTarget[]` (existing `parse.ts`).
2. Group by `scheme` → resolver.
3. For each group: `resolver.resolve(conn, names)` → Set<string> | null.
4. Map back to `ActionTargetCheck[]` with status `ok` / `missing` /
   `unverifiable`.
5. Return aggregated result (same shape as today).

### Resolver examples

```typescript
// resolvers/flow.ts
export const flowResolver: TargetResolver = {
  schemes: ["flow"],
  metadataLabel: "Flow",
  async resolve(conn, names) {
    return safeNamesQuery(conn, "/query", "FlowDefinitionView", "ApiName", names);
  },
  fixHint(name) {
    return `sf project deploy start -m Flow:${name}`;
  },
};

// resolvers/always-available.ts
export const alwaysAvailableResolver: TargetResolver = {
  schemes: ["standardInvocableAction", "http", "https", "mcp", "slack", "byon"],
  metadataLabel: "Built-in / external",
  async resolve(_conn, names) {
    // These don't have SF metadata records; treat them as resolvable so
    // the publish proceeds. The runtime is responsible for actual
    // resolution at invocation time.
    return new Set(names);
  },
};

// resolvers/placeholder.ts
export const placeholderResolver: TargetResolver = {
  schemes: ["placeholder"],
  metadataLabel: "Placeholder (compiler stub)",
  async resolve(_conn, _names) {
    // Compiler already warns; surface as "missing" to keep the pre-flight
    // strict. Authors usually replace placeholder:// before publish.
    return new Set();
  },
};
```

### Status semantics

| Resolver returns                      | Reported status | Blocks publish? |
| ------------------------------------- | --------------- | --------------- |
| `Set` containing the name             | `ok`            | no              |
| `Set` not containing the name         | `missing`       | **yes**         |
| `null`                                | `unverifiable`  | no              |
| no resolver registered for the scheme | `unverifiable`  | no              |

### Backwards compatibility

Today's API is `checkActionTargets(conn, actions)`. The registry
implementation keeps the same export and same `CheckActionTargetsResult`
shape. Callers (`lifecycle.ts`, `inspect-tool.ts check_targets`,
`render/lifecycle.ts`) need zero changes. Internal: the function dispatches
to the registry instead of the hardcoded if/else for flow/apex.

### Test surface

- `tests/preflight/<scheme>.test.ts` — one file per resolver. Mock the
  Connection's `request` to return known rows, assert the resolver
  classifies the inputs correctly. Reuse the existing `fakeConn` helper
  pattern from `preflight.test.ts`.
- `tests/preflight/registry.test.ts` — asserts every scheme observed in
  the recipe corpus has a resolver registered (or is explicitly listed
  in `KNOWN_UNVERIFIABLE` so the LLM still knows about it).
- `tests/preflight/integration.test.ts` — full pre-flight on a synthetic
  agent that mixes flow + apex + agentforce + standardInvocableAction,
  asserting the aggregated `CheckActionTargetsResult` is correct.

### Render integration

`render/lifecycle.ts` already shows the missing-targets card. The new
shape is a strict superset of today's data, so the renderer needs one
addition: **scheme badge** next to each missing entry (e.g. `[Flow]`,
`[ApexClass]`) so users can see at a glance which metadata type is
missing.

---

## Phasing

| Phase | Scope                                                                                                                                                                                    | Commit-size | Coverage                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------- |
| **1** | Registry + the schemes we already verify (flow, apex). Refactor without behavior change.                                                                                                 | small       | 80% of real-world recipes |
| **2** | Add `agentforce://`, `apexRest://`, `externalService://`, `generatePromptResponse://`, `quickAction://`, `standardInvocableAction://`.                                                   | medium      | 95% of recipes            |
| **3** | Add the always-available group (`http`, `https`, `mcp`, `slack`, `byon`). Mark Industry/Data Cloud schemes as `unverifiable` with a clear note pointing at the relevant feature license. | small       | 99% of recipes            |
| **4** | Optional: query Data Cloud schemes (`retriever`, `cdpMlPrediction`) via `d360_api`. Only when the org has Data Cloud enabled.                                                            | medium      | 100%                      |

Phase 1 ships the registry without expanding coverage — pure
refactor. Phase 2 is where users see the value (most missing-target
publish failures hit there). Phases 3 & 4 are polish.

---

## Open questions

1. **Caching.** Each `check_targets` call queries the org. For
   author-time iteration (run check_targets every 30s while editing) we
   may want to cache results for ~60s keyed on (conn, scheme, name).
   Punt: ship without cache; add later if real users complain about
   latency.

2. **Org feature gating.** `retriever://` only works in Data
   Cloud-enabled orgs. Should `unverifiable` carry "won't work in this
   org because feature X is disabled" or just "we don't pre-flight
   this"? Punt: phase 4 problem.

3. **Connected agent depth.** When an `.agent` references
   `agentforce://Other_Agent`, should the pre-flight transitively walk
   the other agent's targets? Almost certainly yes, but it complicates
   batch shape. Punt: phase 2 ships the immediate-resolution check
   only; transitive walking is a follow-up.

4. **Schema versioning.** New schemes appear in the upstream every
   release. Should the registry auto-discover them (e.g. "any unknown
   scheme is unverifiable") or hard-fail? **Auto-discover is better** —
   matches today's behavior and the compiler's permissive stance.

---

## Recommendation

Ship **Phase 1 + Phase 2 together** as a single PR. The registry alone
is invisible to users; the value lands when 95% of real-world recipes
get pre-flighted. ~1 day of work, ~700 lines, mostly tests.

---

## Status: Phase 1 + 2 shipped

_Resolved as of 2026-05-11._

### Resolvers shipped

| Resolver                  | Schemes                                                                       | Endpoint | sObject + name field                                |
| ------------------------- | ----------------------------------------------------------------------------- | -------- | --------------------------------------------------- |
| `flowResolver`            | `flow`                                                                        | data API | `FlowDefinitionView.ApiName`                        |
| `apexResolver`            | `apex`, `apexRest`                                                            | tooling  | `ApexClass.Name`                                    |
| `agentforceResolver`      | `agentforce`                                                                  | data API | `BotDefinition.DeveloperName`                       |
| `externalServiceResolver` | `externalService`                                                             | tooling  | `ExternalServiceRegistration.DeveloperName`         |
| `promptTemplateResolver`  | `generatePromptResponse`                                                      | tooling  | `Prompt.DeveloperName`                              |
| `quickActionResolver`     | `quickAction`                                                                 | tooling  | `QuickActionDefinition.DeveloperName`               |
| `alwaysAvailableResolver` | `standardInvocableAction`, `http`, `https`, `mcp`, `mcpTool`, `slack`, `byon` | n/a      | always returns `Set(allNames)`                      |
| `placeholderResolver`     | `placeholder`                                                                 | n/a      | always returns empty Set (matches compiler warning) |

Unknown schemes → `unverifiable` (no resolver registered, publish proceeds).

### Live verification

Against `AgentforceSTDM` on `CustomerServiceAgent` (14 inline action
declarations across 5 subagents): pre-flight correctly identified 1
resolved Apex class (`IssueClassifier`), 1 resolved Flow (`CreateCase`),
and 12 missing Flows — each tagged with the `[Flow]` / `[ApexClass]`
badge in the render output.

Against the recipe harness curated subset (4 recipes with no
flow/apex/prompt deps): 4/4 publish + activate + preview + deactivate
clean. Pre-flight blocked `PromptTemplateActions` until `Generate_
Personalized_Schedule` is deployed (was previously a false-positive
pass because `generatePromptResponse://` was unverifiable).

### Test surface

- `tests/preflight/registry.test.ts` — every corpus scheme either has a
  resolver registered OR is in `KNOWN_UNVERIFIABLE`; high-traffic schemes
  must be registered.
- `tests/preflight/resolvers.test.ts` — one block per resolver, each
  asserting the right SOQL endpoint, sObject, and name field.
- `tests/preflight/dispatch.test.ts` — integration coverage on the full
  bucketing + dispatch flow (flow + apex + agentforce + externalService,
  partial fail, always-available, placeholder, unknown scheme, dedup).

### Phases not yet shipped

Phase 3 (Industry / Data Cloud schemes — retriever, cdpMlPrediction,
integrationProcedureAction, expressionSet, namedQuery, serviceCatalog,
createCatalogItemRequest, externalConnector, executeIntegrationProcedure)
remains backlog. They're rare in real-world agents and require feature
licenses; user demand will dictate priority.

Phase 4 (transitive walk for `agentforce://` connected agents) also
remains backlog — the immediate-resolution check ships today; resolving
targets two hops deep needs a recursive planner.
