# Documentation Health

This repo keeps factual documentation drift low with automation:

- `npm run generate-catalog` refreshes generated catalog/doc sections.
- `npm run docs:health:check` checks hand-written doc contracts and public-safe examples.
- `npm run docs:changed` summarizes which docs are implicated by a diff.
- `docs/doc-ownership.json` maps docs to their sources of truth.

Run the CI-like local path before pushing:

```bash
npm run validate:ci
```
