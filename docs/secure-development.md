---
title: Secure development
description: Security-relevant development practices, checks, and review evidence for SF Pi.
---

# Secure development

This page summarizes the secure-development practices used by SF Pi. It is a
public, source-agnostic reference for maintainers, contributors, and reviewers.

## Review posture

SF Pi is a public Salesforce open-source project. Changes should be small,
reviewable, and aligned with the extension ownership model:

- Extension behavior starts from `extensions/<id>/manifest.json` and the
  extension README.
- Generated catalogs and generated docs are refreshed with
  `npm run generate-catalog`.
- Security-sensitive changes should update the relevant README, ADR, or security
  docs when behavior changes.
- Pull requests use the repository checklist to call out high-value mutations,
  public-surface changes, tests, docs, and generated artifacts.

## Local validation

Before pushing or opening a PR, run the broad local validation path when
possible:

```bash
npm run validate
```

For focused changes, run the smallest useful checks plus any changed-extension
tests. Common checks include:

```bash
npm run generate-catalog:check
npm run docs:health:check
npm run format:check
npm run check
npm test
bash scripts/check-llm-artifacts.sh
```

## CI and automated checks

The GitHub workflows provide these security-relevant checks:

- **CI**: generated catalog check, docs health, docs build, SPDX headers,
  formatting, ESLint, TypeScript, lifecycle script allowlist, tests, npm audit,
  and LLM artifact checks.
- **Secret scanning**: Gitleaks and TruffleHog run on pushes, pull requests, and
  scheduled scans.
- **Dependency review**: PR dependency changes are checked for high-severity
  vulnerabilities and disallowed licenses.
- **OSV scanner**: dependency vulnerability scans run on PRs, pushes, schedules,
  and manual dispatch.
- **CodeQL**: JavaScript/TypeScript CodeQL runs on schedule and manual dispatch
  when repository visibility and platform support allow it.
- **License scan**: dependency/license posture is checked through the repository
  workflow set.

## Salesforce Code Analyzer

SF Pi includes an `sf-code-analyzer` extension and maintainers can also run
explicit local scans. Recommended use:

- run targeted scans on the changed extension when security-sensitive code
  changes
- run `Recommended:Security` before broad security-review milestones
- treat severity 1 and 2 findings as must-triage before publishing
- record report artifact paths when summarizing review evidence

Example:

```bash
# Through SF Pi tool/command surfaces when available, or explicitly with Code Analyzer
sf code-analyzer run --rule-selector Recommended --target extensions/sf-guardrail --output-file report.json
```

## Dependency and lifecycle-script controls

- `npm audit --omit=dev --audit-level=high` runs in CI for production
  dependencies.
- OSV scanner gives broader advisory coverage.
- Dependency review blocks new high-severity dependency issues in PRs.
- `scripts/check-lifecycle-scripts.mjs` enforces the lifecycle-script allowlist
  so install-time scripts remain visible and reviewed.
- Package overrides in `package.json` include notes explaining why patched
  transitive dependency versions are pinned.

## Secret and public artifact controls

- Do not commit secrets, org auth files, access tokens, SFDX auth URLs, Slack
  tokens, or dotenv-style secret files.
- `.gitleaksignore` may only contain confirmed-fake fixtures with comments.
- `scripts/check-llm-artifacts.sh` blocks unresolved merge markers, prompt
  tokens, and unresolved LLM TODO markers.
- `scripts/docs-health.mjs` checks public docs for common private artifacts such
  as Slack IDs/permalinks, Salesforce sandbox hostnames, customer-specific names,
  and current LLM Gateway public-surface regressions.

## High-value mutation review

New bundled LLM-callable write surfaces must be reviewed against the
[security model](./security-model.md):

1. Is this a high-value durable mutation?
2. Is it mediated by SF Guardrail before execution?
3. Are execution intent flags treated as intent, not approval?
4. Does headless mode fail closed unless explicitly operator-approved?
5. Is the Safety Envelope narrow enough for any session approval offered?

If the answer is unclear, document the decision in an ADR before merging the
feature.
