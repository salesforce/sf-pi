---
title: Contributing
description: Contributor and agent-facing sources of truth for changing SF Pi.
---

# Contributing

This is the documentation-site entry point for contributors. Detailed workflow
lives in the root repository documents rather than being copied into the site.

## Start here

- [Contributing guide](https://github.com/salesforce/sf-pi/blob/main/CONTRIBUTING.md) — setup, scripts, testing, review, and release workflow.
- [Architecture](https://github.com/salesforce/sf-pi/blob/main/ARCHITECTURE.md) — repository structure and stable contracts.
- [Governance](https://github.com/salesforce/sf-pi/blob/main/GOVERNANCE.md) — project roles and decision-making.
- [Security policy](https://github.com/salesforce/sf-pi/blob/main/SECURITY.md) — private vulnerability reporting and supported versions.
- [Agent orientation](./agent-orientation.md) — generated owner and agent-document map.
- [ADRs](https://github.com/salesforce/sf-pi/tree/main/docs/adr) — current and historical architecture decisions.
- [Public sanitization](./public-sanitization.md) — rules for public code, docs, tests, examples, and diagnostics.

## Common change paths

| Change                                     | Start with                                                            |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Extension behavior                         | `extensions/<id>/index.ts`, relevant `lib/`, and focused tests        |
| Extension metadata or agent-document roles | `extensions/<id>/manifest.json`                                       |
| Shared behavior                            | `lib/common/README.md` and the owning shared Module                   |
| Generated documentation                    | Change its manifest/source input, then run `npm run generate-catalog` |
| Contributor workflow                       | Root `CONTRIBUTING.md`                                                |
| Stable architecture decision               | A focused ADR under `docs/adr/`                                       |

## Source-of-truth rules

- Code and Behavior Proofs define implemented behavior.
- Manifests declare generated/runtime surfaces and document roles.
- Generated files and generated marker blocks are never hand-edited.
- Extension behavior stays co-located under `extensions/<id>/`.
- Shared helpers belong in `lib/common/` only when multiple extensions need the
  same behavior.

## Validation

Run focused checks while iterating. Before publishing broad changes, use:

```bash
npm run lint
npm run validate:ci
```

Useful documentation checks:

```bash
npm run generate-catalog:check
npm run docs:health:check
npm run docs:build
```

If generated drift is reported, run `npm run generate-catalog`, review the full
diff, and stage the intended outputs explicitly.
