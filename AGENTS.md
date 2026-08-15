# AGENTS.md

Repository instructions for `sf-pi`.

## Goals

1. **Agents first:** fast owner discovery, clear authority, safe edits, observable proof.
2. **Humans second:** simple code, explicit flow, and reviewable changes.

## Authority and discovery

Code and Behavior Proofs define what is implemented. Manifests declare the
runtime/documentation contract; generated catalog and docs project that contract.
When prose and code disagree, inspect the public runtime seam and correct the
manifest/docs rather than preserving stale wording.

Use this path:

1. If the owner is unknown, query one record in
   [`catalog/index.json`](./catalog/index.json). Do not read every generated
   inventory first.
2. Open `extensions/<id>/manifest.json` for declared commands, providers, tools,
   events, and document roles.
3. For code changes, read the manifest-declared `docs.editingRules` when present,
   then `index.ts`, the relevant implementation module, and its focused test.
4. For tool operation, use the active tool schema first. Read the declared
   `docs.agentGuide` only when deeper ordering, recovery, or troubleshooting is
   useful.
5. Use the extension README for human-facing behavior. Follow a declared
   `docs.referenceRoots` index only for task-specific depth; read a specific ADR
   or context glossary only for rationale or terminology.

For shared code, start at [`lib/common/README.md`](./lib/common/README.md).
Contributor workflow lives in [`CONTRIBUTING.md`](./CONTRIBUTING.md); repository
structure and conventions live in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Editing rules

- Make the smallest change that satisfies the request.
- Do not refactor, reformat, or delete adjacent code without a direct reason.
- Match existing style and keep extensions self-contained.
- Split by concrete responsibility, not by generic abstraction.
- Put comments on non-obvious contracts and rationale, not obvious syntax.
- Remove only the dead code or generated output made obsolete by your change.
- Define observable success before editing and verify narrowly before broad
  validation.

## Stable repository contracts

### Manifests and generated files

`extensions/<id>/manifest.json` is the declarative extension contract.
`npm run generate-catalog` produces the catalog, generated docs pages, sidebar,
ADR lifecycle index, architecture/troubleshooting marker blocks, contributor,
shared-module and E2E inventories, extension file maps, and release announcement
metadata.

Never hand-edit:

- `catalog/index.json`
- `catalog/registry.ts`
- `docs/extensions.md`
- `docs/extensions/*.md`
- `docs/.vitepress/generated-extension-sidebar.ts`
- `docs/commands.md`
- `docs/agent-orientation.md`
- `docs/adr/README.md`
- content inside `GENERATED:*` marker pairs

After changing a manifest, generated input, or extension file tree, run
`npm run generate-catalog`, review the complete diff, and stage the intended
outputs. Validation and pre-commit checks detect drift but do not repair it.

### Runtime surface attestation

`npm run test:runtime-surface` executes every real extension factory and
controlled registration lifecycle. It compares runtime commands, providers,
tools, and events bidirectionally with manifests.

- Runtime registration—not source-string matching—owns manifest agreement.
- A product-specific conditional tool surface requires an extension-local
  `tests/runtime-surface-scenarios.ts` with positive and negative cases.
- Scenario adapters invoke real lifecycle handlers. They must not call
  registration helpers or duplicate manifest tool names.
- Factory/startup registration must remain cache-first and must not require live
  credentials, orgs, network calls, or subprocesses merely to expose tools.

Prefer one registration file per independently defined tool. Family registries
such as Data 360 may keep related definitions together when they share one schema
and dispatcher.

### Slash-command navigation

Manager-first no-args navigation is the package-wide contract.

For bundled commands:

- interactive no-args opens the extension detail page through
  `openExtensionInManager`;
- explicit subcommands stay direct and scriptable;
- specialized/full-screen workflows use an explicit action;
- non-interactive no-args returns concise status/help;
- simple grammars reuse one action catalog for parsing, completion, help, and
  Manager actions.

Canonical panel files are `lib/command-panel.ts`, `lib/config-panel.ts`, and
`lib/preferences-panel.ts`. See ADR 0051 and [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for the full UI contract.

### Boot path

Module load, factory execution, and `session_start` are constrained startup
surfaces. They may register runtime surfaces, read small local state needed for
first paint, render cached state, or schedule bounded background refreshes.
They must not synchronously perform live Salesforce calls, spawn unbounded
subprocesses, scan large trees, or import heavy SDKs merely to expose helpers.
First paint is cache-first; live verification belongs in explicit commands,
tool calls, first-turn hooks, or bounded deferred work.

### State placement

Use the first matching rule:

1. Conversation/session state → `pi.appendEntry<T>(customType, data)`.
2. In-process state read by multiple extensions → a shared store under
   `lib/common/<topic>/store.ts`.
3. User-editable preference → Pi `settings.json` through
   `lib/common/sf-pi-settings.ts`.
4. Other per-user SF Pi state → `lib/common/state-store.ts` under
   `<globalAgentDir>/sf-pi/<namespace>/`, with schema versioning, atomic writes,
   safe parse defaults, and mode `0o600` for secrets.

### Public repository safety

Public code, docs, examples, tests, comments, screenshots, metadata, and commit
messages must not contain secrets, private endpoints, customer or employee
identifiers, real org/workspace ids, internal links, or copied private-source
wording. Use fresh generic examples and follow
[`docs/public-sanitization.md`](./docs/public-sanitization.md).

## Validation

Run focused tests while iterating. Before finishing a normal change:

```bash
npm run generate-catalog:check
npm run format:check
npm run check
npm test
```

Use the full local/CI-like paths for broad or release-visible work:

```bash
npm run lint
npm run validate:ci
```

Documentation-only helpers:

```bash
npm run docs:health:check
npm run docs:build
```

Report changed files, commands and outcomes, generated artifacts, and residual
risks. Never claim success without observed evidence.

## Git workflow

The maintainer fast path is commit and push directly to `main`; use a PR for
breaking APIs, destructive migrations, sweeping refactors, or a named-reviewer
requirement. Never force-push or delete `main`. CI is the final backstop.
