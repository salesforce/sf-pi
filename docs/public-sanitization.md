---
title: Public sanitization
description: Public-safe content rules for SF Pi source, docs, examples, tests, and diagnostics.
---

# Public sanitization

SF Pi is a public repository. Public output must be source-agnostic and must not
copy, quote, or closely paraphrase private conversations, internal notes,
customer material, private repos, screenshots, or other non-public sources.

Use private sources only to understand concepts, constraints, or troubleshooting
patterns. Rewrite examples into fresh, generic scenarios before committing them.

## Do not commit

Do not commit or publish:

- secrets, API keys, tokens, SFDX auth URLs, session cookies, passwords, or
  private keys
- Salesforce org IDs, usernames, instance URLs, sandbox hostnames, scratch org
  identifiers, or customer-specific aliases
- Slack workspace, channel, user, file, canvas, or permalink identifiers from a
  real workspace
- customer names, employee names, account names, project codenames, or other
  identifying details
- private/internal hostnames, unpublished service details, private repository
  URLs, internal ticket/case IDs, or internal documentation links
- screenshots or browser evidence that contains customer, employee, org, Slack,
  or internal service data
- internal-only examples copied from Slack, customer engagements, support cases,
  or private docs

## Prefer generic examples

Use generic examples such as:

- `https://your-gateway.example.com`
- `https://gateway.example.test`
- `MyAgent`
- `ExampleAccount`
- `C01ABCEXAMPLE` for placeholder Slack channel IDs
- `U01ABCEXAMPLE` for placeholder Slack user IDs
- `00D000000000000AAA` only when a Salesforce-shaped placeholder is needed

Avoid examples that look like a real customer, employee, org, or workspace.

## Gateway public surface

The SF LLM Gateway extension ships with no default endpoint or credentials. Public
docs should use source-agnostic setup language:

- say "compatible gateway", "configured gateway", or "gateway root URL"
- prefer `SF_LLM_GATEWAY_*` environment variables in public docs
- describe legacy env names only when necessary for compatibility, without using
  them as the primary setup path
- avoid publishing private endpoint names, private routing details, internal-only
  model/provider identifiers, or organization-specific certificate locations

Source code and tests may keep compatibility constants and focused regression
fixtures when they are necessary to preserve behavior. Prefer generic fixtures in
public docs and examples.

## Diagnostics and artifacts

Public diagnostics must be summarized and sanitized. Do not paste raw command
output when it may contain:

- local paths with usernames
- org aliases or usernames
- Slack identifiers
- tokens or env vars
- browser screenshots with private data
- full prompt or tool payloads from customer/internal contexts

The `sf-feedback` extension is the preferred path for filing public issues
because it collects and sanitizes diagnostics before previewing the final issue
body.

## Automation checks

The repository has automated checks for common public-safety mistakes:

- Gitleaks and TruffleHog secret scanning
- docs-health public-safety patterns
- LLM artifact checks
- dependency and license checks

These checks are a backstop, not a substitute for review. If a public/private
classification is unclear, omit, generalize, or ask before publishing.
