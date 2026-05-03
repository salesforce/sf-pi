# AGENTS.md

Agent instructions for `sf-pi`.

## Goals

Optimize this repo for:

1. **Agents first** — fast navigation, clear source of truth, safe edits
2. **Humans second** — simple code, explicit flow, easy review, helpful comments

## Start here (agent orientation)

If you have just landed in this repo, read in this order:

1. [`catalog/index.json`](./catalog/index.json) — canonical list of every
   bundled extension with its id, category, commands, tools, events, and
   `srcLoc`. Tells you what exists and roughly how big each extension is.
2. [`docs/agent-orientation.md`](./docs/agent-orientation.md) — generated
   agent map of extensions, commands, tools, providers, and runtime surfaces.
3. [`docs/commands.md`](./docs/commands.md) — every slash command grouped
   by extension, with default-enabled state. Generated from manifests.
4. The specific extension's `README.md` — behavior, commands, runtime
   flow, generated file structure.
5. The extension's `AGENTS.md` if it exists — editing rules specific to
   that extension.
6. The extension's `index.ts` header comment — behavior matrix.
7. The `lib/` module you're changing, then the matching test file.

For shared code (used by multiple extensions), start at
[`lib/common/README.md`](./lib/common/README.md).

## Repo map

- `AGENTS.md` — contributor/agent rules for this repo (this file)
- `ARCHITECTURE.md` — repo structure and conventions
- `CONTRIBUTING.md` — contributor workflow and commands
- `README.md` — user-facing install and usage guide
- `ROADMAP.md` — shipped / in-flight / non-goals
- `docs/commands.md` — GENERATED per-extension command reference
- `docs/agent-orientation.md` — GENERATED agent navigation map
- `docs/human-orientation.md` — contributor-facing repo walkthrough
- `docs/doc-ownership.json` — machine-readable doc source/check map
- `docs/adr/` — architecture decision records for stable rationale
- `catalog/index.json` — canonical machine-readable list of bundled extensions
- `catalog/registry.ts` — generated TypeScript registry from manifests
- `extensions/<id>/` — one self-contained extension per folder
- `extensions/<id>/AGENTS.md` — optional per-extension rules (see convention below)
- `extensions/<id>/ROADMAP.md` — optional per-extension phased roadmap
- `lib/common/` — shared helpers (see its own `README.md`)
- `scripts/generate-catalog.mjs` — regenerates the catalog + generated doc sections
- `scripts/docs-health.mjs` — checks doc drift contracts and public-safe examples
- `scripts/docs-changed.mjs` — summarizes docs impacted by a diff
- `scripts/scaffold.mjs` — scaffolds a new extension

## Source of truth

Use these in order:

1. `extensions/<id>/manifest.json` — extension identity and bundle metadata
2. `catalog/index.json` / `catalog/registry.ts` — generated from manifests
3. `extensions/<id>/README.md` — extension walkthrough and file map
4. `README.md` — high-level summary only

### Important

- **Do not edit `catalog/registry.ts` manually.**
- If you change any `manifest.json`, run `npm run generate-catalog`.
- Prefer deriving extension lists from `catalog/index.json` or `catalog/registry.ts` instead of hardcoding them.

## Editing rules

### Keep the code simple

Prefer:

- small files with one clear responsibility
- direct control flow
- explicit names
- straightforward conditionals
- local helper functions over clever abstractions

Avoid:

- hidden behavior
- broad utility layers with mixed responsibilities
- clever metaprogramming
- unnecessary indirection
- cross-extension coupling unless there is a strong reason

### Split by responsibility, not by abstraction

Good splits:

- command routing
- settings file I/O
- status formatting
- session scanning
- registry/state parsing

Bad splits:

- abstract base helpers with vague names
- generic utilities that hide repo-specific behavior

### Comments matter

Keep comments focused on **why** and **behavior contracts**.

Add comments when:

- a function follows Pi-specific precedence rules
- a fallback exists for reliability
- a settings mutation is subtle
- a best-effort or non-obvious behavior would confuse reviewers

Do not add comments that only restate obvious code.

