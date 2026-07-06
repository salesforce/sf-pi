## What this PR does

<!-- One or two lines. What changes, and for which extension/area? -->

## Why

<!-- The user-facing problem this solves. Link the issue if there is one. -->

Closes #

## How

<!-- Bullet the key changes. Mention any non-obvious design decisions. -->

-
-

## Checklist

- [ ] I ran `npm run validate` locally, or I listed the focused checks I ran below
- [ ] I updated the affected extension's `README.md` (if behavior changed)
- [ ] I added or updated tests
- [ ] I regenerated the catalog (`npm run generate-catalog`) if I touched `manifest.json`
- [ ] I added a `CHANGELOG.md` entry under `[Unreleased]`
- [ ] This PR is non-breaking, or I called out the breaking change explicitly above

## Security and public-surface checklist

- [ ] I considered whether this adds or changes a high-value durable mutation exposed through an LLM-callable tool
- [ ] Any high-value mutation is mediated by SF Guardrail, explicitly out of scope, or documented in an ADR/security note
- [ ] Execution intent flags (for example `allow_mutation`, `allow_confirmed`, `mutation`, or `dry_run=false`) are not treated as approval
- [ ] Headless execution for confirm-class operations fails closed unless explicitly operator-approved
- [ ] Public docs, examples, tests, comments, and diagnostics do not include secrets, customer names, real org/workspace identifiers, private hostnames, internal links, or copied private-source wording
- [ ] New env vars, settings, provider labels, and examples use public-safe names and generic placeholders

## Validation performed

<!-- Paste commands/results or explain why a broader check was not run. -->

-

## Notes for reviewers

<!-- Anything to watch out for — gotchas, follow-up work, screenshots. -->
