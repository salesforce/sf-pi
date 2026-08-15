# Data 360 V2 Action Coverage and Recursive Validation

Operational reference for validating the public `data360_*` family interface against the generated v2 action registry. Use this before changing action ownership, dispatcher behavior, safety classification, or the live capability sweep.

## Sources of truth

1. `registry/v2/actions.json` — generated public tool/action ownership.
2. `registry/v2/action-overrides.json` and `action-rules.json` — curated v2 names and ownership.
3. `lib/v2/tools.ts` and `lib/v2/dispatcher.ts` — public schema and execution behavior.
4. Public upstream reference catalog and payload examples — imported source material, not runtime code.
5. Official Salesforce documentation for product semantics not established by the local registry.

The retained facade registry is compatibility evidence only. See [`compatibility/`](./compatibility/).

## Discovery contract

Data 360 exposes hundreds of operations behind eleven bounded family tools. Do not load the full catalog into the prompt or add one tool per endpoint.

1. Use `data360_discover` with `actions.search` when the owning family/action is unclear.
2. Use `action.describe` to inspect exact parameters, endpoint, safety, and examples.
3. Invoke the owning family action.
4. Use `dry_run: true` or the matching `*.plan` action before confirmed execution.
5. Use `data360_api rest.request` only when no promoted family action exists.

## Recursive validation recipe

1. Select an isolated non-production target and pass `target_org` explicitly.
2. Run `data360_discover readiness.probe`; record core, optional, empty, gated, and blocked surfaces separately.
3. Enumerate `registry/v2/actions.json` by tool and action. Every registry row must have exactly one primary owner.
4. For each family:
   - run `actions.search` and `action.describe` through that family;
   - exercise one bounded read action;
   - if a list is populated, exercise one detail read;
   - exercise bounded safe-post validation, count, query, preview, test, or prediction actions when fixtures exist;
   - use plan/dry-run for create, update, delete, run, publish, deploy, undeploy, deactivate, cancel, retry, refresh, auth exchange, and signing-key actions.
5. Execute confirmed actions only with sweep-owned resources, explicit user/operator approval, and deterministic cleanup.
6. Record `reachable`, `empty`, `feature_gated`, `not_found_optional`, `dry_run_ok`, `skipped_needs_fixture`, or `failed` without treating one org’s optional state as universal support.
7. Persist the v2 tool, action, target classification, plan/execution chain, cleanup result, and artifact paths.

## Coverage invariants

A valid sweep proves:

- every v2 action resolves to one public family;
- discovery and `action.describe` expose the same contract the dispatcher executes;
- target-org and API-version resolution use the Salesforce Connection Module;
- read and safe-post actions remain bounded;
- confirmed actions require reviewed intent and Guardrail mediation;
- journey execution records child mutation families and resulting steps;
- optional features and empty collections are evidence, not automatic failures;
- cleanup touches only resources created by the same run.

## Current live-proof boundary

[`../../../scripts/e2e/data360-v2-action-sweep.ts`](../../../scripts/e2e/data360-v2-action-sweep.ts)
is the authoritative action sweep. Its default path is non-mutating; optional
live reads are bounded with `--max-live-read`. The confirmed DLO lifecycle
requires `--mutation-lifecycle dlo`, `--mutate`, a stable run ID, a verified
non-production target, and both exact target environment gates defined by
[ADR 0106](../../../docs/adr/0106-data-360-live-proof-uses-the-v2-dispatcher.md).
Facade-only results remain compatibility evidence and do not establish
public-interface coverage.