## Working in an extension

When editing an extension, read in this order:

1. `extensions/<id>/README.md`
2. `extensions/<id>/AGENTS.md` if present
3. `extensions/<id>/index.ts`
4. relevant files in `extensions/<id>/lib/`
5. tests in `extensions/<id>/tests/`

Each extension should stay self-contained.

### Per-extension `AGENTS.md` (optional)

Add `extensions/<id>/AGENTS.md` when the extension has:

- non-obvious editing rules that don't fit the top-level `AGENTS.md`
- a file map worth pinning so agents stop inventing new module locations
- invariants that are easy to violate by accident (e.g. HITL confirm for
  `slack_send`)

Keep it short. A good per-extension `AGENTS.md`:

1. Points at the extension's `README.md` for behavior
2. Has a single "file map" table (responsibility → file)
3. Lists conventions that are specific to this extension
4. Lists explicit non-goals

See `extensions/sf-slack/AGENTS.md` and
`extensions/sf-llm-gateway-internal/AGENTS.md` as references.

### Per-extension `ROADMAP.md` (optional)

Add `extensions/<id>/ROADMAP.md` when the extension has phased work that
doesn't belong in the top-level `ROADMAP.md`. See
`extensions/sf-skills-hud/ROADMAP.md` as a reference.

## Drift-proof docs

Several doc sections are **generated** from `extensions/*/manifest.json`
to prevent drift. Never edit inside these marker pairs; edit the
manifest instead and rerun `npm run generate-catalog`.

| File                        | Generated section                                                  |
| --------------------------- | ------------------------------------------------------------------ |
| `catalog/registry.ts`       | entire file                                                        |
| `catalog/index.json`        | entire file                                                        |
| `README.md`                 | bundled-extensions table, command reference, troubleshooting index |
| `ARCHITECTURE.md`           | folder layout                                                      |
| `docs/commands.md`          | entire file                                                        |
| `docs/agent-orientation.md` | entire file                                                        |
| `extensions/*/README.md`    | file-structure marker block                                        |

The root README troubleshooting index is auto-built from each extension's
`## Troubleshooting` section by scanning for bolded question entries
(lines shaped like `**Symptom...:**` or `**Symptom...?**`). Add a new
bullet under that heading in any extension README and it will appear in
the root index after `npm run generate-catalog`.

Marker format:

```
<!-- GENERATED:<section-name>:start -->
… generated content …
<!-- GENERATED:<section-name>:end -->
```

If you need new content for the whole repo to read from manifests,
prefer adding a new generated marker over another source of truth.

## Generated and derived files

- `catalog/registry.ts` — generated
- `catalog/index.json` — generated
- bundled-extension section in `README.md` — generated by `scripts/generate-catalog.mjs`

If you add or rename an extension:

- update `manifest.json`
- run `npm run generate-catalog`
- verify the generated README bundled-extension section looks right

## Validation checklist

Before finishing code changes, run:

```bash
npm run generate-catalog
npm run format:check
npm run check
npm test
```

Or run the full validation:

```bash
npm run validate
```

## Git workflow (solo fast path)

This repo is optimized for **push straight to `main`**. Do not create a
feature branch and PR unless the user explicitly asks for one, or the
change is risky (destructive migrations, breaking API changes, sweeping
refactors).

- Default: `git commit` + `git push` on `main`.
- CI (`ci.yml`) runs format/lint/tsc/test/audit — ~2–3 min.
- `release-please` auto-opens a release PR and auto-merges it when CI
  is green. No human click is required to cut a release.
- `pre-push` only blocks force-push and deletion of `main`. It does
  **not** run lint/typecheck locally; CI is the source of truth.

When you _should_ suggest a PR instead:

- The change rewrites history, renames public APIs, or removes an
  extension.
- The change needs a reviewer the user named explicitly.
- You are mid-refactor and want a checkpoint visible on GitHub.

Otherwise push and move on.

## Review expectations

A good change in this repo should be:

- easy for another agent to continue
- easy for a human to review in one pass
- low surprise
- documented where behavior is non-obvious
- consistent with existing extension structure
