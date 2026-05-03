# sf-pi Human Orientation

This guide is for contributors who want the practical map without reading every
extension first. The root [`README.md`](../README.md) remains the user-facing
install guide; this page is contributor-facing.

## What this repo is

`sf-pi` is a bundle of Pi extensions for Salesforce-heavy development. Each
extension is self-contained under `extensions/<id>/`, while shared helpers live
under `lib/common/`.

## Where to start

1. Read [`README.md`](../README.md) for install and user-facing behavior.
2. Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) for repo structure and source of truth.
3. Open [`docs/agent-orientation.md`](./agent-orientation.md) for the generated inventory.
4. For a specific extension, read:
   - `extensions/<id>/README.md`
   - `extensions/<id>/AGENTS.md` if present
   - `extensions/<id>/index.ts`
   - relevant `extensions/<id>/lib/*.ts`
   - matching tests

## Common change paths

| Change                          | Start here                                           | Then run                                                         |
| ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Add/change command metadata     | `extensions/<id>/manifest.json`                      | `npm run generate-catalog`                                       |
| Change extension behavior       | `extensions/<id>/index.ts` or `lib/*.ts`             | tests for that extension, then `npm run validate`                |
| Add a new extension             | `npm run scaffold -- --id sf-my-ext --category core` | fill README, tests, `npm run validate`                           |
| Change recommendation bundle    | `catalog/recommendations.json`                       | `npm run generate-catalog`, `npm run docs:health:check`          |
| Change release-visible behavior | `CHANGELOG.md`                                       | `npm run generate-catalog` to refresh announcements              |
| Change CI/scripts               | `.github/workflows/`, `scripts/`                     | update `CONTRIBUTING.md` / `ARCHITECTURE.md` if behavior changed |

## Validation commands

Use the fast path while iterating:

```bash
npm run generate-catalog:check
npm run format:check
npm run check
npm test
```

Use the CI-like path before pushing:

```bash
npm run validate:ci
```

Useful documentation-only helpers:

```bash
npm run docs:changed
npm run docs:health:check
```

## Generated vs hand-authored docs

Generated or partially generated:

- `catalog/index.json`
- `catalog/registry.ts`
- `docs/commands.md`
- `docs/agent-orientation.md`
- generated marker blocks in root `README.md`
- generated folder layout in `ARCHITECTURE.md`
- generated file maps in `extensions/*/README.md`
- release entry metadata in `catalog/announcements.json`

Hand-authored and expected to carry judgment:

- architecture rationale
- troubleshooting fixes
- safety notes
- examples
- roadmap priorities
- ADRs under `docs/adr/`

When in doubt, run `npm run docs:changed` after your code change. It prints the
likely docs that need review.

## Public-safe documentation rule

This repo is public-facing. Do not copy internal discussion text, customer
examples, Slack links, org URLs, workspace/user IDs, or private hostnames into
docs, comments, tests, examples, or commit messages. If an example is needed,
make it generic and fresh.
