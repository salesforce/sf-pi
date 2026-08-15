# SF Feedback

## What It Does

SF Feedback provides a guided public GitHub feedback flow. It collects the issue
type and user-provided details, gathers best-effort local diagnostics, sanitizes
them, previews the exact Markdown, and then either uses authenticated `gh` or
opens a prefilled GitHub issue URL.

Manager-launched actions keep their form, field editing, preview, and submit
steps inside the Manager. GitHub CLI is optional, and unavailable diagnostics do
not prevent draft creation.

## Commands

| Command                    | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `/sf-feedback`             | Open the guided feedback flow               |
| `/sf-feedback bug`         | Start with the bug issue type               |
| `/sf-feedback feature`     | Start with the feature issue type           |
| `/sf-feedback setup`       | Start with the setup issue type             |
| `/sf-feedback feedback`    | Start with general feedback                 |
| `/sf-feedback diagnostics` | Show a copyable sanitized diagnostics block |

## Configuration

**SF Pi Manager → SF Feedback → Settings** stores the default issue kind at
`sfPi.feedback.defaultIssueKind`: `bug`, `feature`, `setup`, or `feedback`.
An explicit command type wins and the preference never bypasses preview or
confirmation.

## Safety and Data Boundaries

- No issue is submitted until the user reviews the exact title, labels, and
  Markdown and confirms the write.
- Diagnostics are sanitized before preview and summarize unavailable data rather
  than copying raw command output.
- Headless mode emits a draft and fallback URL only.
- Help, diagnostics, drafts, and summaries use human-only output channels and do
  not steer later model turns.

## Troubleshooting

**The flow opens a browser instead of creating an issue:** Install and
authenticate GitHub CLI with `gh auth login`. The browser path is the supported
fallback.

**The account cannot create public issues:** Copy the generated Markdown and use
an account or support path with access.

**Diagnostics contain `unknown` or `unavailable`:** One local probe failed or a
tool is absent. The draft remains usable and identifies what was unavailable.

**A private value appears in preview:** Cancel submission and remove it manually.
The final preview is authoritative for what would be published.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-feedback/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
