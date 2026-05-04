# SF Feedback — Code Walkthrough

## What It Does

Provides `/sf-feedback`, a guided public GitHub feedback flow for SF Pi. It asks
for the issue type and user-provided details, collects best-effort local
diagnostics, sanitizes them for public sharing, previews the final Markdown, and
then either creates a GitHub issue with the authenticated `gh` CLI or opens a
prefilled GitHub issue URL.

It also provides `/sf-feedback diagnostics` for copying the sanitized diagnostics
block without creating an issue.

## Runtime Flow

```
Extension loads
  └─ registerCommand("sf-feedback")

/sf-feedback
  ├─ collectDiagnostics()
  │    ├─ package/runtime versions
  │    ├─ OS, shell, terminal, TTY/CI
  │    ├─ git state summary
  │    ├─ SF CLI version/config summary
  │    ├─ enabled/disabled SF Pi extensions
  │    └─ GitHub CLI auth status
  ├─ prompt for issue type/title/details (interactive only)
  ├─ build sanitized Markdown body
  ├─ preview + confirm
  ├─ gh issue create when authenticated
  └─ otherwise open a prefilled GitHub URL
```

## Key Architecture Decisions

### 1. Confirmation before any submission

The extension never creates an issue until the user has reviewed the exact title,
labels, and Markdown body. Diagnostics are sanitized first, but the preview is
still the final privacy gate.

### 2. GitHub CLI is optional

Authenticated `gh` gives the best experience because it can create the issue
directly. If `gh` is missing or unauthenticated, the extension falls back to a
prefilled GitHub issue URL so feedback still works.

### 3. Public-safe diagnostics by default

GitHub issues are public, so diagnostics redact Salesforce org aliases/URLs,
emails, tokens, home-directory paths, and non-GitHub remotes. The extension
summarizes sensitive state instead of including raw command output.

### 4. Best-effort collection

Every diagnostic command may fail on some machines. Failures are summarized as
`unavailable` or `unknown`; one missing tool should not block filing feedback.

## Behavior Matrix

| Event/Trigger              | Condition                              | Result                                          |
| -------------------------- | -------------------------------------- | ----------------------------------------------- |
| `/sf-feedback`             | interactive + authenticated `gh`       | Prompt, preview, confirm, create GitHub issue   |
| `/sf-feedback`             | interactive without authenticated `gh` | Prompt, preview, confirm, open prefilled URL    |
| `/sf-feedback`             | headless                               | Emit draft body and fallback URL; do not submit |
| `/sf-feedback diagnostics` | any mode                               | Emit sanitized diagnostics only                 |
| `/sf-feedback help`        | any mode                               | Show command help                               |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-feedback/
  lib/
    diagnostics.ts          ← implementation module
    github.ts               ← implementation module
    issue-template.ts       ← implementation module
    sanitize.ts             ← implementation module
    types.ts                ← implementation module
  tests/
    github.test.ts          ← unit / smoke test
    issue-template.test.ts  ← unit / smoke test
    sanitize.test.ts        ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run targeted tests:

```bash
npx vitest run extensions/sf-feedback/tests
```

Coverage focuses on the public-safety pieces: sanitization, issue-body
construction, and fallback URL generation. Command UI behavior is manually QA'd
inside pi.

## Troubleshooting

**`/sf-feedback` opens a browser URL instead of creating the issue:**
Install and authenticate the GitHub CLI with `gh auth login`. Without an
authenticated `gh`, SF Feedback intentionally falls back to a prefilled GitHub
issue URL.

**Diagnostics show `unknown` or `unavailable`:**
This means one of the local diagnostic commands failed or the tool is not
installed. The issue can still be submitted; the unavailable field is enough to
show maintainers what was missing.

**A private value appears in the preview:**
Cancel the confirmation dialog and file the issue manually after removing that
value. The sanitizer is conservative, but the final preview is the source of
truth for what would be submitted.
