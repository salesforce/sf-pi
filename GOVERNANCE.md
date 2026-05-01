# Governance

## What this document is

This is a plain-language description of how decisions are made in the `sf-pi`
project. It is deliberately informal. The project is small and maintained in
spare time; heavy governance would be theatre.

## Scope

`sf-pi` bundles Pi-coding-agent extensions for Salesforce-adjacent
development.

## Roles

### Maintainer

| Maintainer       | GitHub                                   | Areas     |
| ---------------- | ---------------------------------------- | --------- |
| Jag Valaiyapathy | [@Jaganpro](https://github.com/Jaganpro) | All areas |

Responsibilities:

- Final call on merge / reject for PRs
- Release cadence and tagging
- Security advisories and CVE coordination
- Enforcing the [Code of Conduct](./CODE_OF_CONDUCT.md)

For security reports, use **GitHub Private Vulnerability Reporting** as
described in [`SECURITY.md`](./SECURITY.md). Do not email maintainers
directly for security issues.

### Contributor

Anyone who submits an issue, PR, review comment, or discussion post. No
formal onboarding.

### Code owners

Listed in [`.github/CODEOWNERS`](./.github/CODEOWNERS). Code owners must
approve changes to their areas before a PR can merge. Today all paths are
owned by the Maintainer; as the project grows, ownership will split.

## Decision-making

- **Small / local changes** (bug fixes, docs, test additions, new
  extensions under an existing pattern): PR + one maintainer approval.
- **Breaking API or behavior changes**: PR + maintainer approval + a
  `CHANGELOG.md` entry calling out the break + minimum two-week notice
  on the PR before merge.
- **New top-level process** (e.g. changing license, adopting a formal RFC
  flow, transferring the repo): open a GitHub Discussion first, then a PR.
  The maintainer makes the final call.

### How disagreements get resolved

1. Prefer discussion in the PR or Discussion thread.
2. If consensus can't be reached, the Maintainer decides and explains the
   reasoning publicly.
3. If the Maintainer's decision is disputed, the disputed party can open
   a new Discussion proposing an alternative; any resulting policy change
   is a PR against this file.

## Becoming a maintainer

There is no formal track today. The bar is roughly:

- Sustained, high-quality contributions over ~3 months
- Demonstrated good judgment on PR review
- Willingness to take security reports seriously
- Invitation by the current Maintainer

New maintainers are added to the table above and to
[`.github/CODEOWNERS`](./.github/CODEOWNERS) via PR.

## Releases

See [`CHANGELOG.md`](./CHANGELOG.md) and the
[release-please workflow](./.github/workflows/release-please.yml). Versions
follow [SemVer 2.0.0](https://semver.org/). While the project is pre-1.0,
minor bumps may include breaking changes; these are flagged in the
changelog.

## Licensing

All contributions are accepted under the project's
[Apache License 2.0](./LICENSE.txt). By submitting a PR you agree your
contribution is licensed under Apache-2.0.

Contributions also require signing the [Salesforce
CLA](https://cla.salesforce.com/sign-cla) (one-time, covers all
Salesforce open-source projects). See [CONTRIBUTING.md](./CONTRIBUTING.md)
for details.

## Changing this document

PR against `GOVERNANCE.md`. Material changes require a Discussion thread
first and at least one week of review before merge.
