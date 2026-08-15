---
id: "0106"
status: accepted
date: 2026-08-11
supersedes: ["0010"]
---

# Data 360 live proof uses the v2 registry and dispatcher

## Context

ADR 0010 established a facade-first capability sweep before the public
`data360_*` family tools existed. ADR 0027 later made the v2 action registry and
shared dispatcher the public runtime authority, but the retained live sweep
continued to select legacy capability names and execute the facade directly.
That made its broad compatibility evidence unsuitable as proof of the current
public interface.

Live mutation evidence also depended on an environment-specific legacy facade
exception. The v2 sweep needs a target-independent safety rule that still fails
closed for production, unresolved targets, unowned resources, and ordinary
headless execution.

## Decision

The repository has one authoritative Data 360 action sweep:
`scripts/e2e/data360-v2-action-sweep.ts`. It selects actions from the generated
v2 registry and executes them through `runData360V2Action`, using the same tool,
action, params, target-org, dry-run, confirmation, rendering, and artifact
contracts as normal `data360_*` calls.

The sweep provides broad local describe, metadata, dry-run, and missing-parameter
proof. Live reads are bounded and report optional feature or data-state outcomes
without turning one org into a universal support claim.

Confirmed live proof starts with one fixture-owned DLO lifecycle. The lifecycle:

1. verifies that its unique `PiV2SweepDlo_<runId>__dll` name is absent;
2. dry-runs and executes `data360_prepare dlo.create`;
3. verifies the created DLO through `data360_prepare dlo.get`;
4. dry-runs and executes `data360_prepare dlo.delete`; and
5. verifies absence after cleanup.

Mutation requires an explicitly authenticated non-production target, `--mutate`,
an 8–32-character alphanumeric run ID, and two exact target gates:
`SF_PI_D360_V2_SWEEP_MUTATION_TARGET_ORG` and
`D360_V2_SWEEP_ALLOW_DESTRUCTIVE`. Headless destructive execution is allowed
only for the exact DLO name derived from that run ID. A failed preflight or
mutation plan stops before the corresponding write. Delete acceptance and final
absence checks use bounded retries for Data 360 propagation; exhaustion remains
a failed run with the owned resource named in the private artifact.

The legacy facade keeps its existing dedicated-target destructive rule for
legacy callers. V2 interactive destructive calls instead require an
authenticated non-production target plus the existing explicit acknowledgement
and human confirmation. Production, unresolved, and mismatched targets remain
blocked.

The facade-first E2E script and its planner tests are deleted. Legacy facade code
may remain as an internal v2 execution adapter and compatibility-test subject,
but it does not own live-parity claims.

## Consequences

- Registry ownership, action naming, dispatcher behavior, target resolution,
  confirmation gates, and artifacts are proven through the public seam.
- The mutation path is reusable across non-production org aliases without
  weakening legacy behavior or permitting arbitrary headless deletion.
- Additional live lifecycles are added only with public-safe fixtures,
  preflight ownership proof, and deterministic cleanup.
- Raw org responses and identifiers remain private E2E artifacts; committed
  documentation records only bounded, public-safe results.
