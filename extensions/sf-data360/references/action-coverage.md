# SF Data 360 Action and Endpoint Coverage

`registry/actions.json` is the runtime contract for the single `sf_data360` tool.

## Invariants

- Every action begins with one approved business namespace.
- Every imported upstream operation maps to one primary action or one canonical operation alias.
- Every action declares safety, required and optional parameters, source family, and endpoint or implementation kind.
- Direct Query API V3 and tenant Ingestion API actions declare their non-Connect transport explicitly in code.
- Cross-domain relevance is represented by search metadata and next actions, not duplicate Pi tools.
- `api.request` provides exact endpoint reach between catalog refreshes.

## Validation

1. Generate `registry/actions.json` with `npm run generate-d360-actions`.
2. Run `npm run generate-d360-parity` and require zero missing upstream operations.
3. Run action search and contract tests.
4. Run the non-mutating action sweep against an explicit non-production org.
5. Use a separately approved fixture lifecycle for mutation proof.
6. Verify exact cleanup and preserve private raw evidence outside committed files.

The authoritative sweep is `scripts/e2e/data360-action-sweep.ts`. It uses the same dispatcher, safety, transport, result, and artifact Modules as the public tool.
