---
title: "SF Plannotator"
description: "TUI-first review of Pi replies and local text artifacts through Herdr Annotate or Plannotator TUI"
editLink: false
---

# SF Plannotator

<p class="sfpi-page-lead">TUI-first review of Pi replies and local text artifacts through Herdr Annotate or Plannotator TUI</p>

## What it does

TUI-first reviews of Pi replies and named local text files, with a pinned managed TUI installer, explicit Herdr Full setup, read-only doctor checks, and private review cleanup. Herdr delivers its own feedback; outside Herdr, Pi confirms exported annotations before sending. Hunk owns code diffs.

## Start

Open the extension from its primary command:

```text
/sf-planreview
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-planreview
/sf-pi enable sf-planreview
/sf-pi disable sf-planreview
```

## Safety notes

- Third-party installation is explicit and human-confirmed; managed binaries must match a pinned SHA-256.
- No review automatically approves a Salesforce mutation or replaces SF Guardrail.
- Herdr Annotate owns delivery in Herdr; SF Pi never reposts the feedback.
- Browser review and code-diff review are out of scope for this first slice.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-planreview`
- **Intent:** Work safely
- **Category:** UI
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-planreview`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_shutdown`, `input`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-planreview/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-planreview)
