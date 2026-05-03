# Contributing Guide For sf-pi

This page lists the operational governance model of this project, as well as
the recommendations and requirements for how to best contribute to `sf-pi`.
We strive to obey these as best as possible. As always, thanks for
contributing – we hope these guidelines make it easier and shed some light on
our approach and processes.

# Governance Model

## Community Based

The intent and goal of open sourcing this project is to increase the
contributor and user base. The governance model is one where new project
leads (`admins`) will be added to the project based on their contributions
and efforts, a so-called "do-acracy" or "meritocracy" similar to that used
by all Apache Software Foundation projects.

# Getting started

Project discussion happens in [GitHub
Issues](https://github.com/salesforce/sf-pi/issues) and
[Discussions](https://github.com/salesforce/sf-pi/discussions). Please also
take a look at the project [roadmap](ROADMAP.md) to see where we are headed.

# Issues, requests & ideas

Use GitHub Issues to submit issues, enhancement requests, and discuss ideas.

### Bug Reports and Fixes

- If you find a bug, please search for it in the
  [Issues](https://github.com/salesforce/sf-pi/issues), and if it isn't
  already tracked,
  [create a new issue](https://github.com/salesforce/sf-pi/issues/new).
  Fill out the "Bug Report" section of the issue template. Even if an Issue
  is closed, feel free to comment and add details, it will still be
  reviewed.
- Issues that have already been identified as a bug (note: able to
  reproduce) will be labelled `bug`.
- If you'd like to submit a fix for a bug, [send a Pull
  Request](#creating-a-pull-request) and mention the Issue number.
  - Include tests that isolate the bug and verify that it was fixed.

### New Features

- If you'd like to add new functionality to this project, describe the
  problem you want to solve in a [new
  Issue](https://github.com/salesforce/sf-pi/issues/new).
- Issues that have been identified as a feature request will be labelled
  `enhancement`.
- If you'd like to implement the new feature, please wait for feedback from
  the project maintainers before spending too much time writing the code.
  In some cases, `enhancement`s may not align well with the project
  objectives at the time.

### Tests, Documentation, Miscellaneous

- If you'd like to improve the tests, make the documentation clearer, have
  an alternative implementation of something that may have advantages over
  the way it's currently done, or you have any other change, we would be
  happy to hear about it!
  - If it's a trivial change, go ahead and [send a Pull
    Request](#creating-a-pull-request) with the changes you have in mind.
  - If not, [open an Issue](https://github.com/salesforce/sf-pi/issues/new)
    to discuss the idea first.

If you're new to our project and looking for some way to make your first
contribution, look for Issues labelled `good first contribution`.

# Contribution Checklist

- [x] Clean, simple, well-styled code
- [x] Commits should be atomic and messages must be descriptive. Related
      issues should be mentioned by Issue number.
- [x] Comments
  - Module-level & function-level comments.
  - Comments on complex blocks of code or algorithms (include references
    to sources).
- [x] Tests
  - The test suite must pass.
  - Increase code coverage, not the reverse.
- [x] Dependencies
  - Minimize number of dependencies.
  - Prefer Apache 2.0, BSD3, MIT, ISC, and MPL licenses.
- [x] Reviews
  - Changes must be approved via peer code review.

# Creating a Pull Request

1. **Ensure the bug/feature was not already reported** by searching on
   GitHub under Issues. If none exists, create a new issue so that other
   contributors can keep track of what you are trying to add/fix and offer
   suggestions (or let you know if there is already an effort in
   progress).
2. **Clone** the forked repo to your machine.
3. **Create** a new branch to contain your work (e.g. `git checkout -b
fix-issue-11`).
4. **Commit** changes to your own branch.
5. **Push** your work back up to your fork.
6. **Submit** a Pull Request against the `main` branch and refer to the
   issue(s) you are fixing. Try not to pollute your pull request with
   unintended changes. Keep it simple and small.
7. **Sign** the Salesforce CLA (you will be prompted to do so when
   submitting the Pull Request).

> **NOTE**: Be sure to [sync your
> fork](https://help.github.com/articles/syncing-a-fork/) before making a
> pull request.

# Contributor License Agreement ("CLA")

In order to accept your pull request, we need you to submit a CLA. You only
need to do this once to work on any of Salesforce's open source projects.

Complete your CLA here: <https://cla.salesforce.com/sign-cla>

# Issues

We use GitHub issues to track public bugs. Please ensure your description
is clear and has sufficient instructions to be able to reproduce the issue.

# Code of Conduct

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

# License

By contributing your code, you agree to license your contribution under the
terms of our project [LICENSE](LICENSE.txt) and to sign the [Salesforce
CLA](https://cla.salesforce.com/sign-cla).

---

# Development setup

Everything below is specific to working on `sf-pi` locally.

## Clone and install

```bash
git clone https://github.com/salesforce/sf-pi.git
cd sf-pi
npm install
```

The `postinstall` step sets up Husky git hooks (`pre-commit` + `commit-msg`)
so your commits are auto-formatted and validated against
[Conventional Commits](https://www.conventionalcommits.org/).

Optional local install for manual testing:

```bash
pi install .
```

## Scripts reference

The most common entry points, grouped by purpose:

| Purpose                  | Command                                            | Check-only variant                    |
| ------------------------ | -------------------------------------------------- | ------------------------------------- |
| Regenerate catalog       | `npm run generate-catalog`                         | `npm run generate-catalog:check`      |
| Format                   | `npm run format`                                   | `npm run format:check`                |
| SPDX headers             | `npm run spdx`                                     | `npm run spdx:check`                  |
| ESLint                   | `npm run eslint:fix`                               | `npm run eslint`                      |
| Type check               | —                                                  | `npm run check`                       |
| Run tests                | `npm test`                                         | —                                     |
| Tests + coverage         | `npm run test:coverage`                            | —                                     |
| Watch tests              | `npm run test:watch`                               | —                                     |
| Lint bundle              | —                                                  | `npm run lint`                        |
| Full local validation    | —                                                  | `npm run validate`                    |
| CI artifact guard        | —                                                  | `bash scripts/check-llm-artifacts.sh` |
| Scaffold a new extension | `npm run scaffold -- --id sf-my-ext --category ui` | —                                     |

`npm run lint` is a convenience bundle that runs `format:check`,
`generate-catalog:check`, `spdx:check`, and `eslint` in order. Prefer
`npm run validate` before opening a PR — it adds the type check and the
full test suite on top. CI also runs `scripts/check-llm-artifacts.sh`, so
run that guard locally when a change touches prompts, generated text, or
LLM-facing docs.

## Source of truth

Use this order:

1. `extensions/<id>/manifest.json`
2. `catalog/index.json` and `catalog/registry.ts` (generated)
3. `extensions/<id>/README.md`
4. root `README.md`

### Generated files

Do not edit these manually:

- `catalog/registry.ts`
- `catalog/index.json`
- `docs/commands.md`
- generated sections in `README.md`: bundled extensions, command reference,
  troubleshooting index
- generated folder layout in `ARCHITECTURE.md`
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
[`extensions/sf-llm-gateway-internal/AGENTS.md`](./extensions/sf-llm-gateway-internal/AGENTS.md)
for examples. Phased roadmaps live in the extension's own `ROADMAP.md`
(see [`extensions/sf-skills-hud/ROADMAP.md`](./extensions/sf-skills-hud/ROADMAP.md)).

Scaffold a new extension with:

```bash
npm run scaffold -- --id sf-my-extension --category ui --name "My Extension"
```

The `--category` must be one of:

- **`core`** — runtime-critical extensions (the manager, tool-registering
  integrations like Slack, LSP diagnostics). These usually register slash
  commands and/or tools.
- **`provider`** — LLM providers or auth integrations that plug into pi's
  provider system (e.g. `sf-llm-gateway-internal`).
- **`ui`** — status bars, splashes, overlays, spinners. UI-only; never
  register tools that the LLM can call.

### Extension README conventions

Extension READMEs should include these sections when relevant:

- **What It Does** — one paragraph, user-facing.
- **Runtime Flow** — event-by-event diagram.
- **Commands** — one row per slash command with a short description.
- **Behavior Matrix** — event/trigger → condition → result table.
- **File Structure** — tree listing `lib/` + `tests/`.
- **Troubleshooting** — bolded `**Symptom:**` entries with fixes. The
  catalog generator picks these up and builds the root README's
  troubleshooting index automatically, so every entry you add shows up
  with a jump link.

The `## Troubleshooting` convention specifically parses lines shaped like
`**Some symptom or question:**` or `**Some question?**` — keep that syntax
and new entries appear in the root index on the next
`npm run generate-catalog`.

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
