# ADR 0002: Generated Catalog and Drift-Resistant Docs

## Status

Accepted

## Context

The repo has many extension-facing surfaces: manifests, registry, root README,
command reference, troubleshooting index, extension file maps, and orientation
docs. Hand-maintaining all of them causes recurring drift.

## Decision

Treat `extensions/*/manifest.json` and the extension file tree as source of
truth for factual inventory. `scripts/generate-catalog.mjs` owns generated
catalog files and generated documentation marker blocks.

## Consequences

- Contributors edit manifests and source files, then run `npm run generate-catalog`.
- Generated files and marker blocks are not edited manually.
- CI checks `npm run generate-catalog:check`.
- Human-authored sections remain for rationale, troubleshooting, examples, and
  roadmap judgment.
