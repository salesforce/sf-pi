---
title: Secure development
description: Security-relevant development practices, checks, and review evidence for SF Pi.
---

# Secure development

This page summarizes the secure-development practices used by SF Pi. It is a
public, source-agnostic reference for maintainers, contributors, and reviewers.
The evergreen trust and threat posture is documented in the
[security model](./security-model.md); current code and Behavior Proofs provide
implementation evidence.

## Review posture

SF Pi is a public Salesforce open-source project. Changes should be small,
reviewable, and aligned with the extension ownership model:

- Runtime code and Behavior Proofs define extension behavior; manifests declare
  the attested public routing and documentation contract.
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

- **CI**: generated catalog check, docs health, source-architecture policy,
  docs build, SPDX headers, formatting, ESLint, TypeScript, lifecycle script
  allowlist, tests, npm audit, and LLM artifact checks.
- **Prompt-injection impact controls**: Guardrail mediation, Safety Envelopes,
  default HITL, headless fail-closed behavior, and auditability reduce the impact
  of prompt injection against known high-value surfaces.
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

- `npm run audit:production` runs in CI for production dependencies and fails on
  high or critical advisories. Exact no-fix exceptions are source-bound and
  time-limited in `scripts/check-production-audit.mjs`; expired, stale, or new
  advisories fail closed.
- OSV scanner gives broader advisory coverage.
- Dependency review blocks new high-severity dependency issues in PRs.
- `scripts/check-lifecycle-scripts.mjs` enforces the lifecycle-script allowlist
  so install-time scripts remain visible and reviewed.
- Package overrides in `package.json` include notes explaining why patched
  transitive dependency versions are pinned.

## Local file and cryptography controls

- Pi settings writes use a private staging directory and exclusive mode-0600
  file creation, then atomically replace the destination. A destination symlink
  is replaced rather than followed; failed staging preserves previous settings.
- Visual-response audits inspect and read one opened regular session file,
  reject symlinks where the platform supports no-follow, and enforce per-file
  and total byte budgets even when files grow or are replaced during a read.
- Integration plan SHA-256 digests bind reviewed metadata, and MCP configuration
  checksums detect drift in private managed state. Neither is a password verifier.
  OAuth client IDs and scopes are public configuration, not passwords.
- OAuth runtime proofs sign JWTs with RS256. Signature verification and tampered
  payload rejection are tested; password-stretching algorithms do not replace
  digital signatures.
- The remaining `braces` advisory is transitive through Apex's glob-based
  `CoverageReporter`. SF Pi uses `TestService` report writers instead; a focused
  proof verifies test/coverage JSON without invoking that reporter. The dependency
  remains installed, and its exact audit exception still expires on 2026-11-02.
  This is bounded reachability evidence, not a claim that the package is patched.

## Secret and public artifact controls

- Do not commit secrets, org auth files, access tokens, SFDX auth URLs, Slack
  tokens, or dotenv-style secret files.
- `.gitleaksignore` may only contain confirmed-fake fixtures with comments.
- `scripts/check-llm-artifacts.sh` blocks unresolved merge markers, prompt
  tokens, and unresolved LLM TODO markers.
- `scripts/docs-health.mjs` checks the tracked public-text corpus—including
  Markdown, JSON, YAML, source, scripts, and fixtures—for common private-shaped
  org and collaboration identifiers while allowing explicit generic fixtures.

## High-value mutation review

New bundled LLM-callable write surfaces must be reviewed against the
[security model](./security-model.md):

1. Is this a high-value durable mutation?
2. Is it mediated by SF Guardrail before execution?
3. Are execution intent flags treated as intent, not approval?
4. Does headless mode fail closed unless explicitly operator-approved?
5. Could untrusted content steer the model to this surface, and is the prompt-injection impact mitigated before execution?
6. If operator auto-approve mode applies, is it env-only or explicitly configured by the user, audited, and unable to bypass hard blocks?
7. Is the Safety Envelope narrow enough for any session approval offered?

If the answer is unclear, document the decision in an ADR before merging the
feature.
