# Contributing to SF Pi

Thanks for contributing to `sf-pi`. This guide owns local setup, validation,
extension changes, pull requests, and releases. Project roles and decisions live
in [`GOVERNANCE.md`](./GOVERNANCE.md); vulnerability reporting lives in
[`SECURITY.md`](./SECURITY.md). Please also follow the
[Code of Conduct](./CODE_OF_CONDUCT.md) and
[public-sanitization policy](./docs/public-sanitization.md).

## Before starting

Search existing [Issues](https://github.com/salesforce/sf-pi/issues) and
[Discussions](https://github.com/salesforce/sf-pi/discussions). Open an issue for
a substantial bug or feature before investing in a broad implementation. Small
documentation corrections, focused tests, and obvious fixes can go directly to
a pull request.

The active [roadmap](./ROADMAP.md) contains only unresolved repository outcomes.
Runtime code and Behavior Proofs remain authoritative for implemented behavior.

## Contribution expectations

- Keep changes small, focused, and consistent with existing style.
- Use atomic Conventional Commits and reference related issues when useful.
- Comment non-obvious contracts and rationale, not obvious syntax.
- Add or update Behavior Proofs for behavioral changes and run the relevant
  focused checks.
- Minimize dependencies and justify any new one.
- Keep public code, docs, examples, tests, and diagnostics source-agnostic and
  free of secrets or private identifiers.
- Use a pull request unless the documented maintainer fast path applies.

## Creating a pull request

1. Fork and clone the repository, then create a focused branch.
2. Make the smallest change that solves the documented problem.
3. Run focused checks while iterating and the broad validation appropriate to
   the change.
4. Push the branch and open a pull request against `main`.
5. Complete the pull request template with tests, generated artifacts, security
   impact, and residual risks.
6. Sign the Salesforce CLA when prompted.

Sync the fork before opening or updating the pull request. Avoid unrelated
formatting or refactors.

## CLA and license

Contributions require the one-time
[Salesforce CLA](https://cla.salesforce.com/sign-cla) and are accepted under the
project's [Apache License 2.0](./LICENSE.txt).

## Development setup

### Clone and install

```bash
git clone https://github.com/salesforce/sf-pi.git
cd sf-pi
npm install
```

`npm install` runs the `prepare` script, which installs Husky hooks:

- `pre-commit` runs gitleaks on the staged diff when available, applies
  lint-staged formatting/fixes, then exports and checks the staged Git snapshot
  for generated catalog drift without changing the index or working tree.
- `commit-msg` validates
  [Conventional Commits](https://www.conventionalcommits.org/).
- `pre-push` blocks force-pushes and deletion of `main`; CI remains the source
  of truth for full lint/typecheck/test validation.

Optional local install for manual testing:

```bash
pi install .
```

## Scripts reference

Use focused checks while iterating:

```bash
npm run generate-catalog:check
npm run format:check
npm run check
npx vitest run <focused-test-files>
```

Before finishing a normal change, run `npm run lint` and `npm run validate`.
Use `npm run validate:ci` for the complete local CI-like lane. Generated drift
is never repaired by a check: run the owning generator explicitly, review its
full diff, and stage only intended outputs.

The opt-in live harnesses, target requirements, mutation posture, and artifact
locations are documented in [`scripts/e2e/README.md`](./scripts/e2e/README.md).
`npm run docs:links:report` is the same report-only network check used by the
weekly workflow; external reachability intentionally stays outside normal PR
validation.

### Complete package script inventory

<!-- GENERATED:contributor-scripts:start -->

This complete inventory is generated from `package.json`; edit that file and run `npm run generate-catalog`.

<details>
<summary>Show all 55 package scripts</summary>

**Generated sources**

- `npm run generate-catalog`
- `npm run generate-catalog:check`
- `npm run generate-catalog:check-staged`
- `npm run generate-d360-parity`
- `npm run generate-d360-parity:check`
- `npm run generate-d360-payload-examples`
- `npm run generate-d360-payload-examples:check`
- `npm run generate-d360-references`
- `npm run generate-d360-references:check`
- `npm run generate-d360-registry`
- `npm run generate-d360-registry:check`
- `npm run generate-d360-v2-actions`
- `npm run generate-d360-v2-actions:check`
- `npm run import-d360-upstream`
- `npm run import-d360-upstream:check`

**Documentation**

- `npm run docs:build`
- `npm run docs:dev`
- `npm run docs:health`
- `npm run docs:health:check`
- `npm run docs:links:report`
- `npm run docs:preview`

**Static checks**

- `npm run check`
- `npm run check:architecture`
- `npm run check:boot-path`
- `npm run check:commands`
- `npm run check:lifecycle-scripts`
- `npm run check:manager-first`
- `npm run check:salesforce-connection`
- `npm run spdx`
- `npm run spdx:check`

**Formatting and linting**

- `npm run eslint`
- `npm run eslint:fix`
- `npm run format`
- `npm run format:check`
- `npm run lint`

**Tests**

- `npm run test`
- `npm run test:coverage`
- `npm run test:runtime-surface`
- `npm run test:watch`

**Validation**

- `npm run validate`
- `npm run validate:ci`

**E2E and live proofs**

- `npm run e2e:d360-stdm`
- `npm run e2e:d360-tracing`
- `npm run e2e:data360-v2`
- `npm run e2e:instruction-behavior`
- `npm run e2e:sf-apex-harness`
- `npm run e2e:sf-browser-harden`
- `npm run e2e:sf-herdr`
- `npm run e2e:sf-lwc`
- `npm run e2e:sf-soql`

**Development utilities**

- `npm run agentscript:versions`
- `npm run instruction-surface:report`
- `npm run scaffold`

**Lifecycle hooks**

- `npm run preinstall`
- `npm run prepare`

</details>

<!-- GENERATED:contributor-scripts:end -->

## Source of truth

Runtime code and Behavior Proofs define implemented behavior. Each
`extensions/<id>/manifest.json` declares the public routing and documentation
contract attested against that runtime. Generated catalog/docs project the
manifest; the extension README owns human explanation.

### Generated files

Do not edit these manually:

- `catalog/registry.ts`
- `catalog/index.json`
- `docs/extensions.md`
- `docs/extensions/*.md`
- `docs/.vitepress/generated-extension-sidebar.ts`
- `docs/commands.md`
- `docs/agent-orientation.md`
- `docs/adr/README.md`
- generated troubleshooting index in `docs/troubleshooting.md`
- generated folder layout in `ARCHITECTURE.md`
- generated package-script inventory in this guide
- generated shared-module inventory in `lib/common/README.md`
- generated E2E harness inventory in `scripts/e2e/README.md`
- generated file-structure blocks in `extensions/*/README.md`
- normalized `catalog/announcements.json`
- validated / normalized `catalog/recommendations.json`

Regenerate them with:

```bash
npm run generate-catalog
```

## Code style

This repo prefers:

- simple code
- explicit control flow
- clear comments for non-obvious behavior
- small modules split by responsibility
- self-contained extensions

Avoid:

- clever abstractions
- hidden behavior
- broad utility layers that mix unrelated concerns

## Product and documentation style

Use these names consistently:

- **SF Pi** for the product/bundle; **`sf-pi`** for the package, repository,
  command namespace, or extension-id prefix.
- **Pi Runtime** only when naming the defined runtime architecture boundary.
- **Data 360** for the current product; use “Data Cloud” only when matching an
  official endpoint, metadata name, or historical compatibility surface.
- the exact extension display name from its manifest.
- code formatting for commands, settings keys, action names, and file paths.
- **Behavior Proof** only for evidence observed through a public seam.

Deliberate public maintainer and third-party attribution is allowed; incidental
private employee, customer, org, workspace, and internal-source identifiers are
not. Follow [`docs/public-sanitization.md`](./docs/public-sanitization.md).

## Adding or changing an extension

Each extension lives in `extensions/<id>/` and should usually contain:

- `index.ts`
- `manifest.json`
- `README.md`
- `lib/`
- `tests/`

Complex extensions (lots of rules, multiple write surfaces, non-obvious
conventions) should also add an `AGENTS.md` at `extensions/<id>/AGENTS.md`
with a short file map and any editing rules. See
[`extensions/sf-slack/AGENTS.md`](./extensions/sf-slack/AGENTS.md) and
[`extensions/sf-llm-gateway/AGENTS.md`](./extensions/sf-llm-gateway/AGENTS.md)
for examples. Add an extension `ROADMAP.md` only for concrete unresolved
outcomes with observable completion conditions. Remove shipped history and
delete the roadmap when no active outcome remains.

Scaffold a new extension with:

```bash
npm run scaffold -- --id sf-my-extension --category ui --intent "Personalize pi" --name "My Extension"
```

The manifest's `description` is its concise factual catalog description.
`docs.summary` is the longer factual explanation, and `docs.intentGroup` is
one of the generated browse-page outcomes defined in `catalog/types.ts`.
`docs.primaryFiles` is a read-first route capped at eight entries, not a recursive
inventory. Markdown under an extension's `docs/` or `references/` directory must
be covered by `docs.referenceRoots` and a routed index; generated-current roots
also name their repository generator. Do not create a second copy registry or
repeat marketing lists in generated metadata.

The `--category` must be one of the six values defined by
`catalog/types.ts`:

- **`manager`** — the SF Pi Manager meta surface.
- **`provider`** — model or identity providers registered with Pi.
- **`agent-tool`** — extensions that contribute LLM tools or skills.
- **`safety`** — gating, permission, or guardrail extensions.
- **`assistive`** — helpers, diagnostics, prompts, or feedback flows.
- **`ui`** — purely visual surfaces such as splashes, status bars, HUDs, and
  spinners.

### Extension README conventions

An extension README is the human behavior and usage page. Use only the
conditional sections the extension needs, in this order:

1. **What It Does** — required current user-visible behavior.
2. **Commands** — required only when the manifest declares commands.
3. **Configuration** — required only when configurable or credentialed.
4. **Safety and Data Boundaries** — required when the manifest declares safety boundaries.
5. **References** — required when the manifest routes deeper references.
6. **Troubleshooting** — only real symptoms and recovery.
7. generated **File Structure** — required and final.

Feature-specific human sections may appear between those anchors. Do not add
empty placeholders. Put editing invariants in `AGENTS.md`, tool ordering and
recovery in `AGENT_GUIDE.md`, durable rationale in ADRs, and test commands in
this guide unless an extension has a genuine exception. Do not add architecture,
Runtime Flow, Behavior Matrix, Release Checks, or generic Testing Strategy
sections merely to narrate source structure.

The generated File Structure block gives directory roles and root contract
files. `docs.primaryFiles` owns the small implementation-first route; deeper
material is routed through `docs.referenceRoots` indexes. Troubleshooting entries
shaped like `**Symptom:**` or `**Question?**` also feed the generated site index.

### Manual live evidence

Current manual live-verification pages use flat frontmatter:

```yaml
evidence: manual-live-verification
as_of: YYYY-MM-DD
owner: sf-extension-id
revalidate_after: YYYY-MM-DD
revalidation_trigger: Public API, registry, or owning behavior changes
```

`docs:health` fails when required metadata is absent, the revalidation date
precedes `as_of`, or current evidence passes its revalidation date. Replace the
public-safe summary after a bounded recheck; never commit org aliases, ids,
instance URLs, raw responses, or private artifact paths.

## Proposing a recommended extension

sf-pi keeps a curated list of external open-source pi extensions in
[`catalog/recommendations.json`](./catalog/recommendations.json). We do not
redistribute these packages — we only point at their upstream sources so
users can install them via `pi install`.

To propose a new recommendation:

1. Add an entry to `catalog/recommendations.json` with:
   - a stable sf-pi-local `id` (kebab-case)
   - `name`, `description`, `source`, `homepage`, `license`, `rationale`
   - optional `scope` (`"global"` or `"project"`) if the default differs
2. If it belongs to a bundle (for example `default`), add its id to that
   bundle's `items` array.
3. Bump the top-level `revision` to today's date (`YYYY-MM-DD`). This
   re-arms the one-time nudge for users who already acknowledged the
   previous revision.
4. Run `npm run generate-catalog` — the script validates the schema and
   fails if the `license` is not in the allow-list (`MIT`, `Apache-2.0`,
   `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`).
5. Open the PR with:
   - a link to the upstream repo and its license file
   - a short rationale (why is this worth recommending to sf-pi users?)
   - any compatibility notes (pi version, OS, required auth, etc.)

PRs that broaden the license allow-list must update both
`scripts/generate-catalog.mjs` and `catalog/types.ts` in the same change
and justify the addition in the PR description.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/).
Husky's `commit-msg` hook enforces this via commitlint. Short version:

```
<type>(<optional-scope>): <short summary>

<optional body>

<optional footer>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`, `security`.

Breaking changes include `!` after the type/scope, or a `BREAKING CHANGE:`
footer. Both trigger a major version bump under `release-please`.

## Maintainer fast path

The PR workflow above is the default for external contributors. Maintainers
may use the solo fast path documented in [`AGENTS.md`](./AGENTS.md): for
low-risk changes, commit directly to `main` and let CI / release-please do the
verification and release work. Use a PR instead for risky changes, public API
breaks, destructive migrations, or when a named reviewer is required.

## Releases

Releases are automated via
[release-please](./.github/workflows/release-please.yml):

1. Conventional-Commit PRs merged to `main` trigger release-please.
2. Release-please opens or updates a release PR with the next version +
   CHANGELOG entry.
3. Once CI is green on the release PR it gets squash-merged (automation
   or maintainer) and the tag + GitHub Release are cut automatically.
