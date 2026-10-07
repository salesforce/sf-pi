# SF Data 360 Workflows

## Read-only validation

1. Run `discover.readiness.probe` against an explicit non-production target.
2. Search or describe the intended action locally.
3. Execute one bounded read in each required business namespace.
4. Classify results as reachable, empty, feature-gated, dependency-missing, optional-not-found, or failed.
5. Preserve raw evidence only when broad or diagnostic.

## Mutation validation

1. Describe the action and validate its required parameters.
2. Run the exact action with `dry_run: true`.
3. Review target, transport, method, path, payload, and safety.
4. Execute only with `allow_mutation: true` and Guardrail approval.
5. Verify resulting state through an independent read.
6. Clean up only a resource created and owned by the same run.

## Recursive endpoint sweep

Build the checklist from `registry/actions.json`, group by business namespace, and execute through `scripts/e2e/data360-action-sweep.ts`. Endpoint-local failures must become focused local Behavior Proofs before implementation changes.
